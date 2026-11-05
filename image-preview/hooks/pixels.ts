/** A picture decoded to 8-bit RGBA, row-major from the top-left pixel. */
export type Pixels = { width: number; height: number; data: Uint8Array }

const UPPER_HALF = 0x2580 // ▀
const LEFT_HALF = 0x258c // ▌
const SPACE = 0x20
const DEFAULT_COLOR = 0x01000000

/** The lowest set bit of a channel mask, and how many bits wide the channel is. */
function channelOf (mask: number) {
  if (mask === 0) return null
  let shift = 0
  while (((mask >>> shift) & 1) === 0) shift++
  let bits = 0
  while (((mask >>> (shift + bits)) & 1) === 1) bits++
  return { shift, max: 2 ** bits - 1 }
}

/** Reads an uncompressed 24- or 32-bit BMP, the kind `sips` and ImageMagick write. */
export function parseBmp (bytes: Uint8Array): Pixels {
  if (bytes.length < 54 || bytes[0] !== 0x42 || bytes[1] !== 0x4d) throw new Error('not a BMP file')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const offset = view.getUint32(10, true)
  const headerSize = view.getUint32(14, true)
  const width = view.getInt32(18, true)
  const signedHeight = view.getInt32(22, true)
  const bits = view.getUint16(28, true)
  const compression = view.getUint32(30, true)
  const height = Math.abs(signedHeight)

  if (width <= 0 || height === 0) throw new Error('an empty BMP')
  if (bits !== 24 && bits !== 32) throw new Error(`a ${bits}-bit BMP`)
  if (compression !== 0 && compression !== 3) throw new Error('a compressed BMP')

  const stride = Math.ceil((width * bits) / 32) * 4
  if (offset + stride * height > bytes.length) throw new Error('a truncated BMP')

  // BI_BITFIELDS keeps its masks right after the 40-byte header, or inside a longer one.
  const masks = compression === 3
    ? [54, 58, 62, 66].map(at => (at === 66 && headerSize < 56) || at + 4 > bytes.length ? 0 : view.getUint32(at, true))
    : bits === 32 ? [0xff0000, 0xff00, 0xff, 0xff000000] : null
  const channels = masks?.map(channelOf)

  const data = new Uint8Array(width * height * 4)
  let hasAlpha = false
  for (let y = 0; y < height; y++) {
    const start = offset + (signedHeight < 0 ? y : height - 1 - y) * stride
    for (let x = 0; x < width; x++) {
      const out = (y * width + x) * 4
      if (channels) {
        const value = view.getUint32(start + x * 4, true)
        for (let c = 0; c < 4; c++) {
          const channel = channels[c]
          data[out + c] = channel ? Math.round((((value >>> channel.shift) & channel.max) * 255) / channel.max) : 255
        }
        if (data[out + 3] !== 0) hasAlpha = true
      } else {
        const at = start + x * 3
        data[out] = bytes[at + 2]!
        data[out + 1] = bytes[at + 1]!
        data[out + 2] = bytes[at]!
        data[out + 3] = 255
      }
    }
  }
  // A writer that leaves the alpha byte unused fills it with zeros: the picture is opaque.
  if (channels && !hasAlpha) for (let i = 3; i < data.length; i += 4) data[i] = 255

  return { width, height, data }
}

/**
 * The largest box of cells within the bounds that keeps the picture's shape. A cell is about
 * twice as tall as it is wide, and holds two rows of pixels.
 */
export function fit (width: number, height: number, maxColumns: number, maxRows: number) {
  const columnsCap = Math.max(1, Math.min(maxColumns, width))
  let columns = columnsCap
  let rows = Math.max(1, Math.round((columns * height) / width / 2))
  if (rows > maxRows) {
    rows = Math.max(1, maxRows)
    columns = Math.max(1, Math.min(columnsCap, Math.round((rows * 2 * width) / height)))
  }
  return { columns, rows }
}

