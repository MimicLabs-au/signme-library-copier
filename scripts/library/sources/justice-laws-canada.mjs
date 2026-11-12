// Source adapter: the consolidated federal Acts and regulations of Canada, as
// published by the Department of Justice (Justice Laws Website) in XML at
// https://github.com/justicecanada/laws-lois-xml. Licence: Open Government
// Licence – Canada (the repository's LICENSE.md) and the Reproduction of
// Federal Law Order, SI/97-5 (anyone may reproduce federal enactments without
// permission, with due diligence as to accuracy and not represented as
// official). claude/library-canada-expansion-2026-11-09.md.
//
// Reads from a local checkout of the repository (the workflow clones it), so
// nothing is fetched from the publisher's website. English texts only for
// now; the French texts sit beside them in fra/ for a later collection.

import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseXml, textOf, find } from './legislation-gov-uk.mjs'

export const SOURCE = 'justice_laws_canada'

/** The repository's two languages: the same element names, different folders
 *  and site paths. English is the default; French is its own collection. */
export const LANGUAGES = {
  eng: {
    site: 'https://laws-lois.justice.gc.ca/eng',
    kinds: {
      acts: { type: 'primary_legislation', dir: 'eng/acts', urlPart: 'acts' },
      regulations: {
        type: 'secondary_legislation',
        dir: 'eng/regulations',
        urlPart: 'regulations',
      },
    },
    repealedNote: /^\[Repealed[,\]\s]/i,
    notConsolidated: /not included in the database of consolidated federal legislation/i,
  },
  fra: {
    site: 'https://laws-lois.justice.gc.ca/fra',
    kinds: {
      acts: { type: 'primary_legislation', dir: 'fra/lois', urlPart: 'lois' },
      regulations: { type: 'secondary_legislation', dir: 'fra/reglements', urlPart: 'reglements' },
    },
    repealedNote: /^\[(Abrogée?s?|Repealed)[,\]\s]/iu,
    notConsolidated:
      /ne sont pas inclus(e|es)? dans la base de données|n['’]est pas inclus(e|es)? dans la base de données|not included in the database/i,
  },
}
export const SITE = LANGUAGES.eng.site
export const KINDS = LANGUAGES.eng.kinds
export const JURISDICTION = 'canada_federal'

const isEl = (n) => typeof n === 'object'
const child = (node, name) => node.children.find((c) => isEl(c) && c.name === name) ?? null
const clean = (s) => s.replace(/\s+/g, ' ').trim()

// Left out of the text: editorial history, cross-reference apparatus, tables
// of provisions, and amendments not yet in force.
const SKIP = new Set([
  'HistoricalNote',
  'HistoricalNoteSubItem',
  'RelatedOrNotInForce',
  'Footnote',
  'FootnoteRef',
  'TableOfProvisions',
  'Identification',
  'MarginalNote',
  'colspec',
  'spanspec',
  'RunningHead',
  'BillHistory',
  'Chapter',
  'ConsolidationDate',
  'RegistrationDate',
])
const PARAS = new Set([
  'Text',
  'Provision',
  'Subsection',
  'Paragraph',
  'Subparagraph',
  'Clause',
  'Subclause',
  'Definition',
  'LongTitle',
  'ShortTitle',
  'TitleText',
  'Enacts',
  'Recital',
  'Oath',
  'FormulaText',
  'FormulaDefinition',
  'ReadAsText',
  'AmendedText',
  'row',
  'ScheduleFormHeading',
  'Label',
  'Repealed',
  'Language',
  'ContinuedSectionSubsection',
  'SectionPiece',
])

function render(node, ctx) {
  if (typeof node === 'string') return node
  const { name } = node
  if (SKIP.has(name)) return ''
  if (name === 'Heading' || name === 'Schedule') {
    const label = child(node, 'Label')
    const title = child(node, 'TitleText')
    const heading = clean(`${textOf(label)} ${textOf(title)}`)
    const rest = node.children
      .filter((c) => c !== label && c !== title)
      .map((c) => render(c, ctx))
      .join('')
    return `\n\n${heading}\n\n${rest}\n\n`
  }
  if (name === 'Section') {
    // "<number> <marginal note>" as the section's own heading line.
    const label = child(node, 'Label')
    const note = child(node, 'MarginalNote')
    const heading = clean(`${textOf(label)} ${textOf(note)}`)
    const rest = node.children
      .filter((c) => c !== label && c !== note)
      .map((c) => render(c, ctx))
      .join('')
    return `\n\n${heading}\n\n${rest.replace(/^\s+/, '')}\n\n`
  }
  if (
    [
      'Subsection',
      'Paragraph',
      'Subparagraph',
      'Clause',
      'Subclause',
      'Provision',
      'Definition',
    ].includes(name)
  ) {
    const label = child(node, 'Label')
    const number = label ? `(${clean(textOf(label)).replace(/^\(|\)$/g, '')}) ` : ''
    const rest = node.children
      .filter((c) => c !== label && !(isEl(c) && c.name === 'MarginalNote'))
      .map((c) => render(c, ctx))
      .join('')
    return `\n${number}${rest.replace(/^\s+/, '')}\n`
  }
  if (name === 'entry') return `${clean(textOf(node))} | `
  const inner = node.children.map((c) => render(c, ctx)).join('')
  if (PARAS.has(name)) return `\n${inner}\n`
  return inner
}

/** The publisher keeps records that are not law SignMe should hold: a repealed
 *  Act or regulation (a stub with only "[Repealed, …]" notes, or a body whose
 *  every provision is repealed) and placeholders for Acts "not included in the
 *  database of consolidated federal legislation". Returns the reason, or null
 *  for a live document. Judged on the text with titles and repeal notes removed. */
export function emptyReason(text, titles = [], language = LANGUAGES.eng) {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  const isTitle = new Set(titles.map((t) => t.trim()))
  const body = lines.slice(1).filter(
    (l) =>
      !isTitle.has(l) &&
      !language.repealedNote.test(l) &&
      !/^\d+[A-Za-z.]*$/.test(l) &&
      // A registration line left behind a repealed instrument: "SOR/2020-159 2020-07-01".
      !/^(SOR|SI|DORS|TR|C\.R\.C\.)[/,. ].*\d{4}-\d{2}-\d{2}$/.test(l) &&
      !/^(SCHEDULE|ANNEXE)\b/i.test(l),
  )
  // An Act whose every provision is repealed leaves only its section headings
  // between the repeal notes; headings alone are not substance.
  const hasRepeals = lines.some((l) => language.repealedNote.test(l))
  const substance = (hasRepeals ? body.filter((l) => l.length >= 60) : body).join(' ')
  if (language.notConsolidated.test(substance)) return 'not_consolidated'
  if (substance.length < 200 && lines.some((l) => language.repealedNote.test(l))) return 'repealed'
  if (!substance) return 'empty'
  return null
}

/** Converts a Justice Laws XML document to plain text; '' if unusable. */
export function lawsToText(xml) {
  const doc = parseXml(xml)
  const root = find(doc, 'Statute') ?? find(doc, 'Regulation') ?? doc
  const ident = find(root, 'Identification')
  const title = clean(textOf(find(ident, 'ShortTitle') ?? find(ident, 'LongTitle') ?? ''))
  const longTitle = clean(textOf(find(ident, 'LongTitle') ?? ''))
  const parts = [title, longTitle !== title ? longTitle : '']
  for (const c of root.children)
    if (isEl(c) && c.name !== 'Identification') parts.push(render(c, {}))
  const text = parts
    .join('\n\n')
    .split('\n')
    .map((l) =>
      l
        .replace(/[ \t ]+/g, ' ')
        .replace(/ \| $/, '')
        .trim(),
    )
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+|\n+$/g, '')
  return text.length < 40 ? '' : text
}

