// Source adapter: tribunal decisions published on GOV.UK by HM Courts and
// Tribunals Service through a "finder" (a listing page with 50 decisions a
// page, each with its own page carrying the decision date, jurisdiction codes,
// country and the decision as a PDF or Word attachment). Open Government
// Licence v3.0. Finders this adapter knows:
//   employment-tribunal-decisions          (England, Wales and Scotland, Feb 2017 on)
//   residential-property-tribunal-decisions (First-tier Tribunal, Property Chamber)
// claude/library-uk-expansion-2026-11-09.md.
//
// Listing: the finder's HTML pages, newest first, by page number. Text: the
// first attachment, read with pdfjs (PDF) or mammoth (.docx); a legacy .doc
// is logged and skipped. Parties stay in the title as the publisher gives it
// (as in the Australian collection); SignMe describes parties by role when it
// answers. The publisher states decisions cannot be removed from GOV.UK.

import { decodeEntities } from './legislation-gov-uk.mjs'

export const BASE = process.env.LIBRARY_SOURCE_BASE || 'https://www.gov.uk'
// Attachments live on GOV.UK's asset host; tests point this at a local server.
const ASSETS = 'https://assets.publishing.service.gov.uk'
const assetUrl = (url) =>
  process.env.LIBRARY_ASSETS_BASE ? url.replace(ASSETS, process.env.LIBRARY_ASSETS_BASE) : url

export const FINDERS = {
  'employment-tribunal-decisions': {
    source: 'employment_tribunal',
    name: 'Employment Tribunal',
    type: 'decision',
  },
  'residential-property-tribunal-decisions': {
    source: 'first_tier_tribunal_property_chamber',
    name: 'First-tier Tribunal (Property Chamber)',
    type: 'decision',
  },
}

/** GOV.UK's country field to SignMe's jurisdiction codes. */
const COUNTRIES = {
  'england and wales': 'england_wales',
  england: 'england_wales',
  wales: 'england_wales',
  scotland: 'scotland',
  'northern ireland': 'northern_ireland',
}

export const listUrl = (finder, page) => `${BASE}/${finder}?page=${page}`
const strip = (html) =>
  decodeEntities(html.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()

/** The decision links on one listing page, in page order, and whether a
 *  further page exists. */
export function parseListing(html, finder) {
  const re = new RegExp(`href="(?:https?://www\\.gov\\.uk)?/${finder}/([a-z0-9][a-z0-9-]*)"`, 'g')
  const slugs = []
  const seen = new Set()
  for (const m of html.matchAll(re)) if (!seen.has(m[1])) (seen.add(m[1]), slugs.push(m[1]))
  const hasNext =
    new RegExp(
      `${finder}\\?[^"]*page=\\d+"[^>]*rel="next"|rel="next"[^>]*href="[^"]*${finder}\\?[^"]*page=\\d+`,
    ).test(html) || /Next page/i.test(html)
  const total = Number(
    (html.match(/([\d,]+)\s+(?:decisions|results)/i)?.[1] ?? '0').replace(/,/g, ''),
  )
  return { slugs, hasNext, total }
}

/** The metadata and attachment of one decision page. */
export function parseDecision(html, finder, slug) {
  const info = FINDERS[finder]
  const title = strip(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1] ?? slug)
  const field = (label) => {
    const m = html.match(
      new RegExp(`<dt[^>]*>\\s*${label}:?\\s*</dt>\\s*<dd[^>]*>([\\s\\S]*?)</dd>`, 'i'),
    )
    return m ? strip(m[1]) : null
  }
  const decisionDate = parseUkDate(field('Decision date') ?? field('Decided') ?? '')
  const codes = (field('Jurisdiction code') ?? field('Jurisdiction codes') ?? '')
    .split(/,|\band\b/)
    .map((c) => c.trim())
    .filter(Boolean)
  const country = (field('Country') ?? '').toLowerCase()
  const jurisdiction = COUNTRIES[country] ?? 'united_kingdom'
  const attachments = [
    ...html.matchAll(
      /href="(https:\/\/assets\.publishing\.service\.gov\.uk\/[^"]+\.(pdf|docx?|odt))"/gi,
    ),
  ].map((m) => ({
    url: decodeEntities(m[1]),
    kind: m[2].toLowerCase(),
  }))
  return {
    version_id: `${info.source}:${slug}`,
    type: info.type,
    jurisdiction,
    source: info.source,
    date: decisionDate,
    citation: title,
    url: `${BASE}/${finder}/${slug}`,
    codes,
    attachments,
  }
}

const MONTHS = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
}
export function parseUkDate(s) {
  const m = s.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/)
  if (!m || !MONTHS[m[2].toLowerCase()]) return null
  return `${m[3]}-${String(MONTHS[m[2].toLowerCase()]).padStart(2, '0')}-${m[1].padStart(2, '0')}`
}

// ---------------------------------------------------------------- attachments → text

let pdfjsPromise = null
async function pdfjs() {
  pdfjsPromise ??= import('pdfjs-dist/legacy/build/pdf.mjs')
  return pdfjsPromise
}

