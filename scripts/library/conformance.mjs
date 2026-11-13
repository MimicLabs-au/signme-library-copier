#!/usr/bin/env node
// Checks every collection in the registry against docs/LIBRARY-STANDARD.md and
// writes the due-diligence register (docs/REGISTER.md) from it. Run before any
// import or index build; a collection that fails is not copied.
//
//   node scripts/library/conformance.mjs            check, exit 1 on any failure
//   node scripts/library/conformance.mjs --write    also rewrite docs/REGISTER.md
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { collections } from './collections.mjs'

const STATUSES = ['planned', 'vaulted', 'live', 'superseded']
const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)

/** The problems with one registry entry; empty when it conforms. */
export function problems(key, c, { fileExists = existsSync, read = readFileSync } = {}) {
  const out = []
  const need = (ok, what) => ok || out.push(what)
  const parts = key.split('/')
  need(parts.length === 3, 'key is country/collection/version')
  need(/^[a-z]{2}$/.test(c.country ?? ''), 'country is a two-letter code')
  need(/^[a-z0-9]+(-[a-z0-9]+)*$/.test(c.collection ?? ''), 'collection is lower-case words joined by hyphens')
  need(/^[a-z0-9][a-z0-9.-]*$/.test(c.version ?? ''), 'version is set')
  need(key === `${c.country}/${c.collection}/${c.version}`, 'key matches country, collection and version')
  for (const field of ['title', 'publisher', 'licence', 'attribution'])
    need(typeof c[field] === 'string' && c[field].trim().length > 0, `${field} is written out`)
  need(/^https:\/\//.test(c.sourceUrl ?? ''), 'sourceUrl is an https address')
  need(typeof c.licenceFile === 'string' && fileExists(c.licenceFile), 'licenceFile exists')
  if (typeof c.licenceFile === 'string' && fileExists(c.licenceFile))
    need(String(read(c.licenceFile, 'utf8')).trim().length > 200, 'licenceFile holds the terms, not a stub')
  need(isDate(c.termsReadOn), 'termsReadOn is the day the terms were read (YYYY-MM-DD)')
  need(STATUSES.includes(c.status), `status is one of ${STATUSES.join(', ')}`)
  need(c.collectedAsAt === null || c.collectedAsAt === undefined || isDate(c.collectedAsAt), 'collectedAsAt is a date or left to the manifest')
  if (c.source?.adapter)
    need(fileExists(`scripts/library/sources/${c.source.adapter}.mjs`), 'the source adapter exists')
  need(c.expected && typeof c.expected === 'object', 'expected says what the publisher states, or why it cannot')
  return out
}

/** The register: one row per collection, in the registry's order. */
export function register(all = collections) {
  const cell = (v) => String(v ?? '').replace(/\|/g, '/').replace(/\s+/g, ' ').trim()
  const rows = Object.entries(all).map(
    ([key, c]) =>
      `| \`${key}\` | ${cell(c.title)} | ${cell(c.publisher)} | [source](${c.sourceUrl}) | ${cell(c.licence)} | [terms kept](../${c.licenceFile}) | ${c.termsReadOn} | ${cell(c.attribution)} | ${c.status} |`,
  )
  return [
    '# Library register',
    '',
    'Written by `scripts/library/conformance.mjs --write` from `scripts/library/collections.mjs`. Do not edit by hand.',
    'One row per collection: who publishes it, the terms SignMe relies on, the copy of those terms kept beside the collection, the day they were read, and the credit shown.',
    '',
    '| Collection | Title | Publisher | Source | Licence relied on | Terms | Read on | Credit shown | Status |',
    '|---|---|---|---|---|---|---|---|---|',
    ...rows,
    '',
  ].join('\n')
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let failed = 0
  for (const [key, c] of Object.entries(collections)) {
    const found = problems(key, c)
    if (found.length) {
      failed++
      console.error(`${key}\n${found.map((p) => `  - ${p}`).join('\n')}`)
    }
  }
  if (process.argv.includes('--write')) writeFileSync('docs/REGISTER.md', register())
  else if (existsSync('docs/REGISTER.md') && readFileSync('docs/REGISTER.md', 'utf8') !== register()) {
    failed++
    console.error('docs/REGISTER.md is out of date: run node scripts/library/conformance.mjs --write')
  }
  console.log(JSON.stringify({ event: 'library_conformance', collections: Object.keys(collections).length, failed }))
  process.exit(failed ? 1 : 0)
}