const dateOf = (node) => {
  const d = node && find(node, 'Date')
  if (!d) return null
  const y = clean(textOf(child(d, 'YYYY'))),
    m = clean(textOf(child(d, 'MM'))),
    day = clean(textOf(child(d, 'DD')))
  return y && m && day ? `${y}-${m.padStart(2, '0')}-${day.padStart(2, '0')}` : null
}

/** Metadata SignMe records for a document. `id` is the file name without .xml. */
export function lawsMetadata(xml, kind, id, language = LANGUAGES.eng) {
  const doc = parseXml(xml)
  const root = find(doc, 'Statute') ?? find(doc, 'Regulation') ?? doc
  const ident = find(root, 'Identification')
  const short = clean(textOf(find(ident, 'ShortTitle') ?? ''))
  const long = clean(textOf(find(ident, 'LongTitle') ?? ''))
  const number = clean(
    textOf(find(ident, 'ConsolidatedNumber') ?? find(ident, 'InstrumentNumber') ?? ''),
  )
  const citation = short || long || id
  const assented = (find(ident, 'BillHistory')?.children ?? []).find(
    (s) => isEl(s) && s.attrs.stage === 'assented-to',
  )
  const date = dateOf(assented) ?? dateOf(find(ident, 'RegistrationDate')) ?? null
  return {
    // French texts carry their own ids ("lois/C-5") so both languages sit side by side.
    version_id: `${SOURCE}:${language.kinds[kind].urlPart}/${id}`,
    type: language.kinds[kind].type,
    jurisdiction: JURISDICTION,
    source: SOURCE,
    date,
    citation: number && !citation.includes(number) ? `${citation} (${number})` : citation,
    url: `${language.site}/${language.kinds[kind].urlPart}/${encodeURIComponent(id)}/`,
    titles: [short, long].filter(Boolean),
    currentDate: root.attrs['current-date'] ?? root.attrs['lims:current-date'] ?? null,
  }
}

