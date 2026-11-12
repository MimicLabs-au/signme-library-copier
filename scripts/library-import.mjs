#!/usr/bin/env node
// Copies a library collection into the vault from its publisher's source
// files: the copier for every collection after the first (the first was copied
// from the database tables by scripts/library-vault.mjs, since dropped).
// docs/SPEC.md, "Sources: The library"; claude/library-uk-expansion-2026-11-09.md.
//
//   LIBRARY_S3_ENDPOINT=https://<ref>.storage.supabase.co/storage/v1/s3
//   LIBRARY_S3_REGION=ap-southeast-2
//   LIBRARY_S3_ACCESS_KEY_ID=... LIBRARY_S3_SECRET_ACCESS_KEY=...
//   node scripts/library-import.mjs --collection uk/legislation-gov-uk/2026-11
//       [--deadline ISO-TIME] [--max-documents N] [--part-mb 80] [--rate-ms 300]
//       [--local-dir DIR] [--source-dir DIR] [--concurrency 3]
//
// --source-dir is for adapters that read the publisher's files from a local
// checkout (justice-laws-canada) rather than from its website.
//
// Same vault format as library-vault.mjs (signme-library-vault/1):
//   documents.parquet, passages/part-*.parquet, LICENCE.md, manifest.json last.
// The source adapter (scripts/library/sources/<name>.mjs) lists and fetches
// documents; this script splits them into passages (scripts/corpus/chunk.mjs),
// writes the parts, keeps a resumable cursor in _progress.json and stages the
// document rows in _staging/ until the manifest is written. Never overwrites a
// vault file. Prints counts only, never document text.

import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, writeFile, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { DuckDBInstance } from '@duckdb/node-api'
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { collections } from './library/collections.mjs'
import { chunkDocument } from './corpus/chunk.mjs'

const FORMAT = 'signme-library-vault/1'
const BUCKET = 'library'

function arg(name) {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? undefined : process.argv[i + 1]
}
const log = (event, fields = {}) => console.log(JSON.stringify({ event, ...fields }))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

const collectionKey = arg('collection')
const collection = collections[collectionKey]
if (!collection) {
  console.error(`--collection is required. Known: ${Object.keys(collections).join(', ')}`)
  process.exit(2)
}
if (!collection.source?.adapter) {
  console.error(`${collectionKey} has no source adapter; nothing to copy from.`)
  process.exit(2)
}
const prefix = `vault/${collectionKey}/`
const deadline = arg('deadline') ? Date.parse(arg('deadline')) : NaN
if (arg('deadline') && Number.isNaN(deadline)) {
  console.error('--deadline must be an ISO time, e.g. 2026-11-10T17:20:00Z')
  process.exit(2)
}
const maxDocuments = Number(arg('max-documents') || 0) || Infinity
const PART_BYTES = Number(arg('part-mb') || 80) * 1024 * 1024
const MAX_UPLOAD_BYTES = Number(process.env.LIBRARY_MAX_UPLOAD_MB || 45) * 1024 * 1024
const RATE_MS = Number(arg('rate-ms') || collection.source.rateMs || 300)
const pastDeadline = () => !Number.isNaN(deadline) && Date.now() >= deadline

// ---------------------------------------------------------------- storage (as library-vault.mjs)

function s3Store() {
  const need = ['LIBRARY_S3_ENDPOINT', 'LIBRARY_S3_ACCESS_KEY_ID', 'LIBRARY_S3_SECRET_ACCESS_KEY']
  const missing = need.filter((n) => !process.env[n])
  if (missing.length) {
    console.error(`Missing ${missing.join(', ')} (or pass --local-dir DIR for a local copy).`)
    process.exit(2)
  }
  const s3 = new S3Client({
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
  const missingObject = (e) =>
    e?.$metadata?.httpStatusCode === 404 || e?.name === 'NotFound' || e?.name === 'NoSuchKey'
  return {
    where: `storage bucket ${BUCKET}`,
    async head(key) {
      try {
        const r = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }))
        return { bytes: Number(r.ContentLength) }
      } catch (e) {
        if (missingObject(e)) return null
        throw e
      }
    },
    async get(key) {
      try {
        const r = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }))
        return Buffer.from(await r.Body.transformToByteArray())
      } catch (e) {
        if (missingObject(e)) return null
        throw e
      }
    },
    async put(key, body, contentType) {
      await s3.send(
        new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: contentType }),
      )
    },
  }
}

