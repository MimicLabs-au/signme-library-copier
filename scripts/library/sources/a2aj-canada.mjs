// Source adapter: the A2AJ Canadian datasets on Hugging Face
// (a2aj/canadian-case-law and a2aj/canadian-laws; Access to Algorithmic
// Justice, Osgoode Hall Law School and Lincoln Alexander School of Law). The
// datasets are MIT-licensed; every document also carries its publisher's own
// terms in `upstream_license`, and some publishers limit commercial use. So a
// collection names exactly which courts, tribunals and law sets it takes, and
// only ones whose terms were read and allow SignMe's use are listed
// (scripts/library/licences/a2aj-canada.md says which and why).
//
// Each set is one Parquet file. It is downloaded to a temporary file, then
// read in batches by row number, so a run can stop and resume mid-file.
// English texts only; a document with no English text is passed over.

import { createWriteStream } from 'node:fs'
import { mkdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { DuckDBInstance } from '@duckdb/node-api'

export const SOURCE_PREFIX = 'a2aj_ca'
const HUB = process.env.LIBRARY_SOURCE_BASE || 'https://huggingface.co'

/** Every set this adapter can read: its repository, the jurisdiction and
 *  source SignMe records, and the kind of document. A collection picks from
 *  these by code. */
export const SETS = {
  // Federally constituted courts and tribunals: Reproduction of Federal Law Order.
  FC: { repo: 'canadian-case-law', jurisdiction: 'canada_federal', source: 'federal_court_canada', type: 'decision' },
  FCA: { repo: 'canadian-case-law', jurisdiction: 'canada_federal', source: 'federal_court_of_appeal_canada', type: 'decision' },
  TCC: { repo: 'canadian-case-law', jurisdiction: 'canada_federal', source: 'tax_court_of_canada', type: 'decision' },
  SST: { repo: 'canadian-case-law', jurisdiction: 'canada_federal', source: 'social_security_tribunal_canada', type: 'decision' },
  FPSLREB: { repo: 'canadian-case-law', jurisdiction: 'canada_federal', source: 'federal_public_sector_labour_board', type: 'decision' },
  CHRT: { repo: 'canadian-case-law', jurisdiction: 'canada_federal', source: 'canadian_human_rights_tribunal', type: 'decision' },
  CIRB: { repo: 'canadian-case-law', jurisdiction: 'canada_federal', source: 'canada_industrial_relations_board', type: 'decision' },
  OHSTC: { repo: 'canadian-case-law', jurisdiction: 'canada_federal', source: 'occupational_health_safety_tribunal_canada', type: 'decision' },
  CT: { repo: 'canadian-case-law', jurisdiction: 'canada_federal', source: 'competition_tribunal_canada', type: 'decision' },
  // More federally constituted tribunals and a federal court, same Order (added 13 Nov 2026).
  RAD: { repo: 'canadian-case-law', jurisdiction: 'canada_federal', source: 'refugee_appeal_division_canada', type: 'decision' },
  RPD: { repo: 'canadian-case-law', jurisdiction: 'canada_federal', source: 'refugee_protection_division_canada', type: 'decision' },
  RLLR: { repo: 'canadian-case-law', jurisdiction: 'canada_federal', source: 'refugee_law_lab_reporter', type: 'decision' },
  CITT: { repo: 'canadian-case-law', jurisdiction: 'canada_federal', source: 'canadian_international_trade_tribunal', type: 'decision' },
  TMOB: { repo: 'canadian-case-law', jurisdiction: 'canada_federal', source: 'trademarks_opposition_board_canada', type: 'decision' },
  TATC: { repo: 'canadian-case-law', jurisdiction: 'canada_federal', source: 'transportation_appeal_tribunal_canada', type: 'decision' },
  CART: { repo: 'canadian-case-law', jurisdiction: 'canada_federal', source: 'canada_agricultural_review_tribunal', type: 'decision' },
  CMAC: { repo: 'canadian-case-law', jurisdiction: 'canada_federal', source: 'court_martial_appeal_court_canada', type: 'decision' },
  SCT: { repo: 'canadian-case-law', jurisdiction: 'canada_federal', source: 'specific_claims_tribunal_canada', type: 'decision' },
  PSDPT: { repo: 'canadian-case-law', jurisdiction: 'canada_federal', source: 'public_servants_disclosure_protection_tribunal', type: 'decision' },
  // Ontario Landlord and Tenant Board orders: Open Government Licence – Ontario.
  ONLTB: { repo: 'canadian-case-law', jurisdiction: 'ontario', source: 'ontario_landlord_and_tenant_board', type: 'decision' },
  // Provincial legislation whose King's Printer permits reproduction.
  'LEGISLATION-ON': { repo: 'canadian-laws', jurisdiction: 'ontario', source: 'ontario_e_laws', type: 'primary_legislation' },
  'REGULATIONS-ON': { repo: 'canadian-laws', jurisdiction: 'ontario', source: 'ontario_e_laws', type: 'secondary_legislation' },
  'LEGISLATION-BC': { repo: 'canadian-laws', jurisdiction: 'british_columbia', source: 'bc_laws', type: 'primary_legislation' },
  'REGULATIONS-BC': { repo: 'canadian-laws', jurisdiction: 'british_columbia', source: 'bc_laws', type: 'secondary_legislation' },
  'LEGISLATION-AB': { repo: 'canadian-laws', jurisdiction: 'alberta', source: 'alberta_kings_printer', type: 'primary_legislation' },
  'REGULATIONS-AB': { repo: 'canadian-laws', jurisdiction: 'alberta', source: 'alberta_kings_printer', type: 'secondary_legislation' },
}

export const fileUrl = (repo, code) => `${HUB}/datasets/a2aj/${repo}/resolve/main/${code}/train.parquet`

/** A stable id from the citation ("2020 FC 5" → "2020-FC-5"), else the URL's tail. */
export function documentId(code, citation, url) {
  const base = (citation || '').trim() || (url || '').replace(/^https?:\/\//, '')
  return `${SOURCE_PREFIX}:${code}/${base.replace(/[^\p{L}\p{N}.]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 160)}`
}

/** One dataset row to SignMe's document, or a reason it is passed over. */
export function toDocument(code, row) {
  const set = SETS[code]
  const text = (row.text ?? '').trim()
  if (text.length < 200) return { skip: 'no_english_text' }
  // Belt and braces: a set is listed only after its terms were read, but a
  // row whose own licence says non-commercial is never taken.
  if (/by-nc|non-?commercial use only/i.test(row.licence ?? '')) return { skip: 'non_commercial_licence' }
  const name = (row.name ?? '').trim()
  const citation = (row.citation ?? '').trim()
  return {
    version_id: documentId(code, citation, row.url),
    type: set.type,
    jurisdiction: set.jurisdiction,
    source: set.source,
    date: row.date ? String(row.date).slice(0, 10) : null,
    citation: name && citation && !name.includes(citation) ? `${name}, ${citation}` : name || citation || code,
    url: row.url || `${HUB}/datasets/a2aj/${set.repo}`,
    text,
    when_scraped: row.scraped ? new Date(row.scraped).toISOString() : new Date().toISOString(),
  }
}

async function download(url, path, log) {
  const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(30 * 60_000) })
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
  await pipeline(Readable.fromWeb(response.body), createWriteStream(path))
  log('library_import_downloaded', { url: url.replace(HUB, ''), bytes: (await stat(path)).size })
}

