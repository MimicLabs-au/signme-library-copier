# signme-library-copier

Scripts that copy openly licensed legislation and court or tribunal decisions from their official publishers into a storage vault, and build a search index from it. Used by SignMe (MimicLabs). No application code and no customer data live here.

## What it does

- `scripts/library-import.mjs` copies one collection into the vault: a source adapter lists and fetches documents from the publisher at a polite rate, the text is split into passages, and Parquet files plus a manifest are written. It is resumable and never overwrites a vault file.
- `scripts/library/catalogue/build.mjs` builds a search index for a completed collection.
- `scripts/library/collections.mjs` lists the collections, each with its source, licence and expected counts.
- `scripts/library/sources/` holds one adapter per publisher: legislation.gov.uk, the Justice Laws Website of Canada (from its XML repository), and GOV.UK tribunal decision finders.
- `scripts/library/licences/` holds the licence text kept beside each collection.

## The standard

Every collection follows `docs/LIBRARY-STANDARD.md`: the same seven steps, the same stored fields, the same registry entry. `node scripts/library/conformance.mjs` checks the registry and runs before every import and index build; `docs/REGISTER.md` is the register it writes (publisher, licence, saved terms, date read, credit, status).

## Sources and licences

Only sources whose terms allow this use are copied: Open Government Licence v3.0 (United Kingdom), Open Government Licence – Canada and the Reproduction of Federal Law Order. Sites whose terms forbid bulk or automated access (AustLII, BAILII, CanLII) are never used.

## Running

Both workflows are started by hand from the Actions tab and need three repository secrets: `LIBRARY_S3_ENDPOINT`, `LIBRARY_S3_ACCESS_KEY_ID`, `LIBRARY_S3_SECRET_ACCESS_KEY` (any S3-compatible storage with a bucket named `library`).

Locally, without storage:

```
npm ci --ignore-scripts
node scripts/library-import.mjs --collection <collection> --local-dir ./out --max-documents 50
```
