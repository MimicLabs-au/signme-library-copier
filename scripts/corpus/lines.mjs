// Line splitting for the corpus loader, kept apart so it can be unit tested.

/** Lines of a byte stream, with the byte offset of each complete line
 *  consumed, so a broken download can resume from the right place.
 *  @param {AsyncIterable<Uint8Array | Buffer>} chunks
 *  @param {(bytes: number) => void} [onLine] called with each line's byte length
 *  @returns {AsyncGenerator<string>} */
export async function* splitLines(chunks, onLine = (/** @type {number} */ _bytes) => {}) {
  let rest = Buffer.alloc(0)
  for await (const piece of chunks) {
    const buf = rest.length ? Buffer.concat([rest, Buffer.from(piece)]) : Buffer.from(piece)
    let start = 0,
      nl
    while ((nl = buf.indexOf(10, start)) !== -1) {
      const line = buf.subarray(start, nl)
      onLine(nl - start + 1)
      yield line.toString('utf8')
      start = nl + 1
    }
    rest = Buffer.from(buf.subarray(start))
  }
  if (rest.length) {
    onLine(rest.length)
    yield rest.toString('utf8')
  }
}
