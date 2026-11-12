// Splits one corpus document into passages for full-text search and for the
// model to read. Deterministic and dependency-free so it can be unit tested.
// Paragraphs (blank-line separated) are packed to about TARGET characters;
// a short line that looks like a heading ("Part 3", "15 Notice of termination",
// "Division 2") becomes the heading carried by the passages under it.

export const TARGET = 5000
export const HARD_MAX = 7000

const STRUCTURAL =
  /^(?:(?:part|chapter|division|subdivision|schedule|section|clause)\s+\w+|\d{1,4}[A-Z]{0,3}(?:\.\d+)*\s+[A-Za-z].*)/i
const MIN_BEFORE_SPLIT = 1000

export function looksLikeHeading(line) {
  const t = line.trim()
  if (t.length < 3 || t.length > 120) return false
  if (/[.;:,]$/.test(t)) return false
  // "Part 5 ...", "Division 2 ...", "84 Termination ..." or a line in capitals.
  return (
    STRUCTURAL.test(t) ||
    (t === t.toUpperCase() && /[A-Z]{4,}/.test(t) && t.split(' ').length <= 12)
  )
}

function splitLong(text) {
  // Break an oversized paragraph at sentence ends; fall back to hard cuts.
  const out = []
  let rest = text
  while (rest.length > HARD_MAX) {
    let cut = rest.lastIndexOf('. ', TARGET)
    if (cut < TARGET / 2) cut = rest.lastIndexOf(' ', TARGET)
    if (cut < TARGET / 2) cut = TARGET
    out.push(rest.slice(0, cut + 1).trim())
    rest = rest.slice(cut + 1)
  }
  if (rest.trim()) out.push(rest.trim())
  return out
}

/** @returns {{seq:number, heading:string|null, body:string}[]} */
export function chunkDocument(text) {
  const paragraphs = String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((p) => p.replace(/[ \t]+\n/g, '\n').trim())
    .filter(Boolean)
  const chunks = []
  let heading = null // the latest heading seen
  let chunkHeading = null // the heading in force when the open passage began
  let buf = []
  let size = 0
  let bodyStarted = false
  const push = (piece, isHeading = false) => {
    // The passage is labelled with the heading in force at its first body text.
    if (!isHeading && !bodyStarted) ((chunkHeading = heading), (bodyStarted = true))
    buf.push(piece)
    size += piece.length + 2
  }
  const flush = () => {
    if (!buf.length) return
    chunks.push({ seq: chunks.length, heading: chunkHeading, body: buf.join('\n\n') })
    buf = []
    size = 0
    bodyStarted = false
    chunkHeading = null
  }
  paragraphs.forEach((p, index) => {
    // The first short line of a document is its title, a heading in its own right.
    const isTitle = index === 0 && p.length <= 120 && !p.includes('\n')
    if (isTitle || (p.length <= 120 && !p.includes('\n') && looksLikeHeading(p))) {
      // A heading starts a new passage only once the current one has substance;
      // otherwise it stays in the text so short documents aren't fragmented.
      if (size >= MIN_BEFORE_SPLIT) flush()
      push(p, true)
      heading = p
      return
    }
    const pieces = p.length > HARD_MAX ? splitLong(p) : [p]
    for (const piece of pieces) {
      if (size && size + piece.length + 2 > TARGET) flush()
      push(piece)
    }
  })
  flush()
  // A tiny opening passage (a title before the first heading) joins the next;
  // a tiny tail joins the previous. No passage is left as a fragment.
  if (chunks.length > 1 && chunks[0].body.length < 300) {
    const first = chunks.shift()
    chunks[0].body = first.body + '\n\n' + chunks[0].body
  }
  if (chunks.length > 1 && chunks.at(-1).body.length < 300) {
    const last = chunks.pop()
    const prev = chunks.at(-1)
    prev.body += '\n\n' + last.body
    prev.heading ??= last.heading
  }
  return chunks.map((c, seq) => ({ ...c, seq }))
}