/** Plain text of a PDF: items on the same line joined with spaces, lines by
 *  vertical position, pages separated by a blank line. Scanned PDFs with no
 *  text layer come back empty and are skipped by the caller. */
export async function pdfToText(bytes) {
  const lib = await pdfjs()
  const task = lib.getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: true,
    isEvalSupported: false,
    disableFontFace: true,
  })
  const doc = await task.promise
  const pages = []
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p)
      const content = await page.getTextContent()
      const lines = []
      let lastY = null
      let line = []
      for (const item of content.items) {
        if (!('str' in item)) continue
        const y = Math.round(item.transform[5])
        if (lastY !== null && Math.abs(y - lastY) > 2) {
          lines.push(line.join(' '))
          line = []
        }
        if (item.str.trim()) line.push(item.str.trim())
        lastY = y
      }
      if (line.length) lines.push(line.join(' '))
      pages.push(lines.join('\n'))
      page.cleanup()
    }
  } finally {
    await task.destroy()
  }
  return pages
    .join('\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export async function docxToText(bytes) {
  const mammoth = await import('mammoth')
  const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) })
  return result.value.replace(/\n{3,}/g, '\n\n').trim()
}

// ---------------------------------------------------------------- the adapter

/**
 * Lists the finder's pages (newest first), then yields one decision at a time.
 * `fetchText(url)` and `fetchBytes(url)` come from the copier (polite, retried;
 * null on 404). `state`: { page, done, listed: [slug, …], next }.
 */
export async function* documents({
  finder,
  fetchText,
  fetchBytes,
  state,
  log,
  concurrency = 1,
  maxPages = Infinity,
}) {
  const info = FINDERS[finder]
  if (!info) throw new Error(`govuk-tribunal-decisions: unknown finder ${finder}`)
  state.page ??= 1
  state.done ??= false
  state.listed ??= []
  state.next ??= 0
  const known = new Set(state.listed)
  // Listing is incremental: a page is listed only when the fetch queue is
  // about to run dry, so a short run (a smoke test, a deadline) copies
  // decisions from the first minute rather than listing 2,700 pages first.
  const listMore = async () => {
    const html = await fetchText(listUrl(finder, state.page))
    const { slugs, hasNext, total } =
      html === null ? { slugs: [], hasNext: false, total: 0 } : parseListing(html, finder)
    let added = 0
    for (const s of slugs) if (!known.has(s)) (known.add(s), state.listed.push(s), added++)
    log('library_import_listed', {
      finder,
      page: state.page,
      items: slugs.length,
      added,
      listedSoFar: state.listed.length,
      publisherTotal: total || null,
    })
    if (!slugs.length || !hasNext) state.done = true
    else state.page++
  }
  const canList = () => !state.done && state.page <= maxPages
  const inFlight = []
  const start = (index) => {
    const slug = state.listed[index]
    return { slug, page: fetchText(`${BASE}/${finder}/${slug}`) }
  }
  let ahead = state.next
  for (;;) {
    while (canList() && state.listed.length - ahead < Math.max(1, concurrency) * 2) await listMore()
    if (state.next >= state.listed.length) break
    while (inFlight.length < Math.max(1, concurrency) && ahead < state.listed.length)
      inFlight.push(start(ahead++))
    const { slug, page } = inFlight.shift()
    const html = await page
    state.next++
    if (html === null) {
      log('library_import_missing', { path: slug })
      yield null
      continue
    }
    const meta = parseDecision(html, finder, slug)
    const attachment = meta.attachments.find((a) => a.kind === 'pdf') ?? meta.attachments[0]
    if (!attachment) {
      log('library_import_skipped', { path: slug, reason: 'no_attachment' })
      yield null
      continue
    }
    if (attachment.kind === 'doc' || attachment.kind === 'odt') {
      log('library_import_skipped', { path: slug, reason: `attachment_${attachment.kind}` })
      yield null
      continue
    }
    const bytes = await fetchBytes(assetUrl(attachment.url))
    if (bytes === null) {
      log('library_import_missing', { path: slug, attachment: true })
      yield null
      continue
    }
    let text = ''
    try {
      text = attachment.kind === 'pdf' ? await pdfToText(bytes) : await docxToText(bytes)
    } catch (error) {
      log('library_import_skipped', {
        path: slug,
        reason: 'unreadable',
        detail: String(error?.message).slice(0, 100),
      })
      yield null
      continue
    }
    if (text.length < 200) {
      log('library_import_skipped', { path: slug, reason: 'no_text_layer' })
      yield null
      continue
    }
    const { attachments, codes, ...rest } = meta
    // The jurisdiction codes (Unfair Dismissal, Breach of Contract, …) lead the
    // text as a labelled line, so a search on the area of law finds them.
    const head = codes.length ? `Jurisdiction codes: ${codes.join('; ')}\n\n` : ''
    yield { ...rest, text: head + text, when_scraped: new Date().toISOString() }
  }
}