// Light adds up in linear terms, not in the gamma-encoded bytes: averaging the bytes darkens a
// light line on a dark ground until it is gone.
const LINEAR = Float64Array.from({ length: 256 }, (_, i) => {
  const value = i / 255
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
})
const ENCODED = Uint8Array.from({ length: 4096 }, (_, i) => {
  const value = i / 4095
  return Math.round(255 * (value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055))
})
const encode = (linear: number) => ENCODED[Math.min(4095, Math.max(0, Math.round(linear * 4095)))]!

// Each cell is sampled as a grid of SIDE by SIDE points, each the average of the pixels it covers.
const SIDE = 8
const HALF = SIDE / 2
const POINTS = SIDE * SIDE

/** A block element, and which of a cell's points its foreground covers. */
type Shape = { glyph: number; inside: Uint8Array; count: number }

const shape = (glyph: number, covers: (x: number, y: number) => boolean): Shape => {
  const inside = Uint8Array.from({ length: POINTS }, (_, i) => (covers(i % SIDE, Math.floor(i / SIDE)) ? 1 : 0))
  return { glyph, inside, count: inside.reduce((sum, bit) => sum + bit, 0) }
}

// The ways a cell can be split in two colors: the halves, the eighths from the bottom and from the
// left (each also the rest from the top or right, the colors swapped), the quarters and the
// diagonals. The halves first, so a cell they draw as well as another is drawn with them.
const SHAPES: Shape[] = [
  shape(UPPER_HALF, (_, y) => y < HALF),
  shape(LEFT_HALF, x => x < HALF),
  ...[1, 2, 3, 5, 6, 7].map(k => shape(0x2580 + k, (_, y) => y >= SIDE - k)), // ▁▂▃▅▆▇
  ...[1, 2, 3, 5, 6, 7].map(k => shape(0x2590 - k, x => x < k)), // ▏▎▍▋▊▉
  shape(0x2598, (x, y) => x < HALF && y < HALF), // ▘
  shape(0x259d, (x, y) => x >= HALF && y < HALF), // ▝
  shape(0x2596, (x, y) => x < HALF && y >= HALF), // ▖
  shape(0x2597, (x, y) => x >= HALF && y >= HALF), // ▗
  shape(0x259a, (x, y) => (x < HALF) === (y < HALF)), // ▚
  shape(0x259e, (x, y) => (x < HALF) !== (y < HALF)) // ▞
]

/** One cell's points: gamma-encoded, to choose a shape by; linear, to mix its colors in; and which show. */
type Points = { encoded: Float64Array; linear: Float64Array; shows: Uint8Array; shown: number }

const SCRATCH_POINTS: Points = {
  encoded: new Float64Array(POINTS * 3),
  linear: new Float64Array(POINTS * 3),
  shows: new Uint8Array(POINTS),
  shown: 0
}

/** Averages, in linear light, the pixels under each of the points of the cell at `column`, `row`. */
function pointsOf ({ width, height, data }: Pixels, columns: number, rows: number, column: number, row: number, points: Points) {
  const across = columns * SIDE
  const down = rows * SIDE
  const { encoded, linear, shows } = points
  points.shown = 0
  for (let py = 0; py < SIDE; py++) {
    const y0 = Math.floor(((row * SIDE + py) * height) / down)
    const y1 = Math.max(y0 + 1, Math.floor(((row * SIDE + py + 1) * height) / down))
    for (let px = 0; px < SIDE; px++) {
      const x0 = Math.floor(((column * SIDE + px) * width) / across)
      const x1 = Math.max(x0 + 1, Math.floor(((column * SIDE + px + 1) * width) / across))
      let r = 0
      let g = 0
      let b = 0
      let alpha = 0
      for (let y = y0; y < y1; y++) {
        let at = (y * width + x0) * 4
        for (let x = x0; x < x1; x++) {
          const a = data[at + 3]!
          r += LINEAR[data[at]!]! * a
          g += LINEAR[data[at + 1]!]! * a
          b += LINEAR[data[at + 2]!]! * a
          alpha += a
          at += 4
        }
      }
      const i = py * SIDE + px
      const isShown = alpha / ((y1 - y0) * (x1 - x0)) >= 128
      shows[i] = isShown ? 1 : 0
      if (!isShown) continue
      points.shown++
      const out = i * 3
      const linR = r / alpha
      const linG = g / alpha
      const linB = b / alpha
      linear[out] = linR
      linear[out + 1] = linG
      linear[out + 2] = linB
      encoded[out] = encode(linR)
      encoded[out + 1] = encode(linG)
      encoded[out + 2] = encode(linB)
    }
  }
}

