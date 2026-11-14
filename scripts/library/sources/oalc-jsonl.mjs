// Source adapter: an Open Australian Legal Corpus release published as one
// JSON Lines file on Hugging Face (one document per line, the Corpus's own
// fields, which are the library's fields). A collection names the release's
// file and which of its sources to take; every other line is passed over
// without being parsed. The file is read as a stream, never stored.

import { Readable } from 'node:stream'
import { createInterface } from 'node:readline'

export const SOURCE_PREFIX = 'oalc'
const HUB = process.env.LIBRARY_SOURCE_BASE || 'https://huggingface.co'
const TYPES = new Set(['decision', 'primary_legislation', 'secondary_legislation', 'bill'])

/** One Corpus line to the library's document, or a reason it is passed over. */
export function toDocument(row) {
  const text = (row.text ?? '').trim()
  if (text.length < 200) return { skip: 'no_text' }
  if (!TYPES.has(row.type)) return { skip: 'unknown_type' }
  if (!row.version_id || !row.jurisdiction || !row.source) return { skip: 'missing_fields' }
  return {
    version_id: String(row.version_id),
    type: row.type,
    jurisdiction: row.jurisdiction,
    source: row.source,
    date: row.date ? String(row.date).slice(0, 10) : null,
    citation: (row.citation ?? '').trim() || String(row.version_id),
    url: row.url || '',
    text,
    when_scraped: row.when_scraped ? new Date(row.when_scraped).toISOString() : new Date().toISOString(),
  }
}

/**
 * Yields the documents of the named sources, in file order.
 * `state`: { line: 1234 } — lines already dealt with; a resumed run reads the
 * stream again and passes over that many.
 */
export async function* documents({ repo, file = 'corpus.jsonl', sources, state, log }) {
  state.line ??= 0
  const wanted = new RegExp(`"source":\\s*"(${sources.join('|')})"`)
  const url = `${HUB}/datasets/${repo}/resolve/main/${file}`
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
  log('library_import_listed', { file: `${repo}/${file}`, sources, from: state.line })
  const lines = createInterface({ input: Readable.fromWeb(response.body), crlfDelay: Infinity })
  let n = 0
  for await (const line of lines) {
    n++
    if (n <= state.line) continue
    state.line = n
    // The source is among a line's first fields; look there, and parse only a line that is wanted.
    if (!wanted.test(line.slice(0, 2000))) continue
    const doc = toDocument(JSON.parse(line))
    if (doc.skip) {
      log('library_import_skipped', { path: `line ${n}`, reason: doc.skip })
      yield null
      continue
    }
    yield doc
  }
  log('library_import_stream_end', { lines: n })
}
