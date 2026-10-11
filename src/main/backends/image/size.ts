/** Pixel size from an image's header (PNG, JPEG, WebP, GIF), without decoding it; null when unknown. */
export function imageSize(data: Buffer): { width: number; height: number } | null {
  if (data.length < 24) return null
  // PNG: IHDR is the first chunk.
  if (data.readUInt32BE(0) === 0x89504e47) return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) }
  // GIF: logical screen size.
  if (data.toString('latin1', 0, 3) === 'GIF') return { width: data.readUInt16LE(6), height: data.readUInt16LE(8) }
  // WebP: lossy (VP8), lossless (VP8L) or extended (VP8X).
  if (data.toString('latin1', 0, 4) === 'RIFF' && data.toString('latin1', 8, 12) === 'WEBP') {
    const kind = data.toString('latin1', 12, 16)
    if (kind === 'VP8 ' && data.length >= 30) return { width: data.readUInt16LE(26) & 0x3fff, height: data.readUInt16LE(28) & 0x3fff }
    if (kind === 'VP8L' && data.length >= 25) {
      const b = data.readUInt32LE(21)
      return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 }
    }
    if (kind === 'VP8X' && data.length >= 30) return { width: data.readUIntLE(24, 3) + 1, height: data.readUIntLE(27, 3) + 1 }
    return null
  }
  // JPEG: the first start-of-frame marker.
  if (data[0] === 0xff && data[1] === 0xd8) {
    let i = 2
    while (i + 9 < data.length) {
      if (data[i] !== 0xff) return null
      const marker = data[i + 1]!
      const length = data.readUInt16BE(i + 2)
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { width: data.readUInt16BE(i + 7), height: data.readUInt16BE(i + 5) }
      }
      i += 2 + length
    }
  }
  return null
}

/** A size with the sketch's proportions and the given long side, in multiples of 8. */
export function sizeLike(source: { width: number; height: number }, longSide: number): { width: number; height: number } {
  const round = (v: number): number => Math.max(64, Math.round(v / 8) * 8)
  return source.width >= source.height
    ? { width: round(longSide), height: round((longSide * source.height) / source.width) }
    : { width: round((longSide * source.width) / source.height), height: round(longSide) }
}
