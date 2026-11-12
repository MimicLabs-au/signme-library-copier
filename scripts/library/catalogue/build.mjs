#!/usr/bin/env node
// Builds a search index (the catalogue) for one library collection, only ever
// from the vault, and stores it beside the vault in the `library` bucket.
// Step 3 of the library storage plan (claude/library-storage-plan-2026-11-05.md):
// the index is what a test compares with today's database search. Building it
// is also the read-back check of the vault: every vault file is downloaded and
// its SHA-256 compared with the manifest before anything is built.
//
//   LIBRARY_S3_ENDPOINT, LIBRARY_S3_REGION, LIBRARY_S3_ACCESS_KEY_ID,
//   LIBRARY_S3_SECRET_ACCESS_KEY            (as for scripts/library-vault.mjs)
//   node scripts/library/catalogue/build.mjs [--collection au/open-australian-legal-corpus/7.1.0]
//       [--work DIR] [--build-id ID] [--local-dir DIR] [--no-upload]
//
// Writes catalogue/<collection>/<build-id>/: a LanceDB database with two
// tables, `passages` (text plus the document fields searches filter on, with a
// full-text index on the text) and `documents` (with a full-text index on the
// title, for "inside this Act"), and `catalogue.json` describing the build.
// A build never replaces another: each has its own id. Reads the database not
// at all. Prints counts and sizes only, never text.

import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { tmpdir } from 'node:os'
import { GetObjectCommand, HeadObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'
import { DuckDBInstance } from '@duckdb/node-api'
import * as lancedb from '@lancedb/lancedb'

const BUCKET = 'library'
function arg(name) {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? undefined : process.argv[i + 1]
}
const flag = (name) => process.argv.includes(`--${name}`)
const log = (event, fields = {}) => console.log(JSON.stringify({ event, ...fields }))
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

const collection = arg('collection') || 'au/open-australian-legal-corpus/7.1.0'
const buildId = arg('build-id') || new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z'
const work = arg('work') || join(tmpdir(), `library-catalogue-${process.pid}`)
const vaultPrefix = `vault/${collection}/`
const outPrefix = `catalogue/${collection}/${buildId}/`
const MAX_UPLOAD_BYTES = Number(process.env.LIBRARY_MAX_UPLOAD_MB || 50) * 1024 * 1024

// ---------------------------------------------------------------- storage

let s3
function client() {
  if (s3) return s3
  for (const n of [
    'LIBRARY_S3_ENDPOINT',
    'LIBRARY_S3_ACCESS_KEY_ID',
    'LIBRARY_S3_SECRET_ACCESS_KEY',
  ])
    if (!process.env[n]) {
      console.error(`Missing ${n} (or pass --local-dir DIR).`)
      process.exit(2)
    }
  s3 = new S3Client({
    endpoint: process.env.LIBRARY_S3_ENDPOINT,
    region: process.env.LIBRARY_S3_REGION || 'ap-southeast-2',
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.LIBRARY_S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.LIBRARY_S3_SECRET_ACCESS_KEY,
    },
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    maxAttempts: 5,
  })
  return s3
}
const local = arg('local-dir')
async function get(key) {
  if (local) return readFile(join(local, BUCKET, key))
  const r = await client().send(new GetObjectCommand({ Bucket: BUCKET, Key: key }))
  return Buffer.from(await r.Body.transformToByteArray())
}
async function exists(key) {
  if (local)
    return stat(join(local, BUCKET, key)).then(
      () => true,
      () => false,
    )
  try {
    await client().send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }))
    return true
  } catch (e) {
    if (e?.$metadata?.httpStatusCode === 404 || e?.name === 'NotFound') return false
    throw e
  }
}
async function put(key, path, bytes) {
  if (local) {
    await mkdir(dirname(join(local, BUCKET, key)), { recursive: true })
    await writeFile(join(local, BUCKET, key), await readFile(path))
    return
  }
  await new Upload({
    client: client(),
    params: { Bucket: BUCKET, Key: key, Body: createReadStream(path), ContentLength: bytes },
    partSize: 16 * 1024 * 1024,
    queueSize: 4,
  }).done()
}

// ---------------------------------------------------------------- 1. read the vault back

const manifest = JSON.parse((await get(vaultPrefix + 'manifest.json')).toString('utf8'))
const manifestSha = sha256(Buffer.from(JSON.stringify(manifest)))
await mkdir(join(work, 'vault'), { recursive: true })
let checkedBytes = 0
for (const file of manifest.files) {
  const body = await get(vaultPrefix + file.path)
  if (body.length !== file.bytes || sha256(body) !== file.sha256)
    throw new Error(`vault file ${file.path} does not match its manifest entry; not building`)
  const path = join(work, 'vault', file.path)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, body)
  checkedBytes += body.length
}
log('library_catalogue_vault_checked', { files: manifest.files.length, bytes: checkedBytes })

// ---------------------------------------------------------------- 2. build the tables

const duck = await (await DuckDBInstance.create(':memory:')).connect()
const docsPath = join(work, 'vault', 'documents.parquet')
await duck.run(
  `create table docs as select version_id, type, jurisdiction, source,
     coalesce(strftime(date, '%Y-%m-%d'), '') as date, citation, url
   from read_parquet('${docsPath}')`,
)
const rowsOf = async (sql) => {
  const reader = await duck.runAndReadAll(sql)
  return reader.getRowObjectsJS()
}

