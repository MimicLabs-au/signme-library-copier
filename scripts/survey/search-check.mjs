#!/usr/bin/env node
// Runs everyday questions against the live library indexes the way the app
// does (full-text search on passages, filtered by kind and jurisdiction, best
// passage per document) and prints the top documents. Read-only.
import * as lancedb from '@lancedb/lancedb'

const BUILDS = {
  'au/open-australian-legal-corpus/7.1.0': '20261106T003310Z',
  'uk/legislation-gov-uk/2026-11-primary': '20261109T110505Z',
  'uk/legislation-gov-uk/2026-11-secondary': '20261112T005937Z',
  'uk/employment-tribunal-decisions/2026-11': '20261112T202034Z',
  'uk/residential-property-tribunal-decisions/2026-11': '20261112T005931Z',
  'ca/justice-laws-canada/2026-11-federal-en': '20261109T235020Z',
  'ca/a2aj-canadian-laws/2026-11': '20261113T000557Z',
  'ca/a2aj-canadian-case-law/2026-11': '20261113T001514Z',
}
const LEG = "type IN ('primary_legislation', 'secondary_legislation')"
const DEC = "type = 'decision'"
const CASES = [
  ['au', 'NSW tenant, landlord wants to end lease early', LEG, ['commonwealth', 'new_south_wales'], 'notice of termination residential tenancy'],
  ['au', 'NSW unfair dismissal decision', DEC, ['commonwealth', 'new_south_wales'], 'unfair dismissal small business redundancy'],
  ['uk', 'England tenant, deposit not protected', LEG, ['united_kingdom', 'england_wales', 'england'], 'tenancy deposit scheme penalty'],
  ['uk', 'England unfair dismissal qualifying period', DEC, null, 'unfair dismissal two years qualifying period'],
  ['uk', 'England service charge dispute', DEC, null, 'service charge reasonableness leaseholder'],
  ['uk', 'Statutory instrument: tenant fees', LEG, null, 'holding deposit prohibited payment'],
  ['ca', 'Ontario tenant, eviction for arrears', LEG, ['canada_federal', 'ontario'], 'notice of termination non-payment of rent'],
  ['ca', 'Ontario tenant, eviction for arrears: decisions', DEC, ['canada_federal', 'ontario'], 'eviction arrears of rent application landlord'],
  ['ca', 'BC tenant, security deposit', LEG, ['canada_federal', 'british_columbia'], 'security deposit return tenancy'],
  ['ca', 'Alberta employee, termination pay', LEG, ['canada_federal', 'alberta'], 'termination notice pay in lieu employee'],
  ['ca', 'Federal employee, unjust dismissal decision', DEC, ['canada_federal'], 'unjust dismissal Canada Labour Code'],
  ['ca', 'Employment insurance appeal decision', DEC, ['canada_federal'], 'employment insurance misconduct voluntary leaving'],
]
const tables = new Map()
async function open(collection) {
  if (!tables.has(collection)) {
    const db = await lancedb.connect(`s3://library/catalogue/${collection}/${BUILDS[collection]}`, {
      storageOptions: {
        endpoint: process.env.LIBRARY_S3_ENDPOINT,
        region: 'ap-southeast-2',
        aws_access_key_id: process.env.LIBRARY_S3_ACCESS_KEY_ID,
        aws_secret_access_key: process.env.LIBRARY_S3_SECRET_ACCESS_KEY,
        virtual_hosted_style_request: 'false',
      },
    })
    tables.set(collection, { passages: await db.openTable('passages'), documents: await db.openTable('documents') })
  }
  return tables.get(collection)
}
const quote = (s) => `'${String(s).replace(/'/g, "''")}'`
for (const [country, label, kind, jurisdictions, query] of CASES) {
  const filters = [kind]
  if (jurisdictions) filters.push(`jurisdiction IN (${jurisdictions.map(quote).join(', ')})`)
  const merged = []
  const t = Date.now()
  for (const collection of Object.keys(BUILDS).filter((c) => c.startsWith(`${country}/`))) {
    try {
      const { passages, documents } = await open(collection)
      const ranked = await passages.search(query, 'fts').where(filters.join(' AND ')).limit(150).select(['version_id', 'seq']).toArray()
      const seen = new Set()
      for (const r of ranked) {
        if (seen.has(r.version_id)) continue
        seen.add(r.version_id)
        merged.push({ collection, versionId: String(r.version_id), score: r._score ?? 0 })
        if (seen.size >= 6) break
      }
    } catch (error) {
      console.log(JSON.stringify({ label, collection, error: String(error?.message).slice(0, 200) }))
    }
  }
  merged.sort((a, b) => b.score - a.score)
  const top = []
  for (const m of merged.slice(0, 5)) {
    const { documents } = await open(m.collection)
    const [d] = await documents.query().where(`version_id = ${quote(m.versionId)}`).limit(1).toArray()
    top.push(`${(d?.citation ?? m.versionId).slice(0, 110)} [${d?.jurisdiction}; ${d?.date ?? ''}]`)
  }
  console.log(JSON.stringify({ label, query, ms: Date.now() - t, hits: merged.length, top }, null, 1))
}