function dirStore(root) {
  const path = (key) => join(root, BUCKET, key)
  return {
    where: `folder ${root}`,
    async head(key) {
      try {
        return { bytes: (await stat(path(key))).size }
      } catch {
        return null
      }
    },
    async get(key) {
      try {
        return await readFile(path(key))
      } catch {
        return null
      }
    },
    async put(key, body) {
      await mkdir(dirname(path(key)), { recursive: true })
      await writeFile(path(key), body)
    },
  }
}

const store = arg('local-dir') ? dirStore(arg('local-dir')) : s3Store()

async function putOnce(key, body, contentType) {
  const digest = sha256(body)
  const existing = await store.head(prefix + key)
  if (existing) {
    const there = await store.get(prefix + key)
    if (there && sha256(there) === digest) return { path: key, bytes: body.length, sha256: digest }
    throw new Error(`${key} is already in the vault with different content; not overwriting`)
  }
  await store.put(prefix + key, body, contentType)
  const check = await store.head(prefix + key)
  if (!check || check.bytes !== body.length)
    throw new Error(`${key} did not arrive whole (${check?.bytes ?? 0} of ${body.length} bytes)`)
  return { path: key, bytes: body.length, sha256: digest }
}

// ---------------------------------------------------------------- the publisher's site

/** Fetches a URL as text at a polite rate; null when the publisher has no
 *  document there (404, 410, or 300 "multiple choices" for an ambiguous
 *  address); retries on 429/5xx and network errors with a growing wait. A
 *  URL that still fails after the retries is given up on and counted, so one
 *  bad address cannot end a run of thousands; the count goes in the manifest.
 *  The source is untrusted input: only its text is kept, never its headers
 *  or any redirect target. */
let lastRequest = 0
let fetchFailures = 0
const MAX_FETCH_FAILURES = Number(process.env.LIBRARY_MAX_FETCH_FAILURES || 50)
// Tests shorten the wait between retries.
const RETRY_BASE_MS = Number(process.env.LIBRARY_RETRY_BASE_MS || 15_000)
async function fetchText(url) {
  const body = await fetchBytes(url)
  return body === null ? null : body.toString('utf8')
}
/** As fetchText, for attachments (PDF, Word): the bytes, or null. */
async function fetchBytes(url) {
  try {
    return await fetchBytesOrThrow(url)
  } catch (error) {
    fetchFailures++
    log('library_import_fetch_failed', {
      failures: fetchFailures,
      reason: String(error?.message).slice(0, 160),
    })
    if (fetchFailures > MAX_FETCH_FAILURES)
      throw new Error(
        `${fetchFailures} fetches failed; the publisher's site may be down — stopping so the run can resume later`,
      )
    return null
  }
}
async function fetchBytesOrThrow(url) {
  for (let attempt = 1; ; attempt++) {
    const wait = lastRequest + RATE_MS - Date.now()
    if (wait > 0) await sleep(wait)
    lastRequest = Date.now()
    let response
    try {
      response = await fetch(url, {
        headers: { 'user-agent': 'SignMe library copier (MimicLabs; legal-information service)' },
        redirect: 'follow',
        signal: AbortSignal.timeout(120_000),
      })
    } catch (error) {
      if (attempt >= 6) throw error
      log('library_import_retry', { attempt, reason: String(error?.message).slice(0, 120) })
      await sleep(RETRY_BASE_MS * attempt)
      continue
    }
    if (response.status === 404 || response.status === 410 || response.status === 300) return null
    if (response.ok) return Buffer.from(await response.arrayBuffer())
    if (attempt >= 6) throw new Error(`${url}: HTTP ${response.status} after ${attempt} attempts`)
    const retryAfter = Number(response.headers.get('retry-after')) || 0
    log('library_import_retry', { attempt, status: response.status })
    await sleep(Math.max(retryAfter * 1000, RETRY_BASE_MS * attempt))
  }
}

// ---------------------------------------------------------------- run

if (await store.head(prefix + 'manifest.json')) {
  log('library_import_complete', { collection: collectionKey, note: 'already in the vault' })
  process.exit(0)
}
if (pastDeadline()) {
  log('library_import_deadline', { note: 'deadline already passed; nothing started' })
  process.exit(0)
}
const adapter = await import(`./library/sources/${collection.source.adapter}.mjs`)
const work = join(tmpdir(), `library-import-${process.pid}`)
await mkdir(work, { recursive: true })
const duck = await (await DuckDBInstance.create(':memory:')).connect()