/**
 * The shape that splits the points in the two groups closest to their own averages (least squared
 * error, measured on the encoded values, which is closer to what the eye sees); none where one
 * color is as close. Part see-through, the shape that best parts the points that show from the rest.
 */
function shapeOf ({ encoded, shows, shown }: Points) {
  let best: Shape | undefined
  if (shown < POINTS) {
    let bestMatches = -1
    for (const candidate of SHAPES) {
      let matches = 0
      for (let i = 0; i < POINTS; i++) matches += candidate.inside[i] === shows[i] ? 1 : 0
      if (matches > bestMatches) {
        bestMatches = matches
        best = candidate
      }
    }
    return best
  }
  // Each split's error is the total of the squares less what its two groups' averages explain: the
  // largest |sum|² / count over the two groups is the least error.
  let total0 = 0
  let total1 = 0
  let total2 = 0
  for (let i = 0; i < POINTS * 3; i += 3) {
    total0 += encoded[i]!
    total1 += encoded[i + 1]!
    total2 += encoded[i + 2]!
  }
  let bestScore = (total0 ** 2 + total1 ** 2 + total2 ** 2) / POINTS
  for (const candidate of SHAPES) {
    let sum0 = 0
    let sum1 = 0
    let sum2 = 0
    const { inside, count } = candidate
    for (let i = 0; i < POINTS; i++) {
      if (inside[i] === 0) continue
      const at = i * 3
      sum0 += encoded[at]!
      sum1 += encoded[at + 1]!
      sum2 += encoded[at + 2]!
    }
    const out = POINTS - count
    const score =
      sum0 ** 2 / count + (total0 - sum0) ** 2 / out +
      sum1 ** 2 / count + (total1 - sum1) ** 2 / out +
      sum2 ** 2 / count + (total2 - sum2) ** 2 / out
    if (score > bestScore + 1e-6) {
      bestScore = score
      best = candidate
    }
  }
  return best
}

/** The color of the points that show on one side of a shape (all of them with none), mixed in linear light. */
function colorOf ({ linear, shows }: Points, shape: Shape | undefined, side: number) {
  let sum0 = 0
  let sum1 = 0
  let sum2 = 0
  let count = 0
  for (let i = 0; i < POINTS; i++) {
    if (shows[i] === 0 || (shape ? shape.inside[i] : 1) !== side) continue
    const at = i * 3
    sum0 += linear[at]!
    sum1 += linear[at + 1]!
    sum2 += linear[at + 2]!
    count++
  }
  return count === 0 ? DEFAULT_COLOR : (encode(sum0 / count) << 16) | (encode(sum1 / count) << 8) | encode(sum2 / count)
}

/**
 * The picture as a `Raster`'s cells: `columns × rows` block elements, each cell sampled at eight
 * by eight points and drawn with the half, eighth or quarter block that splits them best, in their
 * two colors; the terminal's own color where the picture is see-through.
 */
export function toCells (pixels: Pixels, columns: number, rows: number): string {
  const words = new Uint32Array(columns * rows * 3)
  const points = SCRATCH_POINTS
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      pointsOf(pixels, columns, rows, column, row, points)
      const at = (row * columns + column) * 3
      if (points.shown === 0) {
        words[at] = SPACE
        words[at + 1] = DEFAULT_COLOR
        words[at + 2] = DEFAULT_COLOR
        continue
      }
      const best = shapeOf(points)
      const inside = colorOf(points, best, 1)
      const outside = !best ? inside : points.shown < POINTS ? DEFAULT_COLOR : colorOf(points, best, 0)
      words[at] = best?.glyph ?? UPPER_HALF
      words[at + 1] = inside
      words[at + 2] = outside
    }
  }
  return new Uint8Array(words.buffer).toBase64()
}
