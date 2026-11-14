#!/usr/bin/env node
// Runs the same everyday Australian questions against two builds of the
// Australian index (the live one and a candidate) the way the app searches,
// and prints the top documents of each side by side. Read-only.
import * as lancedb from '@lancedb/lancedb'

const SIDES = {
  live: 'au/open-australian-legal-corpus/7.1.0/20261106T003310Z',
  candidate: process.env.CANDIDATE || 'au/open-australian-legal-corpus/7.2.0/20261114T012559Z',
}
const LEG = "type IN ('primary_legislation', 'secondary_legislation')"
const DEC = "type = 'decision'"
const CASES = [
  ['NSW tenancy law', LEG, ['commonwealth', 'new_south_wales'], 'notice of termination residential tenancy'],
  ['NSW unfair dismissal decisions', DEC, ['commonwealth', 'new_south_wales'], 'unfair dismissal small business redundancy'],
  ['Consumer guarantee decisions (federal)', DEC, ['commonwealth'], 'consumer guarantee acceptable quality refund'],
  ['Queensland bond law', LEG, ['commonwealth', 'queensland'], 'rental bond refund'],
  ['Fair Work notice of termination', LEG, ['commonwealth'], 'notice of termination employment minimum period'],
  ['ACT tenancy law', LEG, ['commonwealth', 'australian_capital_territory'], 'residential tenancy termination notice'],
  ['NT tenancy law', LEG, ['commonwealth', 'northern_territory'], 'residential tenancy security deposit'],
  ['No state named: lease law', LEG, null, 'residential tenancy bond'],
]
const quote = (s) => `'${String(s).replace(/'/g, "''")}'`
const tables = {}
for (const [side, path] of Object.entries(SIDES)) {
  const db = await lancedb.connect(`s3://library/catalogue/${path}`, {
    storageOptions: {
      endpoint: process.env.LIBRARY_S3_ENDPOINT,
      region: 'ap-southeast-2',
      aws_access_key_id: process.env.LIBRARY_S3_ACCESS_KEY_ID,
      aws_secret_access_key: process.env.LIBRARY_S3_SECRET_ACCESS_KEY,
      virtual_hosted_style_request: 'false',
    },
  })
  tables[side] = { passages: await db.openTable('passages'), documents: await db.openTable('documents') }
  console.log(JSON.stringify({ side, path, documents: await tables[side].documents.countRows(), passages: await tables[side].passages.countRows() }))
}
for (const [label, kind, jurisdictions, query] of CASES) {
  const filters = [kind]
  if (jurisdictions) filters.push(`jurisdiction IN (${jurisdictions.map(quote).join(', ')})`)
  const out = { label, query }
  for (const side of Object.keys(SIDES)) {
    const t = Date.now()
    const { passages, documents } = tables[side]
    const ranked = await passages.search(query, 'fts').where(filters.join(' AND ')).limit(150).select(['version_id', 'seq']).toArray()
    const ids = [...new Set(ranked.map((r) => String(r.version_id)))].slice(0, 5)
    const top = []
    for (const id of ids) {
      const [d] = await documents.query().where(`version_id = ${quote(id)}`).limit(1).toArray()
      top.push(`${String(d?.citation ?? id).slice(0, 90)} [${d?.jurisdiction}; ${d?.date ?? ''}]`)
    }
    out[side] = { ms: Date.now() - t, top }
  }
  out.same = JSON.stringify(out.live.top) === JSON.stringify(out.candidate.top)
  console.log(JSON.stringify(out, null, 1))
}
