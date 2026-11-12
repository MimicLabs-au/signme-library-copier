// Source adapter: legislation.gov.uk (The National Archives), the official home
// of UK legislation. Open Government Licence v3.0; commercial use allowed with
// attribution. claude/library-uk-expansion-2026-11-09.md.
//
// Listing: the site's Atom feeds, one per legislation type
// (https://www.legislation.gov.uk/ukpga/data.feed?page=N). Text: the current
// revised version of each item as CLML XML (…/ukpga/1996/18/data.xml), turned
// into plain text here with section numbers and headings kept as their own
// lines, so scripts/corpus/chunk.mjs labels passages by section.
//
// Dependency-free so the text conversion can be unit tested on fixtures.

export const SOURCE = 'legislation_gov_uk'
// Tests point this at a local stand-in for the site.
export const BASE = process.env.LIBRARY_SOURCE_BASE || 'https://www.legislation.gov.uk'

/** Legislation types this adapter knows, with the jurisdiction and kind SignMe
 *  records for each and the first year the type exists (listing starts
 *  there). Keys are the site's own type codes. */
export const TYPES = {
  ukpga: {
    from: 1267,
    jurisdiction: 'united_kingdom',
    type: 'primary_legislation',
    name: 'UK Public General Acts',
  },
  asp: {
    from: 1999,
    jurisdiction: 'scotland',
    type: 'primary_legislation',
    name: 'Acts of the Scottish Parliament',
  },
  asc: {
    from: 2020,
    jurisdiction: 'wales',
    type: 'primary_legislation',
    name: 'Acts of Senedd Cymru',
  },
  anaw: {
    from: 2012,
    jurisdiction: 'wales',
    type: 'primary_legislation',
    name: 'Acts of the National Assembly for Wales',
  },
  mwa: {
    from: 2008,
    jurisdiction: 'wales',
    type: 'primary_legislation',
    name: 'Measures of the National Assembly for Wales',
  },
  nia: {
    from: 2000,
    jurisdiction: 'northern_ireland',
    type: 'primary_legislation',
    name: 'Acts of the Northern Ireland Assembly',
  },
  apni: {
    from: 1921,
    jurisdiction: 'northern_ireland',
    type: 'primary_legislation',
    name: 'Acts of the Northern Ireland Parliament',
  },
  mnia: {
    from: 1974,
    jurisdiction: 'northern_ireland',
    type: 'primary_legislation',
    name: 'Measures of the Northern Ireland Assembly',
  },
  nisi: {
    from: 1972,
    jurisdiction: 'northern_ireland',
    type: 'primary_legislation',
    name: 'Northern Ireland Orders in Council',
  },
  uksi: {
    from: 1948,
    jurisdiction: 'united_kingdom',
    type: 'secondary_legislation',
    name: 'UK Statutory Instruments',
  },
  ssi: {
    from: 1999,
    jurisdiction: 'scotland',
    type: 'secondary_legislation',
    name: 'Scottish Statutory Instruments',
  },
  wsi: {
    from: 1999,
    jurisdiction: 'wales',
    type: 'secondary_legislation',
    name: 'Wales Statutory Instruments',
  },
  nisr: {
    from: 1922,
    jurisdiction: 'northern_ireland',
    type: 'secondary_legislation',
    name: 'Northern Ireland Statutory Rules',
  },
}

/** Items are listed a year at a time: the one long feed per type stops short,
 *  and a year's feed is small. The earliest Act on the site is from 1267. */
export const FIRST_YEAR = 1267
export const feedUrl = (type, year, page) => `${BASE}/${type}/${year}/data.feed?page=${page}`
// `path` is the item's own path after the type: "1996/18", or for Acts before
// 1963 a regnal year, "Vict/63-64/63".
export const textUrl = (type, path) => `${BASE}/${type}/${path}/data.xml`
export const documentUrl = (type, path) => `${BASE}/${type}/${path}`
export const versionId = (type, path) => `${SOURCE}:${type}/${path}`

