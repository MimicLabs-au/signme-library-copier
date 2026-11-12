#!/usr/bin/env node
// Surveys the A2AJ Canadian datasets on Hugging Face (MIT; each document also
// carries its publisher's licence in `upstream_license`): for each court or
// law set, the distinct upstream licences, how many documents carry each, and
// how many have English text. Reads only those columns. Prints JSON lines.
import { DuckDBInstance } from '@duckdb/node-api'

const db = await (await DuckDBInstance.create(':memory:')).connect()
await db.run('install httpfs; load httpfs;')
for (const [repo, text] of [
  ['a2aj/canadian-laws', 'unofficial_text_en'],
  ['a2aj/canadian-case-law', 'unofficial_text_en'],
]) {
  const rows = (
    await db.runAndReadAll(`
      select dataset, upstream_license, count(*)::bigint as documents,
             count(*) filter (where coalesce(${text}, '') <> '')::bigint as with_english,
             round(sum(length(coalesce(${text}, ''))) / 1e6)::bigint as english_million_chars
      from read_parquet('hf://datasets/${repo}/*/train.parquet', union_by_name = true)
      group by all order by dataset, documents desc`)
  ).getRows()
  for (const [dataset, licence, documents, withEnglish, chars] of rows)
    console.log(JSON.stringify({ repo, dataset, licence: String(licence ?? '').slice(0, 600), documents: Number(documents), withEnglish: Number(withEnglish), englishMillionChars: Number(chars) }))
}
// One sample row of each, to confirm field names.
for (const repo of ['a2aj/canadian-laws', 'a2aj/canadian-case-law']) {
  const d = await db.runAndReadAll(`describe select * from read_parquet('hf://datasets/${repo}/${repo.endsWith('laws') ? 'LEGISLATION-ON' : 'ONLTB'}/train.parquet')`)
  console.log(JSON.stringify({ repo, columns: d.getRows().map((r) => `${r[0]}:${r[1]}`) }))
}