const saved = await store.get(prefix + '_progress.json')
const progress = saved
  ? JSON.parse(saved.toString('utf8'))
  : {
      format: FORMAT,
      startedAt: new Date().toISOString(),
      parts: [],
      documentParts: [],
      documents: 0,
      passages: 0,
      lastId: '0',
      source: {},
    }
const saveProgress = () =>
  store.put(
    prefix + '_progress.json',
    Buffer.from(JSON.stringify(progress, null, 2)),
    'application/json',
  )
log('library_import_start', {
  collection: collectionKey,
  adapter: collection.source.adapter,
  to: store.where,
  resumedParts: progress.parts.length,
  documentsSoFar: progress.documents,
})

async function writeParquet(selectSql, file, expectedRows) {
  const path = join(work, file.replace(/\//g, '_'))
  await duck.run(
    `copy (${selectSql}) to '${path}' (format parquet, compression zstd, row_group_size 20000)`,
  )
  const rows = Number(
    (await duck.runAndReadAll(`select count(*) from read_parquet('${path}')`)).getRows()[0][0],
  )
  if (rows !== expectedRows)
    throw new Error(`${file}: wrote ${rows} rows, expected ${expectedRows}`)
  const body = await readFile(path)
  await rm(path)
  if (body.length > MAX_UPLOAD_BYTES)
    throw new Error(
      `${file} is ${body.length} bytes, over the upload limit; use a smaller --part-mb`,
    )
  return body
}

await duck.run(
  `create table stage (id bigint, version_id varchar, seq integer, heading varchar, text varchar)`,
)
await duck.run(`create table docs (version_id varchar, type varchar, jurisdiction varchar, source varchar,
  date varchar, citation varchar, url varchar, when_scraped varchar, chars integer, passages integer)`)
let passageAppender = await duck.createAppender('stage')
let docAppender = await duck.createAppender('docs')
let staged = 0
let stagedDocs = 0
let stagedBytes = 0
let firstId = null
let nextId = BigInt(progress.lastId) + 1n
let documentsThisRun = 0
const pad = (id) => String(id).padStart(10, '0')
// The adapter's cursor is saved only when a part is written, so a run that
// stops mid-part re-fetches those documents next time rather than losing them.
let sourceStateAtLastFlush = JSON.stringify(progress.source)
// A part is also written when the one in hand is older than this, so a run
// that stops (or dies) loses at most this much work.
const PART_MAX_AGE_MS = Number(process.env.LIBRARY_PART_MAX_AGE_MINUTES || 15) * 60_000
let partStartedAt = Date.now()
// While nothing is staged (a stretch of items the publisher has no text for),
// the cursor can be saved as it is, losing nothing: a crash or a deadline
// then resumes past the stretch instead of walking it again.
let lastCursorSave = Date.now()
async function saveCursorIfIdle() {
  if (staged || Date.now() - lastCursorSave < 60_000) return
  sourceStateAtLastFlush = JSON.stringify(progress.source)
  progress.fetchFailures = (progress.fetchFailures ?? 0) + fetchFailures
  fetchFailures = 0
  await saveProgress()
  lastCursorSave = Date.now()
  log('library_import_cursor', {
    listed: progress.source.listed?.length ?? null,
    next: progress.source.next ?? null,
  })
}

async function flushPart() {
  if (!staged) return
  passageAppender.closeSync()
  docAppender.closeSync()
  const lastId = nextId - 1n
  const name = `passages/part-${pad(firstId)}-${pad(lastId)}.parquet`
  const body = await writeParquet(
    'select version_id, seq, heading, text from stage order by id',
    name,
    staged,
  )
  const file = await putOnce(name, body, 'application/vnd.apache.parquet')
  const docName = `_staging/documents-${pad(firstId)}.parquet`
  const docBody = await writeParquet('select * from docs order by version_id', docName, stagedDocs)
  const docFile = await putOnce(docName, docBody, 'application/vnd.apache.parquet')
  progress.parts.push({ ...file, rows: staged, firstId: String(firstId), lastId: String(lastId) })
  progress.documentParts.push({ ...docFile, rows: stagedDocs })
  progress.documents += stagedDocs
  progress.passages += staged
  progress.lastId = String(lastId)
  progress.fetchFailures = (progress.fetchFailures ?? 0) + fetchFailures
  fetchFailures = 0
  sourceStateAtLastFlush = JSON.stringify(progress.source)
  await saveProgress()
  log('library_import_part', {
    part: progress.parts.length,
    documents: stagedDocs,
    passages: staged,
    bytes: file.bytes,
    documentsSoFar: progress.documents,
    passagesSoFar: progress.passages,
  })
  await duck.run('delete from stage')
  await duck.run('delete from docs')
  passageAppender = await duck.createAppender('stage')
  docAppender = await duck.createAppender('docs')
  staged = 0
  stagedDocs = 0
  stagedBytes = 0
  firstId = null
  partStartedAt = Date.now()
  lastCursorSave = Date.now()
}

let finished = false
process.on('uncaughtException', (error) => {
  // Keep what the last part saved; the listing and cursor survive a crash.
  log('library_import_failed', { reason: String(error?.message).slice(0, 200) })
  progress.source = JSON.parse(sourceStateAtLastFlush)
  saveProgress().finally(() => process.exit(1))
})
const seen = new Set()
const CONCURRENCY = Number(arg('concurrency') || collection.source.concurrency || 3)
const iterator = adapter.documents({
  ...collection.source,
  sourceDir: arg('source-dir'),
  fetchText,
  fetchBytes,
  concurrency: CONCURRENCY,
  state: progress.source,
  log,
})
for (;;) {
  if (pastDeadline() || documentsThisRun >= maxDocuments) break
  if (staged && Date.now() - partStartedAt >= PART_MAX_AGE_MS) await flushPart()
  const { value: doc, done } = await iterator.next()
  if (done) {
    finished = true
    break
  }
  if (doc === null) {
    // The adapter reports an item it passed over (no text, missing); nothing
    // to stage, so the cursor may be saved.
    await saveCursorIfIdle()
    continue
  }
  if (seen.has(doc.version_id)) continue
  seen.add(doc.version_id)
  const chunks = chunkDocument(doc.text)
  if (!chunks.length) continue
  firstId ??= nextId
  for (const c of chunks) {
    passageAppender.appendBigInt(nextId++)
    passageAppender.appendVarchar(doc.version_id)
    passageAppender.appendInteger(c.seq)
    c.heading === null ? passageAppender.appendNull() : passageAppender.appendVarchar(c.heading)
    passageAppender.appendVarchar(c.body)
    passageAppender.endRow()
    stagedBytes += c.body.length + (c.heading?.length ?? 0)
  }
  for (const v of [
    doc.version_id,
    doc.type,
    doc.jurisdiction,
    doc.source,
    doc.date,
    doc.citation,
    doc.url,
    doc.when_scraped,
  ])
    v == null ? docAppender.appendNull() : docAppender.appendVarchar(String(v))
  docAppender.appendInteger(doc.text.length)
  docAppender.appendInteger(chunks.length)
  docAppender.endRow()
  staged += chunks.length
  stagedDocs++
  documentsThisRun++
  if (stagedBytes >= PART_BYTES) await flushPart()
}
await flushPart()
if (!finished) await saveCursorIfIdle()

if (finished && progress.documents === 0)
  throw new Error(
    'no documents were copied; no manifest written (check the source and --source-dir)',
  )
if (!finished) {
  // Anything fetched since the last flush is re-fetched next run.
  progress.source = JSON.parse(sourceStateAtLastFlush)
  await saveProgress()
  log('library_import_paused_for_now', {
    reason: pastDeadline() ? 'deadline' : 'max documents',
    parts: progress.parts.length,
    documents: progress.documents,
    passages: progress.passages,
  })
  process.exit(0)
}

// ---------------------------------------------------------------- finish: documents.parquet, checks, manifest

await duck.run('delete from docs')
for (const part of progress.documentParts) {
  const body = await store.get(prefix + part.path)
  if (!body || sha256(body) !== part.sha256)
    throw new Error(`${part.path} missing or changed; no manifest written`)
  const path = join(work, part.path.replace(/\//g, '_'))
  await writeFile(path, body)
  await duck.run(`insert into docs select * from read_parquet('${path}')`)
  await rm(path)
}
const docCount = Number((await duck.runAndReadAll('select count(*) from docs')).getRows()[0][0])
const docDistinct = Number(
  (await duck.runAndReadAll('select count(distinct version_id) from docs')).getRows()[0][0],
)
const passageSum = Number(
  (await duck.runAndReadAll('select coalesce(sum(passages), 0) from docs')).getRows()[0][0],
)
if (docCount !== progress.documents || docCount !== docDistinct || passageSum !== progress.passages)
  throw new Error(
    `counts disagree: documents ${docCount} (distinct ${docDistinct}, progress ${progress.documents}); passages ${passageSum} vs ${progress.passages}; no manifest written`,
  )
const body = await writeParquet(
  `select version_id, type, jurisdiction, source, try_cast(date as date) as date, citation, url,
          cast(when_scraped as timestamptz) as when_scraped, chars, passages from docs order by version_id`,
  'documents.parquet',
  docCount,
)
const documentsFile = await putOnce('documents.parquet', body, 'application/vnd.apache.parquet')

const grouped = (
  await duck.runAndReadAll(
    `select source, type, jurisdiction, count(*)::bigint, sum(passages)::bigint from docs group by all order by all`,
  )
).getRows()
const bySource = {},
  byType = {},
  byJurisdiction = {}
for (const [source, type, jurisdiction, docs, chunks] of grouped) {
  bySource[source] ??= { documents: 0, passages: 0 }
  bySource[source].documents += Number(docs)
  bySource[source].passages += Number(chunks)
  byType[type] = (byType[type] ?? 0) + Number(docs)
  byJurisdiction[jurisdiction] = (byJurisdiction[jurisdiction] ?? 0) + Number(docs)
}
const counts = { documents: docCount, passages: passageSum, byType, bySource, byJurisdiction }

const shortfalls = []
const expect = (what, want, got) => {
  if (want !== undefined && want !== got)
    shortfalls.push({ what, publisherStates: want, inVault: got })
}
expect('documents', collection.expected?.documents, counts.documents)
for (const [kind, want] of Object.entries(collection.expected?.byType ?? {}))
  expect(`${kind} documents`, want, counts.byType[kind] ?? 0)
for (const [j, want] of Object.entries(collection.expected?.byJurisdiction ?? {}))
  expect(`${j} documents`, want, counts.byJurisdiction[j] ?? 0)

const licence = await putOnce('LICENCE.md', await readFile(collection.licenceFile), 'text/markdown')
const manifest = {
  format: FORMAT,
  collection: collectionKey,
  country: collection.country,
  title: collection.title,
  publisher: collection.publisher,
  version: collection.version,
  sourceUrl: collection.sourceUrl,
  collectedAsAt: collection.collectedAsAt ?? new Date().toISOString().slice(0, 10),
  licence: collection.licence,
  attribution: collection.attribution ?? null,
  copied: {
    from: `${collection.publisher} (${collection.sourceUrl}) via scripts/library/sources/${collection.source.adapter}.mjs`,
    by: 'scripts/library-import.mjs',
    commit: process.env.GITHUB_SHA || null,
    started: progress.startedAt,
    finished: new Date().toISOString(),
    source: {
      types: collection.source.types ?? null,
      kinds: collection.source.kinds ?? null,
      repository: collection.source.repository ?? null,
      commit: process.env.LIBRARY_SOURCE_COMMIT || null,
    },
  },
  passagesNote:
    'Each document’s text as SignMe indexes it, split into passages by scripts/corpus/chunk.mjs; a passage is identified by version_id and seq.',
  schema: {
    'documents.parquet': {
      version_id: 'the publisher’s document id',
      type: 'decision | primary_legislation | secondary_legislation | bill',
      jurisdiction: 'united_kingdom, scotland, wales, northern_ireland, commonwealth, …',
      source: 'the court, tribunal or register the document came from',
      date: 'date of the decision or instrument, if known',
      citation: 'title or citation',
      url: 'the document at its official source',
      when_scraped: 'when SignMe collected it',
      chars: 'length of the full text',
      passages: 'number of passages in passages/*.parquet',
    },
    'passages/*.parquet': {
      version_id: 'the document the passage belongs to',
      seq: 'position in the document, from 0',
      heading: 'nearest heading, if any',
      text: 'the passage text',
    },
  },
  counts,
  expected: collection.expected ?? null,
  shortfalls,
  fetchFailures: progress.fetchFailures ?? 0,
  files: [
    {
      path: documentsFile.path,
      rows: docCount,
      bytes: documentsFile.bytes,
      sha256: documentsFile.sha256,
    },
    ...progress.parts.map(({ path, rows, bytes, sha256 }) => ({ path, rows, bytes, sha256 })),
    licence,
  ],
}
await putOnce(
  'manifest.json',
  Buffer.from(JSON.stringify(manifest, null, 2) + '\n'),
  'application/json',
)
await rm(work, { recursive: true, force: true })
log('library_import_complete', {
  collection: collectionKey,
  documents: counts.documents,
  passages: counts.passages,
  parts: progress.parts.length,
  bytes: manifest.files.reduce((n, f) => n + f.bytes, 0),
  shortfalls: shortfalls.length,
})
