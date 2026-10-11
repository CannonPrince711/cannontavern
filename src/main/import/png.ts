/**
 * Minimal PNG chunk reader/writer for SillyTavern character cards, which store
 * their JSON base64-encoded in a tEXt chunk with the keyword "chara" (V2) or
 * "ccv3" (V3).
 */
import { deflateSync, inflateSync } from 'node:zlib'

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

export interface PngChunk {
  type: string
  data: Buffer
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

export function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

export function isPng(buf: Buffer): boolean {
  return buf.length > 8 && buf.subarray(0, 8).equals(SIGNATURE)
}

export function readChunks(buf: Buffer): PngChunk[] {
  if (!isPng(buf)) throw new Error('Not a PNG file.')
  const chunks: PngChunk[] = []
  let pos = 8
  while (pos + 8 <= buf.length) {
    const length = buf.readUInt32BE(pos)
    const type = buf.toString('latin1', pos + 4, pos + 8)
    const start = pos + 8
    if (start + length + 4 > buf.length) throw new Error('Truncated PNG chunk.')
    chunks.push({ type, data: buf.subarray(start, start + length) })
    pos = start + length + 4
    if (type === 'IEND') break
  }
  return chunks
}

export function writeChunks(chunks: PngChunk[]): Buffer {
  const parts: Buffer[] = [SIGNATURE]
  for (const { type, data } of chunks) {
    const head = Buffer.alloc(8)
    head.writeUInt32BE(data.length, 0)
    head.write(type, 4, 'latin1')
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0)
    parts.push(head, data, crc)
  }
  return Buffer.concat(parts)
}

/** All text chunks (tEXt, zTXt, iTXt) as keyword → text. */
export function readTextChunks(buf: Buffer): Map<string, string> {
  const out = new Map<string, string>()
  for (const { type, data } of readChunks(buf)) {
    const nul = data.indexOf(0)
    if (nul <= 0) continue
    const keyword = data.toString('latin1', 0, nul)
    try {
      if (type === 'tEXt') {
        out.set(keyword, data.toString('latin1', nul + 1))
      } else if (type === 'zTXt') {
        out.set(keyword, inflateSync(data.subarray(nul + 2)).toString('latin1'))
      } else if (type === 'iTXt') {
        const compressed = data[nul + 1] === 1
        let p = nul + 3
        p = data.indexOf(0, p) + 1 // language tag
        p = data.indexOf(0, p) + 1 // translated keyword
        const text = data.subarray(p)
        out.set(keyword, (compressed ? inflateSync(text) : text).toString('utf8'))
      }
    } catch {
      /* skip unreadable chunk */
    }
  }
  return out
}

/** Returns a copy of the PNG with the given tEXt chunks set (replacing same-keyword ones). */
export function setTextChunks(buf: Buffer, entries: Record<string, string>): Buffer {
  const keys = new Set(Object.keys(entries))
  const chunks = readChunks(buf).filter((c) => {
    if (c.type !== 'tEXt' && c.type !== 'iTXt' && c.type !== 'zTXt') return true
    const nul = c.data.indexOf(0)
    return !keys.has(c.data.toString('latin1', 0, nul))
  })
  const added = Object.entries(entries).map(([k, v]) => ({ type: 'tEXt', data: Buffer.from(`${k}\0${v}`, 'latin1') }))
  const iend = chunks.findIndex((c) => c.type === 'IEND')
  chunks.splice(iend === -1 ? chunks.length : iend, 0, ...added)
  return writeChunks(chunks)
}

/** A plain RGB PNG of one colour, used when exporting a card that has no avatar. */
export function solidPng(width: number, height: number, rgb: [number, number, number]): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // colour type: RGB
  const row = Buffer.alloc(1 + width * 3)
  for (let x = 0; x < width; x++) row.set(rgb, 1 + x * 3)
  const raw = Buffer.concat(Array.from({ length: height }, () => row))
  return writeChunks([
    { type: 'IHDR', data: ihdr },
    { type: 'IDAT', data: deflateSync(raw) },
    { type: 'IEND', data: Buffer.alloc(0) }
  ])
}