/**
 * Yields every Act and regulation in the checkout, in file order. `state` is
 * the resumable cursor: { kinds: { acts: { files: [...], next: 0 } } }.
 */
export async function* documents({
  sourceDir,
  kinds = Object.keys(KINDS),
  lang = 'eng',
  state,
  log,
}) {
  if (!sourceDir)
    throw new Error(
      'justice-laws-canada: --source-dir (a checkout of justicecanada/laws-lois-xml) is required',
    )
  const language = LANGUAGES[lang]
  if (!language) throw new Error(`justice-laws-canada: unknown language ${lang}`)
  state.kinds ??= {}
  for (const kind of kinds) {
    if (!language.kinds[kind]) throw new Error(`justice-laws-canada: unknown kind ${kind}`)
    const k = (state.kinds[kind] ??= { files: null, next: 0 })
    if (!k.files) {
      k.files = (await readdir(join(sourceDir, language.kinds[kind].dir)))
        .filter((f) => f.endsWith('.xml'))
        .sort()
      log('library_import_listed', { kind, items: k.files.length })
    }
    while (k.next < k.files.length) {
      const file = k.files[k.next]
      const id = file.slice(0, -4)
      const xml = await readFile(join(sourceDir, language.kinds[kind].dir, file), 'utf8')
      k.next++
      const text = lawsToText(xml)
      const meta = lawsMetadata(xml, kind, id, language)
      const reason = text ? emptyReason(text, meta.titles, language) : 'empty'
      if (reason) {
        log('library_import_skipped', { path: `${kind}/${id}`, reason })
        yield null
        continue
      }
      const { currentDate, titles, ...rest } = meta
      yield {
        ...rest,
        text,
        when_scraped: currentDate ? `${currentDate}T00:00:00Z` : new Date().toISOString(),
      }
    }
  }
}