const dbDir = join(work, 'catalogue')
await rm(dbDir, { recursive: true, force: true })
const db = await lancedb.connect(dbDir)

const documents = await rowsOf('select * from docs order by version_id')
const docTable = await db.createTable('documents', documents)
log('library_catalogue_documents', { rows: documents.length })

let passagesTable,
  passages = 0
const parts = manifest.files.filter((f) => f.path.startsWith('passages/'))
for (const part of parts) {
  const rows = await rowsOf(
    `select p.version_id, p.seq, coalesce(p.heading, '') as heading, p.text,
            d.type, d.jurisdiction, d.source, d.date, d.citation, d.url
       from read_parquet('${join(work, 'vault', part.path)}') p
       join docs d using (version_id)`,
  )
  if (rows.length !== part.rows)
    throw new Error(
      `${part.path}: ${rows.length} rows joined to documents, manifest says ${part.rows}`,
    )
  if (!passagesTable) passagesTable = await db.createTable('passages', rows)
  else await passagesTable.add(rows)
  passages += rows.length
  await rm(join(work, 'vault', part.path))
}
if (passages !== manifest.counts.passages)
  throw new Error(`built ${passages} passages, the vault manifest says ${manifest.counts.passages}`)
log('library_catalogue_passages', { rows: passages, parts: parts.length })

// One fragment per vault part is fine to search but slow to open; compact first.
await passagesTable.optimize({ cleanupOlderThan: new Date() })

const fts = {
  baseTokenizer: 'simple',
  language: 'English',
  stem: true,
  removeStopWords: true,
  lowercase: true,
  asciiFolding: true,
  withPosition: false,
}
let t = Date.now()
await passagesTable.createIndex('text', { config: lancedb.Index.fts(fts) })
log('library_catalogue_index', { index: 'passages.text fts', ms: Date.now() - t })
for (const column of ['type', 'jurisdiction', 'source']) {
  t = Date.now()
  await passagesTable.createIndex(column, { config: lancedb.Index.bitmap() })
  log('library_catalogue_index', { index: `passages.${column} bitmap`, ms: Date.now() - t })
}
await passagesTable.createIndex('version_id', { config: lancedb.Index.btree() })
await docTable.createIndex('citation', { config: lancedb.Index.fts(fts) })
await docTable.createIndex('version_id', { config: lancedb.Index.btree() })
// Keep only the final version of each table: older versions are not needed in a build.
for (const table of [passagesTable, docTable])
  await table.optimize({ cleanupOlderThan: new Date() })

// ---------------------------------------------------------------- 3. describe and store

const files = []
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) await walk(path)
    else files.push({ path, rel: relative(dbDir, path), bytes: (await stat(path)).size })
  }
}
await walk(dbDir)
const totalBytes = files.reduce((n, f) => n + f.bytes, 0)
const largest = [...files].sort((a, b) => b.bytes - a.bytes).slice(0, 5)
log('library_catalogue_built', {
  files: files.length,
  bytes: totalBytes,
  largest: largest.map((f) => ({ file: f.rel, bytes: f.bytes })),
})

const description = {
  format: 'signme-library-catalogue/1',
  collection,
  buildId,
  engine: { name: 'lancedb', version: '0.41.0' },
  builtFrom: {
    vault: vaultPrefix,
    manifestSha256: manifestSha,
    commit: process.env.GITHUB_SHA || null,
  },
  built: new Date().toISOString(),
  tables: {
    passages: {
      rows: passages,
      indexes: {
        text: { fts },
        type: 'bitmap',
        jurisdiction: 'bitmap',
        source: 'bitmap',
        version_id: 'btree',
      },
    },
    documents: { rows: documents.length, indexes: { citation: { fts }, version_id: 'btree' } },
  },
  files: files.map(({ rel, bytes }) => ({ path: rel, bytes })),
  bytes: totalBytes,
}

if (flag('no-upload')) {
  await writeFile(join(work, 'catalogue.json'), JSON.stringify(description, null, 2))
  log('library_catalogue_complete', { uploaded: false, work })
  process.exit(0)
}
const tooBig = files.filter((f) => f.bytes > MAX_UPLOAD_BYTES)
if (tooBig.length)
  throw new Error(
    `${tooBig.length} catalogue file(s) are over the ${MAX_UPLOAD_BYTES / 1048576} MB upload limit (largest ${largest[0].bytes} bytes). Raise the storage upload limit (Supabase → Storage → Settings) and LIBRARY_MAX_UPLOAD_MB; nothing was uploaded.`,
  )
if (await exists(outPrefix + 'catalogue.json'))
  throw new Error(`${outPrefix} already exists; not replacing a build`)
let sent = 0
for (const f of files) {
  await put(outPrefix + f.rel, f.path, f.bytes)
  sent += f.bytes
}
const descPath = join(work, 'catalogue.json')
await writeFile(descPath, JSON.stringify(description, null, 2) + '\n')
await put(outPrefix + 'catalogue.json', descPath, (await stat(descPath)).size)
log('library_catalogue_complete', {
  uploaded: true,
  to: outPrefix,
  files: files.length + 1,
  bytes: sent,
})
// The work folder may be a mount the runner owns (library-catalogue.yml
// gives it the second disk); emptying it matters, removing it does not.
await rm(work, { recursive: true, force: true }).catch(() => {})