// ---------------------------------------------------------------- a small XML reader

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
export function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : ''
    }
    return ENTITIES[e.toLowerCase()] ?? m
  })
}

/**
 * Parses XML into { name, attrs, children } nodes (text children are strings).
 * Namespace prefixes are dropped from element names. Tolerant: unbalanced
 * tags close what is open. Enough for CLML and Atom; not a general parser.
 */
export function parseXml(xml) {
  const root = { name: '#root', attrs: {}, children: [] }
  const stack = [root]
  const re =
    /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<\/([\w:.-]+)\s*>|<([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g
  let m
  while ((m = re.exec(xml))) {
    const [, cdata, close, open, attrText, selfClose, text] = m
    const top = stack.at(-1)
    if (cdata !== undefined) top.children.push(cdata)
    else if (text !== undefined) top.children.push(decodeEntities(text))
    else if (close) {
      const local = close.replace(/^[\w.-]+:/, '')
      for (let i = stack.length - 1; i > 0; i--)
        if (stack[i].name === local) {
          stack.length = i
          break
        }
    } else if (open) {
      const attrs = {}
      for (const a of attrText.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g))
        attrs[a[1].replace(/^[\w.-]+:/, '')] = decodeEntities(a[2] ?? a[3] ?? '')
      const node = { name: open.replace(/^[\w.-]+:/, ''), attrs, children: [] }
      top.children.push(node)
      if (!selfClose) stack.push(node)
    }
  }
  return root
}

const isEl = (n) => typeof n === 'object'
export function textOf(node) {
  if (!node) return ''
  if (typeof node === 'string') return node
  return node.children.map(textOf).join('')
}
export function find(node, name) {
  if (!isEl(node)) return null
  for (const c of node.children) {
    if (!isEl(c)) continue
    if (c.name === name) return c
    const deeper = find(c, name)
    if (deeper) return deeper
  }
  return null
}
const child = (node, name) => node.children.find((c) => isEl(c) && c.name === name) ?? null
const clean = (s) => s.replace(/\s+/g, ' ').trim()

// ---------------------------------------------------------------- Atom listing

/** Parses one page of a legislation.gov.uk Atom feed into items. */
export function parseFeed(xml) {
  const doc = parseXml(xml)
  const feed = find(doc, 'feed') ?? doc
  const items = []
  for (const entry of feed.children.filter((c) => isEl(c) && c.name === 'entry')) {
    const id = clean(textOf(child(entry, 'id')))
    const m = id.match(/\/id\/([a-z]+)\/(.+)$/)
    if (!m) continue
    const [, type, path] = m
    const title = clean(textOf(child(entry, 'title'))) || `${type} ${path}`
    const yearAttr = Number(find(entry, 'Year')?.attrs.Value)
    const year =
      yearAttr ||
      Number(path.match(/^(\d{4})\//)?.[1]) ||
      Number(title.match(/\b(1[2-9]\d\d|20\d\d)\b/)?.[1]) ||
      null
    items.push({ type, path, year, title, updated: clean(textOf(child(entry, 'updated'))) || null })
  }
  const morePages = Number(clean(textOf(find(feed, 'morePages'))) || 0)
  const page = Number(clean(textOf(find(feed, 'page'))) || 1)
  return { items, page, morePages }
}

// ---------------------------------------------------------------- CLML → text

// Left out of the text: metadata, tables of contents, editorial apparatus, images.
const SKIP = new Set([
  'Metadata',
  'Contents',
  'Commentaries',
  'Commentary',
  'Footnotes',
  'MarginNotes',
  'Versions',
  'Resources',
  'Figure',
  'Image',
  'CommentaryRef',
  'FootnoteRef',
  'MarginNoteRef',
  'link',
])
// A heading-bearing container: "<Number> <Title>" on its own line, then the body.
const GROUPS = new Set([
  'Part',
  'Chapter',
  'Pblock',
  'PsubBlock',
  'Schedule',
  'P1group',
  'P2group',
  'P3group',
])
// A paragraph-level element: its text on its own line.
const PARAS = new Set([
  'Text',
  'Para',
  'ListItem',
  'TableRow',
  'LongTitle',
  'Title',
  'Number',
  'Subtitle',
  'DateSigned',
  'Signatory',
  'Signee',
  'EnactingText',
  'Preamble',
  'IntroductoryText',
  'ExplanatoryNotes',
  'P1',
  'P2',
  'P3',
  'P4',
  'P5',
  'P6',
  'P7',
  'P',
  'BlockText',
  'Form',
  'Tabular',
])

/** Renders one node to text. Paragraph breaks are "\n", heading blocks "\n\n". */
function render(node, ctx) {
  if (typeof node === 'string') return node
  const { name } = node
  if (SKIP.has(name)) return ''
  if (GROUPS.has(name)) {
    const number = child(node, 'Number')
    const title = child(node, 'Title')
    let heading = clean(`${textOf(number)} ${textOf(title)}`)
    const rest = node.children.filter((c) => c !== number && c !== title)
    if (name === 'P1group' && !number) {
      // A section: its number sits in the first P1 below the group's Title.
      const p1 = rest.find((c) => isEl(c) && c.name === 'P1')
      const pnumber = p1 && child(p1, 'Pnumber')
      if (pnumber) {
        heading = clean(`${textOf(pnumber)} ${textOf(title)}`)
        ctx.skipOnce = pnumber
      }
    }
    const body = rest.map((c) => render(c, ctx)).join('')
    return `\n\n${heading}\n\n${body}\n\n`
  }
  if (name === 'Pnumber') {
    if (ctx.skipOnce === node) {
      ctx.skipOnce = null
      return ''
    }
    return `${clean(textOf(node))} `
  }
  if (/^P[1-7]$/.test(name)) {
    // A numbered paragraph: "(1) text…" on one line, its sub-paragraphs below.
    const pnumber = child(node, 'Pnumber')
    let number = ''
    if (pnumber && ctx.skipOnce !== pnumber)
      number = name === 'P1' ? `${clean(textOf(pnumber))} ` : `(${clean(textOf(pnumber))}) `
    else if (pnumber) ctx.skipOnce = null
    const rest = node.children
      .filter((c) => c !== pnumber)
      .map((c) => render(c, ctx))
      .join('')
    return `\n${number}${rest.replace(/^\s+/, '')}\n`
  }
  if (name === 'TableCell' || name === 'th' || name === 'td') return `${clean(textOf(node))} | `
  const inner = node.children.map((c) => render(c, ctx)).join('')
  if (PARAS.has(name)) return `\n${inner}\n`
  return inner
}

/**
 * Converts CLML (legislation.gov.uk XML) to plain text. Sections become
 * "<number> <heading>" lines followed by their text; parts and chapters
 * "Part 3 <heading>". Returns '' for an empty or unusable document.
 */
export function clmlToText(xml) {
  const doc = parseXml(xml)
  const legislation = find(doc, 'Legislation') ?? doc
  const bodies = ['Primary', 'Secondary', 'EUBody', 'EURetained']
    .map((n) => find(legislation, n))
    .filter(Boolean)
  const roots = bodies.length ? bodies : [legislation]
  const ctx = { skipOnce: null }
  const raw = roots.map((r) => render(r, ctx)).join('\n\n')
  const text = raw
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

/** Metadata SignMe records for a document, from its CLML. */
export function clmlMetadata(xml, item) {
  const info = TYPES[item.type]
  const doc = parseXml(xml)
  const meta = find(doc, 'Metadata')
  const title = clean(textOf(find(meta ?? doc, 'title'))) || item.title
  const dateOf = (name) => (meta && find(meta, name)?.attrs.Date) || null
  const date =
    dateOf('EnactmentDate') ?? dateOf('Made') ?? dateOf('Laid') ?? dateOf('ComingIntoForce')
  return {
    version_id: versionId(item.type, item.path),
    type: info.type,
    jurisdiction: info.jurisdiction,
    source: SOURCE,
    date:
      date && /^\d{4}-\d{2}-\d{2}/.test(date)
        ? date.slice(0, 10)
        : item.year
          ? `${item.year}-01-01`
          : null,
    citation: title,
    url: documentUrl(item.type, item.path),
  }
}

// ---------------------------------------------------------------- the adapter

/**
 * Lists every item of the collection's types, a year at a time, then yields
 * one document at a time: { ...metadata, text, when_scraped }. `fetchText(url)`
 * returns the body as a string or null for 404; it does the politeness (rate,
 * retries). `state` is the adapter's own resumable cursor, kept by the copier:
 *   { types: { ukpga: { year: 1996, page: 3, done: false } },
 *     listed: ['ukpga/1996/18\tEmployment Rights Act 1996', …], next: 0 }
 */
export async function* documents({
  types,
  fetchText,
  state,
  log,
  firstYear = FIRST_YEAR,
  concurrency = 1,
}) {
  state.types ??= {}
  state.listed ??= []
  state.next ??= 0
  const lastYear = new Date().getUTCFullYear()
  const known = new Set(state.listed.map((l) => l.split('\t')[0]))
  for (const type of types) {
    if (!TYPES[type]) throw new Error(`legislation.gov.uk: unknown type ${type}`)
    let t = state.types[type]
    // A cursor from the earlier one-feed listing has no year: list again (items
    // already listed are kept once).
    if (!t || t.year === undefined)
      t = state.types[type] = { year: firstYear, page: 1, done: false }
    while (!t.done) {
      const xml = await fetchText(feedUrl(type, t.year, t.page))
      const { items, morePages } = xml === null ? { items: [], morePages: 0 } : parseFeed(xml)
      let added = 0
      for (const it of items) {
        const key = `${it.type}/${it.path}`
        if (known.has(key)) continue
        known.add(key)
        state.listed.push(`${key}\t${it.year ?? ''}\t${it.title}`)
        added++
      }
      if (items.length)
        log('library_import_listed', {
          type,
          year: t.year,
          page: t.page,
          items: items.length,
          added,
          listedSoFar: state.listed.length,
        })
      if (items.length && morePages > 0) t.page++
      else if (t.year >= lastYear) t.done = true
      else {
        t.year++
        t.page = 1
      }
    }
  }
  // Fetch a few items ahead at once (the copier's fetchText keeps the polite
  // spacing between request starts); yield them in order. A skipped item is
  // yielded as null so the copier can save the cursor during a long stretch.
  const inFlight = []
  const fetchItem = (index) => {
    const fields = state.listed[index].split('\t')
    // Two-field entries come from the earlier listing: path and title.
    const [key, year, title] = fields.length === 2 ? [fields[0], '', fields[1]] : fields
    const type = key.slice(0, key.indexOf('/'))
    const path = key.slice(key.indexOf('/') + 1)
    const item = {
      type,
      path,
      year: Number(year) || Number(path.match(/^(\d{4})\//)?.[1]) || null,
      title,
    }
    return { key, item, xml: fetchText(textUrl(type, path)) }
  }
  let ahead = state.next
  while (state.next < state.listed.length) {
    while (inFlight.length < Math.max(1, concurrency) && ahead < state.listed.length)
      inFlight.push(fetchItem(ahead++))
    const { key, item, xml: pending } = inFlight.shift()
    const xml = await pending
    state.next++
    if (xml === null) {
      log('library_import_missing', { path: key })
      yield null
      continue
    }
    const text = clmlToText(xml)
    if (!text) {
      log('library_import_empty', { path: key })
      yield null
      continue
    }
    yield { ...clmlMetadata(xml, item), text, when_scraped: new Date().toISOString() }
  }
}