/**
 * Yields the documents of the collection's sets, one set at a time.
 * `state`: { sets: { FC: { next: 1200, rows: 36141, done: false } } }.
 */
export async function* documents({ sets, state, log, batch = 2000 }) {
  state.sets ??= {}
  const work = join(tmpdir(), `a2aj-${process.pid}`)
  await mkdir(work, { recursive: true })
  const db = await (await DuckDBInstance.create(':memory:')).connect()
  for (const code of sets) {
    const set = SETS[code]
    if (!set) throw new Error(`a2aj-canada: unknown set ${code}`)
    const s = (state.sets[code] ??= { next: 0, rows: null, done: false })
    if (s.done) continue
    const path = join(work, `${code}.parquet`)
    await download(fileUrl(set.repo, code), path, log)
    const urlColumn = set.repo === 'canadian-laws' ? 'source_url_en' : 'url_en'
    s.rows = Number((await db.runAndReadAll(`select count(*) from read_parquet('${path}')`)).getRows()[0][0])
    log('library_import_listed', { set: code, items: s.rows, from: s.next })
    while (s.next < s.rows) {
      const rows = (
        await db.runAndReadAll(`
          select citation_en, name_en, cast(document_date_en as varchar), ${urlColumn},
                 cast(scraped_timestamp_en as varchar), unofficial_text_en, upstream_license
          from read_parquet('${path}', file_row_number = true)
          where file_row_number >= ${s.next} and file_row_number < ${s.next + batch}
          order by file_row_number`)
      ).getRows()
      for (const [citation, name, date, url, scraped, text, licence] of rows) {
        s.next++
        const doc = toDocument(code, { citation, name, date, url, scraped, text, licence })
        if (doc.skip) {
          log('library_import_skipped', { path: `${code}/${s.next - 1}`, reason: doc.skip })
          yield null
          continue
        }
        yield doc
      }
      if (!rows.length) break
    }
    s.done = true
    await rm(path, { force: true })
  }
  await rm(work, { recursive: true, force: true })
}
