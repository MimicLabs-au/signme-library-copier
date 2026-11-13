# The library standard

Every collection in SignMe's law library is made the same way, stored in the same shape and recorded in the same register. A collection that does not meet this standard is not copied and not switched on. The standard is here so that adding material stays routine, and so that anyone checking the library (a lawyer, an investor, a publisher) finds the same evidence in the same place for every source.

Version 1, 13 November 2026 (founder's direction). Vault format `signme-library-vault/1`.

## 1. The lifecycle: seven steps, always in this order

| Step | What happens | Evidence it leaves |
|---|---|---|
| 1. Find | A source is identified: who publishes it, where, what it contains | A row in the registry, status `planned` |
| 2. Clear | The publisher's terms are read against SignMe's use (a paid service that stores and shows passages) | The terms saved word for word in `scripts/library/licences/`, the date in `termsReadOn`, the credit wording in `attribution` |
| 3. Register | The collection gets its entry in `scripts/library/collections.mjs` | The conformance check passes |
| 4. Copy | `scripts/library-import.mjs` copies it into the vault through a source adapter | Vault folder with a manifest; status `vaulted` |
| 5. Index | `scripts/library/catalogue/build.mjs` builds the search index from the vault | A dated build folder |
| 6. Switch on | The build is added to `LIBRARY_CATALOGUES`, a row is added to the `library_catalogue` table, and the publisher is added to the Credits page | Status `live` |
| 7. Replace | A newer version is a new collection (new version, new folder). The old one is marked `superseded`, never edited or deleted | Both rows stay in the register |

Switching a collection on needs no change to the answering engine. The engine searches whatever is loaded and keeps no list of what is missing.

## 2. Naming

- A collection's key is `country/collection/version`, for example `ca/a2aj-canadian-laws/2026-11`.
- `country`: two lower-case letters (`au`, `uk`, `ca`, `nz`, …).
- `collection`: lower-case words joined by hyphens, named for the publisher or the body of material.
- `version`: the publisher's version if it has one, otherwise the year and month it was copied, with a suffix when one source is split (`2026-11-primary`).
- Vault folder: `vault/<key>/`. Index folder: `catalogue/<key>/<build time>/`.

## 3. The registry entry

One entry per collection in `scripts/library/collections.mjs`. All of these are required:

| Field | Meaning |
|---|---|
| `country`, `collection`, `version` | Match the key |
| `title` | What the collection is, in plain words |
| `publisher` | Who publishes the original |
| `sourceUrl` | Where it was taken from (https) |
| `licence` | The terms relied on, named |
| `licenceFile` | The terms, saved word for word, with what was taken, what was left out and why |
| `termsReadOn` | The day the terms were last read |
| `attribution` | The credit wording the terms require, exactly |
| `status` | `planned`, `vaulted`, `live` or `superseded` |
| `expected` | The counts the publisher states, or a note saying why none exist |
| `source.adapter` | The adapter that copies it (for anything copied by the importer) |

## 4. What is stored: the same fields for every document

`documents.parquet`, one row per document:

| Field | Rule |
|---|---|
| `version_id` | Unique within the library and stable: `<source prefix>:<publisher's own id>`. Never reused for a different document |
| `type` | One of `decision`, `primary_legislation`, `secondary_legislation`, `bill` |
| `jurisdiction` | One lower-case code in words joined by underscores: the country's national code (`commonwealth`, `united_kingdom`, `canada_federal`) or the state, province or nation (`new_south_wales`, `ontario`, `scotland`) |
| `source` | The court, tribunal or register, as a code in the same style (`federal_court_canada`) |
| `date` | Date of the decision or instrument (`YYYY-MM-DD`), empty if unknown |
| `citation` | Title or citation as a person would write it |
| `url` | The document at its official source |
| `when_scraped` | When it was collected |

`passages/part-*.parquet`: the document's text split into passages by the one shared splitter (`scripts/corpus/chunk.mjs`), each identified by `version_id` and `seq`, with an optional `heading`.

`manifest.json` is written last, only when the copy is complete: format, key, publisher, licence, credit, when and how it was copied, counts by type and by source, any shortfall against the publisher's counts, and a checksum for every file. `LICENCE.md` sits beside it.

New kinds of document or new fields are added by raising the format version for everything, never for one collection alone.

## 5. Rules that do not bend

1. **Terms first.** Nothing is copied before its terms are read and saved. Where terms forbid automated or commercial use (AustLII, BAILII, CanLII, courts that require written permission), the source is not used until permission is in writing.
2. **Only what is cleared.** When one dataset mixes publishers, only the publishers whose terms were read are taken, by name. What is left out is written down with the reason.
3. **The vault is never overwritten or deleted from.** A new version is a new folder.
4. **Counts are measured.** A copy is complete when its counts match the publisher's, or the gap is listed in the manifest by reason. Nothing is silently dropped.
5. **No customer content, ever.** The library holds public law only.
6. **Credit where it is required.** A collection is not switched on until its publisher is on the Credits page with the required wording.
7. **No new spend without the founder's yes.**

## 6. The check

`node scripts/library/conformance.mjs` checks every registry entry against section 3 and fails if anything is missing. It runs before every import and every index build. With `--write` it regenerates `docs/REGISTER.md`, the due-diligence register: one row per collection with publisher, source, licence, saved terms, date read, credit and status.

## 7. Where the evidence is

| Question | Where to look |
|---|---|
| What is in the library, and under what terms? | `docs/REGISTER.md` |
| What exactly did the publisher's terms say? | `scripts/library/licences/` |
| What was copied, when, and does it match the source? | `manifest.json` in each vault folder |
| What is live right now? | `library_catalogue` table; `LIBRARY_CATALOGUES` setting |
| How are publishers credited? | the Credits page on the website |
