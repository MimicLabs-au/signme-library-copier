// The collections in SignMe's library vault. One entry per source version.
// Every entry follows docs/LIBRARY-STANDARD.md and is checked by
// scripts/library/conformance.mjs, which also writes docs/REGISTER.md.
// Adding a country or a source means adding an entry here (and a licence
// file beside it), not building a new system. docs/SPEC.md, "Sources: The
// library"; docs/OPERATIONS.md, 5 November 2026.
//
// `expected` holds the counts the publisher states for this version. The
// vault copy is not finished until its own counts match them; any shortfall
// is listed in the manifest by source, never silently accepted.

export const collections = {
  'au/open-australian-legal-corpus/7.1.0': {
    country: 'au',
    collection: 'open-australian-legal-corpus',
    version: '7.1.0',
    title: 'Open Australian Legal Corpus',
    publisher: 'Isaacus',
    sourceUrl: 'https://huggingface.co/datasets/isaacus/open-australian-legal-corpus',
    collectedAsAt: '2025-03-10',
    licence:
      'CC-BY-4.0 for the collection; each document under its source’s own terms (LICENCE.md)',
    // The publisher's LICENCE.md for this version, word for word (line endings normalised).
    licenceFile: 'scripts/library/licences/open-australian-legal-corpus-7.1.0.md',
    // The day the publisher's terms were last read against this use.
    termsReadOn: '2026-11-05',
    status: 'live',
    attribution:
      'Includes adapted material from the Open Australian Legal Corpus by Umar Butler, licensed under CC BY 4.0.',
    // Vault copied 5 Nov 2026 from the database tables that then held the
    // library (dropped 9 Nov 2026; passages split by scripts/corpus/chunk.mjs).
    // The vault is now the only copy; the catalogue is built from it.
    tables: null,
    expected: {
      documents: 232_560,
      byType: { decision: 189_216, legislation: 43_344 },
      bySource: {
        nsw_caselaw: 117_371,
        federal_court_of_australia: 63_749,
        high_court_of_australia: 8_096,
      },
    },
  },

  // United Kingdom — legislation. Founder's direction 9 Nov 2026
  // (claude/library-uk-expansion-2026-11-09.md). Copied from the publisher's
  // site by scripts/library-import.mjs with the legislation-gov-uk adapter.
  // Primary legislation of all four nations first; statutory instruments are a
  // later collection of their own (larger, and lower value per document).
  'uk/legislation-gov-uk/2026-11-primary': {
    country: 'uk',
    collection: 'legislation-gov-uk',
    version: '2026-11-primary',
    title: 'UK legislation (primary), legislation.gov.uk',
    publisher: 'The National Archives (legislation.gov.uk)',
    sourceUrl: 'https://www.legislation.gov.uk',
    // Set when the copy finishes (the manifest records the actual date).
    collectedAsAt: null,
    licence: 'Open Government Licence v3.0 (LICENCE.md)',
    licenceFile: 'scripts/library/licences/legislation-gov-uk-ogl-3.md',
    // The day the publisher's terms were last read against this use.
    termsReadOn: '2026-11-09',
    status: 'live',
    attribution:
      'Contains public sector information licensed under the Open Government Licence v3.0.',
    tables: null,
    source: {
      adapter: 'legislation-gov-uk',
      // Acts of the UK Parliament, Scottish Parliament, Senedd (and its
      // predecessors), Northern Ireland Assembly and Parliament, and NI Orders
      // in Council (primary legislation for Northern Ireland).
      types: ['ukpga', 'asp', 'asc', 'anaw', 'mwa', 'nia', 'apni', 'mnia', 'nisi'],
      rateMs: 300,
    },
    // The site's browse counts on 9 Nov 2026 for the types it lists:
    // ukpga 12,036; asp 378; nisi 691. Items without a text version (some old
    // Acts exist only as PDF) are logged as empty, so the vault may hold
    // fewer; the manifest lists any difference.
    expected: {
      notes: 'legislation.gov.uk browse counts, 9 Nov 2026: ukpga 12,036; asp 378; nisi 691',
    },
  },

  // Canada — federal legislation. Founder's direction 9 Nov 2026
  // (claude/library-canada-expansion-2026-11-09.md). The Department of
  // Justice publishes every consolidated Act and regulation as XML on GitHub;
  // the copier reads a checkout of it (--source-dir), so nothing is fetched
  // from the publisher's website. English texts; French beside them for later.
  // Superseded 9 Nov 2026 (evening) by 2026-11-federal-en: its filter kept 140
  // fully repealed Acts and regulations (every provision "[Repealed, …]").
  // Stays in the vault, as every version does; the catalogue pointer moved.
  'ca/justice-laws-canada/2026-11-federal': {
    country: 'ca',
    collection: 'justice-laws-canada',
    version: '2026-11-federal',
    title: 'Consolidated federal Acts and regulations of Canada (English), Justice Laws Website',
    publisher: 'Department of Justice Canada (Justice Laws Website)',
    sourceUrl: 'https://github.com/justicecanada/laws-lois-xml',
    collectedAsAt: '2026-11-09',
    licence:
      'Open Government Licence – Canada; Reproduction of Federal Law Order, SI/97-5 (LICENCE.md)',
    licenceFile: 'scripts/library/licences/justice-laws-canada-ogl.md',
    // The day the publisher's terms were last read against this use.
    termsReadOn: '2026-11-09',
    status: 'superseded',
    attribution:
      'Contains information licensed under the Open Government Licence – Canada. Reproduced under the Reproduction of Federal Law Order; not an official version.',
    tables: null,
    source: {
      adapter: 'justice-laws-canada',
      repository: 'https://github.com/justicecanada/laws-lois-xml',
      kinds: ['acts', 'regulations'],
    },
    expected: {
      documents: 5_000,
      byType: { primary_legislation: 929, secondary_legislation: 4_071 },
    },
    superseded: true,
  },

  // Canada — federal legislation, English. The Department of Justice
  // publishes every consolidated Act and regulation as XML on GitHub; the
  // copier reads a checkout of it (--source-dir). Repealed records (a stub, or
  // a body whose every provision is repealed) and "not included in the
  // database" placeholders are left out.
  'ca/justice-laws-canada/2026-11-federal-en': {
    country: 'ca',
    collection: 'justice-laws-canada',
    version: '2026-11-federal-en',
    title: 'Consolidated federal Acts and regulations of Canada (English), Justice Laws Website',
    publisher: 'Department of Justice Canada (Justice Laws Website)',
    sourceUrl: 'https://github.com/justicecanada/laws-lois-xml',
    collectedAsAt: null,
    licence:
      'Open Government Licence – Canada; Reproduction of Federal Law Order, SI/97-5 (LICENCE.md)',
    licenceFile: 'scripts/library/licences/justice-laws-canada-ogl.md',
    // The day the publisher's terms were last read against this use.
    termsReadOn: '2026-11-09',
    status: 'live',
    attribution:
      'Contains information licensed under the Open Government Licence – Canada. Reproduced under the Reproduction of Federal Law Order; not an official version.',
    tables: null,
    source: {
      adapter: 'justice-laws-canada',
      repository: 'https://github.com/justicecanada/laws-lois-xml',
      kinds: ['acts', 'regulations'],
      lang: 'eng',
    },
    // Measured by running the adapter over the 9 Nov 2026 checkout: 971 Act
    // files and 4,897 regulation files; 65 + 937 repealed and 6 placeholders
    // left out. The checkout moves on; a small later difference is listed in
    // the manifest, never hidden.
    expected: {
      documents: 4_860,
      byType: { primary_legislation: 900, secondary_legislation: 3_960 },
    },
  },

  // Canada — the same federal legislation in French (the publisher's own
  // texts, equal in authority). Its own ids ("lois/C-5"), so both languages
  // sit in one catalogue.
  'ca/justice-laws-canada/2026-11-federal-fr': {
    country: 'ca',
    collection: 'justice-laws-canada',
    version: '2026-11-federal-fr',
    title:
      'Lois et règlements fédéraux codifiés du Canada (français), Site Web de la législation (Justice)',
    publisher: 'Department of Justice Canada (Justice Laws Website)',
    sourceUrl: 'https://github.com/justicecanada/laws-lois-xml',
    collectedAsAt: null,
    licence:
      'Open Government Licence – Canada; Reproduction of Federal Law Order, SI/97-5 (LICENCE.md)',
    licenceFile: 'scripts/library/licences/justice-laws-canada-ogl.md',
    // The day the publisher's terms were last read against this use.
    termsReadOn: '2026-11-09',
    status: 'vaulted',
    attribution:
      'Contient des informations autorisées en vertu de la Licence du gouvernement ouvert – Canada. Reproduit en vertu du Décret sur la reproduction de la législation fédérale; n’est pas une version officielle.',
    tables: null,
    source: {
      adapter: 'justice-laws-canada',
      repository: 'https://github.com/justicecanada/laws-lois-xml',
      kinds: ['acts', 'regulations'],
      lang: 'fra',
    },
    // Measured on the 9 Nov 2026 checkout: 903 lois and 3,980 règlements live;
    // 62 + 917 abrogés and 6 placeholders left out.
    expected: {
      documents: 4_883,
      byType: { primary_legislation: 903, secondary_legislation: 3_980 },
    },
  },

  // United Kingdom — statutory instruments (secondary legislation) of the four
  // nations. The site holds text for instruments from about 1987; earlier ones
  // are PDF only, so listing starts there rather than walking decades of
  // empties (the primary collection's lesson, 9 Nov).
  'uk/legislation-gov-uk/2026-11-secondary': {
    country: 'uk',
    collection: 'legislation-gov-uk',
    version: '2026-11-secondary',
    title: 'UK legislation (statutory instruments), legislation.gov.uk',
    publisher: 'The National Archives (legislation.gov.uk)',
    sourceUrl: 'https://www.legislation.gov.uk',
    collectedAsAt: null,
    licence: 'Open Government Licence v3.0 (LICENCE.md)',
    licenceFile: 'scripts/library/licences/legislation-gov-uk-ogl-3.md',
    // The day the publisher's terms were last read against this use.
    termsReadOn: '2026-11-09',
    status: 'live',
    attribution:
      'Contains public sector information licensed under the Open Government Licence v3.0.',
    tables: null,
    source: {
      adapter: 'legislation-gov-uk',
      types: ['uksi', 'ssi', 'wsi', 'nisr'],
      firstYear: 1987,
      rateMs: 300,
      concurrency: 3,
    },
    // Browse counts 9 Nov 2026 (all years): UK SIs 107,948; Scottish SIs
    // 10,978; Wales SIs 6,586; NI Statutory Rules 18,316. Most instruments
    // are spent or revoked; the live text set is a fraction and is measured
    // by the run.
    expected: {
      notes:
        'legislation.gov.uk browse counts, 9 Nov 2026: uksi 107,948; ssi 10,978; wsi 6,586; nisr 18,316 (all years; text from ~1987)',
    },
  },

  // United Kingdom — Employment Tribunal decisions published on GOV.UK by
  // HMCTS (England, Wales and Scotland, February 2017 onward). OGL v3.0. The
  // single highest-value UK set for SignMe's questions: dismissal, notice,
  // pay, discrimination. Copied from the finder's pages at a polite rate,
  // the decision read from its PDF or Word attachment.
  'uk/employment-tribunal-decisions/2026-11': {
    country: 'uk',
    collection: 'employment-tribunal-decisions',
    version: '2026-11',
    title: 'Employment Tribunal decisions (England, Wales and Scotland), GOV.UK',
    publisher: 'HM Courts and Tribunals Service, on GOV.UK',
    sourceUrl: 'https://www.gov.uk/employment-tribunal-decisions',
    collectedAsAt: null,
    licence: 'Open Government Licence v3.0 (LICENCE.md)',
    licenceFile: 'scripts/library/licences/govuk-ogl-3.md',
    // The day the publisher's terms were last read against this use.
    termsReadOn: '2026-11-10',
    status: 'live',
    attribution:
      'Contains public sector information licensed under the Open Government Licence v3.0.',
    tables: null,
    source: {
      adapter: 'govuk-tribunal-decisions',
      finder: 'employment-tribunal-decisions',
      // Two requests a decision (page, attachment) and 135,000 decisions:
      // six in flight and a request every 150 ms keeps it to about four
      // nights; the attachments come from GOV.UK's content delivery network.
      rateMs: 150,
      concurrency: 6,
    },
    // The finder showed 135,314 decisions on 9 Nov 2026 (2,707 pages of 50).
    // Scanned decisions with no text layer and legacy .doc attachments are
    // logged and left out; the run measures how many.
    expected: { notes: 'GOV.UK finder count, 9 Nov 2026: 135,314 decisions' },
  },

  // United Kingdom — First-tier Tribunal (Property Chamber) residential
  // property decisions on GOV.UK: rent, service charges, leasehold, deposits.
  'uk/residential-property-tribunal-decisions/2026-11': {
    country: 'uk',
    collection: 'residential-property-tribunal-decisions',
    version: '2026-11',
    title: 'First-tier Tribunal (Property Chamber) residential property decisions, GOV.UK',
    publisher: 'HM Courts and Tribunals Service, on GOV.UK',
    sourceUrl: 'https://www.gov.uk/residential-property-tribunal-decisions',
    collectedAsAt: null,
    licence: 'Open Government Licence v3.0 (LICENCE.md)',
    licenceFile: 'scripts/library/licences/govuk-ogl-3.md',
    // The day the publisher's terms were last read against this use.
    termsReadOn: '2026-11-10',
    status: 'live',
    attribution:
      'Contains public sector information licensed under the Open Government Licence v3.0.',
    tables: null,
    source: {
      adapter: 'govuk-tribunal-decisions',
      finder: 'residential-property-tribunal-decisions',
      rateMs: 300,
      concurrency: 3,
    },
    expected: { notes: 'count read from the finder on the first run' },
  },

  // Canada — decisions, from the A2AJ Canadian Case Law dataset on Hugging
  // Face (MIT; each document under its publisher's terms). Only sets whose
  // terms were read and allow a paid service: federally constituted courts and
  // tribunals (Reproduction of Federal Law Order) and the Ontario Landlord and
  // Tenant Board (Open Government Licence – Ontario). See the licence file for
  // what is left out and why.
  'ca/a2aj-canadian-case-law/2026-11': {
    country: 'ca',
    collection: 'a2aj-canadian-case-law',
    version: '2026-11',
    title: 'Canadian court and tribunal decisions (federal; Ontario Landlord and Tenant Board), via A2AJ',
    publisher: 'Access to Algorithmic Justice (A2AJ), from the courts and tribunals named',
    sourceUrl: 'https://huggingface.co/datasets/a2aj/canadian-case-law',
    collectedAsAt: null,
    licence: 'MIT (dataset); Reproduction of Federal Law Order SI/97-5; Open Government Licence – Ontario (LICENCE.md)',
    licenceFile: 'scripts/library/licences/a2aj-canada.md',
    // The day the publisher's terms were last read against this use.
    termsReadOn: '2026-11-13',
    status: 'live',
    attribution:
      'Reproduced under the Reproduction of Federal Law Order; contains information licensed under the Open Government Licence – Ontario. Not an official version. Data via A2AJ.',
    tables: null,
    source: {
      adapter: 'a2aj-canada',
      sets: ['ONLTB', 'FC', 'FCA', 'TCC', 'SST', 'FPSLREB', 'CHRT', 'CIRB', 'OHSTC', 'CT'],
    },
    // The dataset card's counts on 12 Nov 2026 (rows, both languages):
    // ONLTB 56,186; FC 36,141; SST 18,081; TCC 8,149; FCA 7,837; FPSLREB
    // 3,494; CHRT 1,218; CIRB 1,204; OHSTC 811; CT 645 = 133,766. Rows with no
    // English text are passed over and counted by the run.
    expected: { notes: 'A2AJ card, 12 Nov 2026: 133,766 rows across the ten sets (English and French)' },
  },

  // Canada — provincial legislation, from the A2AJ Canadian Laws dataset:
  // Ontario, British Columbia and Alberta, whose King's Printers permit
  // reproduction. Federal law is already held from Justice Canada's own files.
  'ca/a2aj-canadian-laws/2026-11': {
    country: 'ca',
    collection: 'a2aj-canadian-laws',
    version: '2026-11',
    title: 'Statutes and regulations of Ontario, British Columbia and Alberta, via A2AJ',
    publisher: 'Access to Algorithmic Justice (A2AJ), from the provinces\' official sources',
    sourceUrl: 'https://huggingface.co/datasets/a2aj/canadian-laws',
    collectedAsAt: null,
    licence: 'MIT (dataset); King\'s Printer terms of Ontario, British Columbia and Alberta (LICENCE.md)',
    licenceFile: 'scripts/library/licences/a2aj-canada.md',
    // The day the publisher's terms were last read against this use.
    termsReadOn: '2026-11-13',
    status: 'live',
    attribution:
      '© King\'s Printer for Ontario; King\'s Printer Licence – British Columbia; © Alberta King\'s Printer. Not official versions. Data via A2AJ.',
    tables: null,
    source: {
      adapter: 'a2aj-canada',
      sets: ['LEGISLATION-ON', 'REGULATIONS-ON', 'LEGISLATION-BC', 'REGULATIONS-BC', 'LEGISLATION-AB', 'REGULATIONS-AB'],
    },
    // A2AJ card, 7 Nov 2026: ON 856 + 2,219; BC 572 + 1,476; AB 442 + 927 = 6,492.
    expected: { notes: 'A2AJ card, 7 Nov 2026: 6,492 rows across the six sets' },
  },

  // Canada — more federal decisions from the same A2AJ dataset (founder,
  // 13 Nov 2026: "add all the additionals"): the Immigration and Refugee
  // Board's two refugee divisions, five more federal tribunals, the Trademarks
  // Opposition Board and the Court Martial Appeal Court. All federally
  // constituted, so the Reproduction of Federal Law Order covers them.
  'ca/a2aj-federal-tribunals/2026-11': {
    country: 'ca',
    collection: 'a2aj-federal-tribunals',
    version: '2026-11',
    title: 'Canadian federal tribunal decisions (refugee, trade, trademarks, transport and others), via A2AJ',
    publisher: 'Access to Algorithmic Justice (A2AJ), from the tribunals and court named',
    sourceUrl: 'https://huggingface.co/datasets/a2aj/canadian-case-law',
    collectedAsAt: null,
    licence: 'MIT (dataset); Reproduction of Federal Law Order SI/97-5 (LICENCE.md)',
    licenceFile: 'scripts/library/licences/a2aj-canada.md',
    // The day the publisher's terms were last read against this use.
    termsReadOn: '2026-11-13',
    status: 'live',
    attribution:
      'Reproduced under the Reproduction of Federal Law Order. Not an official version; not produced in affiliation with or with the endorsement of the Government of Canada. Data via A2AJ.',
    tables: null,
    source: {
      adapter: 'a2aj-canada',
      sets: ['RAD', 'RPD', 'RLLR', 'CITT', 'TMOB', 'TATC', 'CART', 'CMAC', 'SCT', 'PSDPT'],
    },
    // A2AJ survey, 12 Nov 2026 (rows): RAD 14,216; RPD 6,729; CITT 5,376;
    // TMOB 3,747; RLLR 1,044; TATC 542; CART 535; CMAC 157; SCT 44; PSDPT 33.
    expected: { notes: 'A2AJ survey, 12 Nov 2026: 32,423 rows across the ten sets (English and French)' },
  },
}
