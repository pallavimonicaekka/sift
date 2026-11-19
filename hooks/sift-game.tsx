// Sift, redrawn for a Claude Code panel: the same files, clusters and bins as
// game/index.html, drawn in text cells instead of a canvas.
//
// Every Text is drawn `mono`: the desktop app otherwise uses a proportional
// font, so a row of digits drifts away from the cells the pointer reports.
//
// One function, layoutFor(), decides every size and offset: cell width, row
// height, where the grid starts. Drawing, hover and click mapping all read the
// same layout, so the cell under the pointer is always the cell drawn there.
import type { ClientModule, JsonValue, RenderElement } from 'claude-code'

type Saved = { file: number; seed: number; refined: number[] }
type Mode = 'idle' | 'working' | 'ready'
type Props = { game: Saved | null; mode: Mode; music?: 'none' | 'on' | 'muted'; paneRows?: number }
type Drag = { c0: number; r0: number; c1: number; r1: number; moved: boolean }
type State = {
  file: number
  seed: number
  refined: number[]
  sel: number[]
  drag: Drag | null
  ptr: { x: number; y: number } | null
  tick: number
  status: string
  tone: '' | 'good' | 'bad'
  toneUntil: number
  fresh: { k: number; until: number }[]
  shake: { cells: number[]; until: number } | null
  landed: { ti: number; until: number } | null
  // The opening scramble: digits flicker, then settle left to right.
  intro: { start: number } | null
}

const COLS = 18
const ROWS = 10
const N = COLS * ROWS
const TICK_MS = 110
const ticks = (ms: number) => Math.round(ms / TICK_MS)

// Clusters are told apart by how they move, never by colour. These two tones
// are only for feedback: a good sort, a wrong one, and "Claude is ready".
const GOOD_TONE = '#7fa35a'
const BAD_TONE = '#d0693c'

// Each kind's motion: Drizzle drifts down and fades, Static jumps sideways and
// flickers, Ember pulses faint to bold in place, Bloom swells with marks either side.
const TYPES = [
  { name: 'Drizzle', sample: 4 },
  { name: 'Static', sample: 7 },
  { name: 'Ember', sample: 2 },
  { name: 'Bloom', sample: 9 },
]
const NAMES = ['Larkspur', 'Quince', 'Tamarind', 'Halcyon', 'Juniper', 'Ochre', 'Saffron', 'Wren', 'Indigo', 'Kestrel', 'Sorrel', 'Marigold', 'Fennel', 'Lumen', 'Cardamom', 'Heron', 'Velvet', 'Copper']
const GOOD = ['Sorted. Quietly done.', 'Into the bin. Well spotted.', 'Clean sort.', 'Settled.', 'Good eye.']
// Each message has a long form and a short one for narrow panels, joined by '|'.
const FIRST_HINT = 'Move slowly. Drag over numbers that stir, then sort.|Drag numbers that stir, then sort.'
const BREATH = ['·  ', '·· ', '···', '·· ']

// ---------------------------------------------------------------------------
// Opening scramble: every digit flickers, then settles on its real value in a
// soft left-to-right wave (about 1.4 s), with a one-beat bold as it lands.
// ---------------------------------------------------------------------------

const INTRO_SWEEP = 9 // ticks for the wave to cross the grid
const INTRO_JITTER = 4 // up to this many ticks of per-cell randomness
const INTRO_TICKS = INTRO_SWEEP + INTRO_JITTER + 1 // plus the bold beat
const introRunning = (s: { intro: { start: number } | null; tick: number }) =>
  s.intro !== null && s.tick < s.intro.start + INTRO_TICKS
// The tick a cell settles on, from its column and its own fixed random phase.
const settleTick = (start: number, c: number, phase: number) =>
  start + Math.round((c / COLS) * INTRO_SWEEP) + Math.floor((phase / (Math.PI * 2)) * INTRO_JITTER)
const randomLetter = (like: string) => {
  const ch = String.fromCharCode(97 + ((Math.random() * 26) | 0))
  return like === like.toUpperCase() ? ch.toUpperCase() : ch
}

// ---------------------------------------------------------------------------
// Layout: the single source of truth for sizes and offsets.
// ---------------------------------------------------------------------------

type Layout = {
  kind: 'big' | 'roomy' | 'compact' | 'narrow'
  cellW: number // columns per cell
  rowH: number // lines per grid row
  glyphH: number // lines the digit itself takes (3 for big digits)
  gridW: number
  gridH: number
  left: number // columns from the region's left edge to the grid
  top: number // lines from the region's top edge to the header
  gridTop: number // lines from the region's top edge to the grid
  binsPerRow: 2 | 4
  chipW: number
  binGap: number
}

const ABOVE_GRID = 3 // header, rule, blank
// blank, status, blank, bins, blank, bottom line(s)
const belowGrid = (binRows: number, bottomRows: number) => 1 + 1 + 1 + binRows + 1 + bottomRows
// "● Claude is ready  Back to chat" beside "Snooze 1h · Turn off" needs this much.
const BOTTOM_ONE_LINE = 52
const CHIP_MIN = 18 // a 5-wide moving sample, " Drizzle", " 1", " ●○"

const CANDIDATES: Pick<Layout, 'kind' | 'cellW' | 'rowH' | 'glyphH'>[] = [
  { kind: 'big', cellW: 5, rowH: 4, glyphH: 3 },
  { kind: 'big', cellW: 5, rowH: 3, glyphH: 3 },
  { kind: 'roomy', cellW: 5, rowH: 2, glyphH: 1 },
  { kind: 'roomy', cellW: 4, rowH: 2, glyphH: 1 },
  { kind: 'compact', cellW: 3, rowH: 2, glyphH: 1 },
  { kind: 'compact', cellW: 3, rowH: 1, glyphH: 1 },
  { kind: 'narrow', cellW: 2, rowH: 2, glyphH: 1 },
  { kind: 'narrow', cellW: 2, rowH: 1, glyphH: 1 },
]
const SIDE_MARGIN = 2

function layoutFor(columns: number, rows: number): Layout {
  const sized = (c: (typeof CANDIDATES)[number]): Layout => {
    const gridW = COLS * c.cellW
    const gridH = ROWS * c.rowH - (c.rowH - c.glyphH)
    const binGap = c.kind === 'big' ? 2 : 1
    const fitsFour = Math.floor((gridW - 3 * binGap) / 4) >= CHIP_MIN
    const binsPerRow = fitsFour ? 4 : 2
    const chipW = Math.floor((gridW - (binsPerRow - 1) * binGap) / binsPerRow)
    const total = ABOVE_GRID + gridH + belowGrid(binsPerRow === 4 ? 1 : 2, gridW >= BOTTOM_ONE_LINE ? 1 : 2)
    const left = Math.max(0, Math.floor((columns - gridW) / 2))
    const top = rows > 0 ? Math.max(0, Math.floor((rows - total) / 2)) : 0
    return { ...c, gridW, gridH, left, top, gridTop: top + ABOVE_GRID, binsPerRow, chipW, binGap }
  }
  for (const c of CANDIDATES) {
    const l = sized(c)
    const total = ABOVE_GRID + l.gridH + belowGrid(l.binsPerRow === 4 ? 1 : 2, l.gridW >= BOTTOM_ONE_LINE ? 1 : 2)
    const fitsWide = l.gridW + 2 * (c.cellW >= 3 ? SIDE_MARGIN : 1) <= columns
    const fitsTall = rows === 0 || total + 2 <= rows
    if (fitsWide && fitsTall) return l
  }
  // Too short for any: the shortest layout that still fits the width.
  const totalOf = (l: Layout) => ABOVE_GRID + l.gridH + belowGrid(l.binsPerRow === 4 ? 1 : 2, l.gridW >= BOTTOM_ONE_LINE ? 1 : 2)
  const wide = CANDIDATES.map(sized).filter(l => l.gridW + 2 * (l.cellW >= 3 ? SIDE_MARGIN : 1) <= columns)
  if (wide.length) return wide.reduce((a, b) => (totalOf(b) < totalOf(a) ? b : a))
  return sized(CANDIDATES[CANDIDATES.length - 1]!)
}

// Pointer position (cells, relative to the Client region) to a grid cell.
function cellUnder(l: Layout, x: number, y: number, clamp: boolean) {
  const c = Math.floor((x - l.left) / l.cellW)
  const r = Math.floor((y - l.gridTop) / l.rowH)
  const inside = c >= 0 && c < COLS && r >= 0 && r < ROWS && y - l.gridTop < l.gridH
  if (!inside && !clamp) return null
  return { c: Math.max(0, Math.min(COLS - 1, c)), r: Math.max(0, Math.min(ROWS - 1, r)) }
}

// ---------------------------------------------------------------------------
// Big digits: a 3 × 5 pixel font drawn with half blocks, three lines tall.
// ---------------------------------------------------------------------------

const PIX = [
  ['###', '#.#', '#.#', '#.#', '###'],
  ['.#.', '##.', '.#.', '.#.', '###'],
  ['###', '..#', '###', '#..', '###'],
  ['###', '..#', '###', '..#', '###'],
  ['#.#', '#.#', '###', '..#', '..#'],
  ['###', '#..', '###', '..#', '###'],
  ['###', '#..', '###', '#.#', '###'],
  ['###', '..#', '..#', '..#', '..#'],
  ['###', '#.#', '###', '#.#', '###'],
  ['###', '#.#', '###', '..#', '###'],
]
// The lines of one big digit in a canvas `lines` tall, dropped `drop` pixels.
function bigGlyph(d: number, lines: number, drop: number): string[] {
  const px: string[] = Array(lines * 2).fill('...')
  PIX[d]!.forEach((row, i) => {
    if (i + drop < px.length) px[i + drop] = row
  })
  const out: string[] = []
  for (let li = 0; li < lines; li++) {
    const a = px[li * 2]!
    const b = px[li * 2 + 1]!
    let s = ''
    for (let x = 0; x < 3; x++) {
      const t = a[x] === '#'
      const u = b[x] === '#'
      s += t && u ? '█' : t ? '▀' : u ? '▄' : ' '
    }
    out.push(s)
  }
  return out
}

// ---------------------------------------------------------------------------
// File generation: the same generator as index.html.
// ---------------------------------------------------------------------------

function rng(a: number) {
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const newSeed = () => (Math.random() * 2147483647) | 0

const nb = (i: number, eight: boolean) => {
  const c = i % COLS
  const r = (i / COLS) | 0
  const out: number[] = []
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue
      if (!eight && dx && dy) continue
      const cc = c + dx
      const rr = r + dy
      if (cc >= 0 && cc < COLS && rr >= 0 && rr < ROWS) out.push(rr * COLS + cc)
    }
  return out
}

type FileData = {
  owner: number[]
  digits: number[]
  phase: number[]
  clusters: { id: number; type: number; cells: number[] }[]
  name: string
}

function genFile(seed: number): FileData {
  const r = rng(seed)
  const owner = new Array<number>(N).fill(-1)
  const digits = new Array<number>(N)
  const phase = new Array<number>(N)
  for (let i = 0; i < N; i++) {
    digits[i] = (r() * 10) | 0
    phase[i] = r() * Math.PI * 2
  }
  const types = [0, 0, 1, 1, 2, 2, 3, 3]
  for (let i = types.length - 1; i > 0; i--) {
    const j = (r() * (i + 1)) | 0
    ;[types[i], types[j]] = [types[j]!, types[i]!]
  }
  const clusters: FileData['clusters'] = []
  const free = (i: number, k: number) =>
    owner[i] === -1 && nb(i, true).every(j => owner[j] === -1 || owner[j] === k)
  for (const type of types) {
    const k = clusters.length
    for (let a = 0; a < 400; a++) {
      const start = (r() * N) | 0
      if (!free(start, k)) continue
      const size = 5 + ((r() * 4) | 0)
      const cells = [start]
      owner[start] = k
      for (let g = 0; g < 300 && cells.length < size; g++) {
        const base = cells[(r() * cells.length) | 0]!
        const opts = nb(base, false).filter(j => free(j, k))
        if (!opts.length) continue
        const j = opts[(r() * opts.length) | 0]!
        owner[j] = k
        cells.push(j)
      }
      if (cells.length < size) {
        cells.forEach(c => (owner[c] = -1))
        continue
      }
      clusters.push({ id: k, type, cells })
      break
    }
  }
  return { owner, digits, phase, clusters, name: NAMES[(seed >>> 3) % NAMES.length]! }
}

let cache: { seed: number; refinedKey: string; data: FileData } | null = null
function fileFor(seed: number, refined: number[]): FileData {
  const refinedKey = refined.join(',')
  if (cache && cache.seed === seed && cache.refinedKey === refinedKey) return cache.data
  const data = genFile(seed)
  for (const k of refined) {
    const cluster = data.clusters[k]
    if (!cluster) continue
    const r = rng(seed ^ ((k + 1) * 7919))
    for (const i of cluster.cells) data.digits[i] = (r() * 10) | 0
  }
  cache = { seed, refinedKey, data }
  return data
}

const pad2 = (n: number) => String(n).padStart(2, '0')

let latestPaneRows = 0
let handlers:
  | { sendTo: (ti: number) => void; nextFile: () => void; post: (type: string) => void }
  | undefined

function dragCells(d: Drag) {
  const out: number[] = []
  const c0 = Math.min(d.c0, d.c1)
  const c1 = Math.max(d.c0, d.c1)
  const r0 = Math.min(d.r0, d.r1)
  const r1 = Math.max(d.r0, d.r1)
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) out.push(r * COLS + c)
  return out
}

// How one cell looks right now: which digit, where it sits, and its style.
type Look = {
  digit: number
  shiftX: number // -1, 0 or 1 column
  drop: number // stages of sinking: 0, 1 or 2
  bold: boolean
  dim: boolean
  faded: boolean // Drizzle at its lowest where there is no room to sink: a dot
  swell: number // Bloom: 0 none, 1 small marks, 2 full marks either side
}

const SiftGame: ClientModule<JsonValue, State> = (rawProps, surface) => {
  const { Box, Text, Button } = surface.elements
  const props = (rawProps ?? {}) as unknown as Props
  latestPaneRows = props.paneRows ?? 0

  if (surface.state === undefined) {
    const g = props.game
    const file = g?.file ?? 1
    const refined0 = g?.refined ?? []
    const init: State = {
      file,
      seed: g?.seed ?? newSeed(),
      refined: refined0,
      sel: [],
      drag: null,
      ptr: null,
      tick: 0,
      status: file === 1 && refined0.length === 0 ? FIRST_HINT : '',
      tone: '',
      toneUntil: 0,
      fresh: [],
      shake: null,
      landed: null,
      intro: { start: 0 },
    }
    const set = (fn: (s: State) => State) => {
      const s = surface.state
      if (s) surface.setState(fn(s))
    }
    const save = (s: State) =>
      surface.post({ type: 'save', game: { file: s.file, seed: s.seed, refined: s.refined } })
    // The region can report fewer rows than the panel has; lay out to the panel.
    const roomRows = () => Math.max(surface.rows, latestPaneRows)
    const layout = () => layoutFor(surface.columns, roomRows())

    const say = (s: State, status: string, tone: State['tone']): State => ({
      ...s,
      status,
      tone,
      toneUntil: s.tick + ticks(2500),
    })

    const sendTo = (ti: number) =>
      set(s => {
        const F = fileFor(s.seed, s.refined)
        if (introRunning(s) || s.refined.length === F.clusters.length) return s
        if (!s.sel.length) return say(s, 'Select restless numbers first.', 'bad')
        const sel = new Set(s.sel)
        const covered = F.clusters.filter(
          c => !s.refined.includes(c.id) && c.cells.filter(i => sel.has(i)).length / c.cells.length >= 0.6,
        )
        const coveredSize = covered.reduce((n, c) => n + c.cells.length, 0)
        const shake = { cells: s.sel, until: s.tick + 3 }
        if (!covered.length) return { ...say(s, 'Nothing there feels off. Watch for movement.|Nothing there feels off.', 'bad'), shake }
        if (sel.size > coveredSize * 2 + 2)
          return { ...say(s, 'Too many calm numbers. Tighten the selection.|Too many calm numbers.', 'bad'), shake }
        const right = covered.filter(c => c.type === ti)
        if (!right.length) return { ...say(s, `Not ${TYPES[ti]!.name}. Watch how they move.|Not ${TYPES[ti]!.name}. Watch them move.`, 'bad'), shake }
        const refined = [...s.refined, ...right.map(c => c.id)]
        const left = F.clusters.length - refined.length
        const line = GOOD[(Math.random() * GOOD.length) | 0]
        const next: State = {
          ...say(s, left ? `${line} ${left} left in this file.|${line} ${left} left.` : 'Last one. File complete.', 'good'),
          refined,
          sel: [],
          fresh: [...s.fresh, ...right.map(c => ({ k: c.id, until: s.tick + ticks(1000) }))],
          landed: { ti, until: s.tick + ticks(550) },
        }
        save(next)
        return next
      })

    const nextFile = () =>
      set(s => {
        const next: State = {
          ...say(s, 'A new file. Move slowly.', ''),
          file: s.file + 1,
          seed: newSeed(),
          refined: [],
          sel: [],
          fresh: [],
          landed: null,
          intro: { start: s.tick },
        }
        save(next)
        return next
      })

    surface.every(TICK_MS, () =>
      set(s => {
        const tick = s.tick + 1
        return { ...s, tick, intro: introRunning({ ...s, tick }) ? s.intro : null }
      }),
    )

    surface.onPointer(ev => {
      // Cells relative to this Client's own region, as the surface reports them.
      const x = ev.fine?.x ?? ev.x + 0.5
      const y = ev.fine?.y ?? ev.y + 0.5
      const l = layout()
      if (ev.type === 'leave') return set(s => (s.drag ? s : { ...s, ptr: null }))
      // Nothing can be picked while the numbers are still decoding.
      const now = surface.state
      if (now && introRunning(now)) return
      if (ev.type === 'down' && ev.button === 'left') {
        const hit = cellUnder(l, x, y, false)
        if (!hit) return
        return set(s => ({ ...s, ptr: { x, y }, drag: { c0: hit.c, r0: hit.r, c1: hit.c, r1: hit.r, moved: false } }))
      }
      if (ev.type === 'move') {
        return set(s => {
          if (!s.drag) return { ...s, ptr: cellUnder(l, x, y, false) ? { x, y } : null }
          const hit = cellUnder(l, x, y, true)!
          const moved = s.drag.moved || hit.c !== s.drag.c0 || hit.r !== s.drag.r0
          return { ...s, ptr: { x, y }, drag: { ...s.drag, c1: hit.c, r1: hit.r, moved } }
        })
      }
      if (ev.type === 'up') {
        return set(s => {
          const d = s.drag
          if (!d) return s
          const sel = new Set(s.sel)
          if (d.moved) {
            for (const i of dragCells(d)) sel.add(i)
          } else {
            const i = d.r0 * COLS + d.c0
            if (sel.has(i)) sel.delete(i)
            else sel.add(i)
          }
          return { ...s, drag: null, sel: [...sel] }
        })
      }
    })

    surface.onKey(ev => {
      const n = parseInt(ev.key, 10)
      if (n >= 1 && n <= 4) return sendTo(n - 1)
      if (ev.key === 'c' || ev.key === 'backspace') return set(s => ({ ...s, sel: [] }))
      if (ev.key === 'return' || ev.key === 'n') {
        const s = surface.state
        if (s && s.refined.length === fileFor(s.seed, s.refined).clusters.length) nextFile()
      }
    })

    handlers = { sendTo, nextFile, post: type => surface.post({ type }) }
    surface.setState(init)
    return <Text mono dimColor>Opening a file…</Text>
  }

  const s = surface.state
  const L = layoutFor(surface.columns, Math.max(surface.rows, props.paneRows ?? 0))
  const W = L.gridW
  const F = fileFor(s.seed, s.refined)
  const t = (s.tick * TICK_MS) / 1000
  const refined = new Set(s.refined)
  const sel = new Set(s.sel)
  const pending = s.drag && s.drag.moved ? new Set(dragCells(s.drag)) : null
  const shaking = s.shake && s.tick < s.shake.until ? new Set(s.shake.cells) : null
  const fresh = new Set<number>()
  for (const f of s.fresh) if (f.until > s.tick) fresh.add(f.k)
  const landed = s.landed && s.tick < s.landed.until ? s.landed.ti : -1
  const total = F.clusters.length
  const isDone = s.refined.length === total
  const isIntro = introRunning(s)
  // Horizontal positions come from Box widths, which the surface lays out in the
  // same cells the pointer reports. Never from counting characters: the desktop
  // app draws a character slightly narrower than a cell, so a row of text drifts.
  const spacer = <Box width={L.left} flexShrink={0} />
  const indent = (el: RenderElement) => (
    <Box flexDirection="row">
      {spacer}
      {el}
    </Box>
  )
  const indentBox = indent

  // ---- header and progress rule ----
  // The file name decodes letter by letter on the same clock as the grid.
  const shownName = isIntro
    ? Array.from(F.name, (ch, j) =>
        s.tick < s.intro!.start + Math.round((j / F.name.length) * INTRO_SWEEP) + 1 ? randomLetter(ch) : ch,
      ).join('')
    : F.name
  const header = indentBox(
    <Box width={W} flexDirection="row" justifyContent="space-between">
      <Text mono bold>Sift</Text>
      <Text mono dimColor>{`File ${pad2(s.file)} · ${shownName}`}</Text>
    </Box>,
  )
  const lit = Math.round((W * s.refined.length) / Math.max(1, total))
  const rule = indent(
    <Text mono>
      <Text mono>{'━'.repeat(lit)}</Text>
      <Text mono dimColor>{'━'.repeat(W - lit)}</Text>
    </Text>,
  )

  // ---- bins ----
  const binDots = (ti: number, full: boolean) =>
    F.clusters
      .filter(c => c.type === ti)
      .map(c => (full || refined.has(c.id) ? '●' : '○'))
      .join('')
  // A five-character stage that plays the kind's motion on a loop, so a bin
  // shows how its numbers move instead of wearing a colour. Each motion is
  // exaggerated here so it reads at a glance.
  type Sample = { text: string; bold?: boolean; dim?: boolean; inverse?: boolean }
  const sampleOf = (ti: number): Sample => {
    const d = String(TYPES[ti]!.sample)
    const ph = t + ti * 0.7
    if (ti === 0) {
      // Drizzle: the digit, fading, sinking to a small digit, a dot, then gone.
      const f = Math.floor(ph * 2.2) % 6
      return [
        { text: `  ${d}  ` },
        { text: `  ${d}  `, dim: true },
        { text: `  ${'₀₁₂₃₄₅₆₇₈₉'[Number(d)]}  `, dim: true },
        { text: '  .  ', dim: true },
        { text: '     ' },
        { text: '     ' },
      ][f]!
    }
    if (ti === 1) {
      // Static: jumps across all five places at random, flickering to other digits.
      const at = (Math.random() * 5) | 0
      const shown = Math.random() < 0.3 ? String((Math.random() * 10) | 0) : d
      return { text: ' '.repeat(at) + shown + ' '.repeat(4 - at) }
    }
    if (ti === 2) {
      // Ember: a heartbeat in place, faint, then bright, then a solid flash.
      const v = 0.5 + 0.5 * Math.sin(ph * 5)
      if (v > 0.8) return { text: `  ${d}  `, bold: true, inverse: true }
      return { text: `  ${d}  `, bold: v > 0.5, dim: v < 0.3 }
    }
    // Bloom: swells outward, marks growing to both edges, then settles.
    const v = 0.5 + 0.5 * Math.sin(ph * 1.6)
    if (v > 0.75) return { text: `·•${d}•·`, bold: true }
    if (v > 0.4) return { text: ` ·${d}· ` }
    return { text: `  ${d}  ` }
  }
  const SAMPLE_W = 5
  const chip = (ti: number, full: boolean, asButton: boolean, w: number) => {
    const type = TYPES[ti]!
    const isLanded = landed === ti
    const sm = sampleOf(ti)
    // The sample sits outside the Button in its own fixed-width Box, so the
    // button's own look cannot flatten its faint, bold and solid steps.
    const sample = (
      <Box width={SAMPLE_W}>
        <Text
          mono
          {...(sm.bold ? { bold: true } : {})}
          {...(sm.dim ? { dimColor: true } : {})}
          {...(sm.inverse ? { inverse: true } : {})}
        >
          {sm.text}
        </Text>
      </Box>
    )
    const label = [
      <Text mono bold={isLanded}> {type.name}</Text>,
      ...(asButton ? [<Text mono dimColor> {ti + 1}</Text>] : []),
      <Text mono bold={isLanded} dimColor={!isLanded}>
        {' '}
        {binDots(ti, full)}
      </Text>,
    ]
    return (
      <Box width={w} flexDirection="row">
        {sample}
        {asButton ? (
          <Button key={`bin-${ti}`} plain onPress={() => handlers?.sendTo(ti)}>
            {label}
          </Button>
        ) : (
          <Text mono>{label}</Text>
        )}
      </Box>
    )
  }
  const binsRows = (full: boolean, asButtons: boolean, w: number) => {
    const per = asButtons ? L.binsPerRow : 4
    const chipW = asButtons ? L.chipW : 16
    const rows: RenderElement[] = []
    for (let start = 0; start < 4; start += per) {
      rows.push(
        <Box width={w} flexDirection="row" columnGap={L.binGap}>
          {TYPES.slice(start, start + per).map((_, j) => chip(start + j, full, asButtons, chipW))}
        </Box>,
      )
    }
    return <Box flexDirection="column">{rows}</Box>
  }

  // ---- how a cell looks this frame ----
  const lookOf = (i: number, r: number, c: number): Look => {
    const k = F.owner[i]!
    const isActive = k >= 0 && !refined.has(k)
    const digit = F.digits[i]!
    const look: Look = { digit, shiftX: 0, drop: 0, bold: false, dim: true, faded: false, swell: 0 }
    if (isIntro) {
      const at = settleTick(s.intro!.start, c, F.phase[i]!)
      // Before it settles: a random digit, dim. The tick it lands: its real digit, bold.
      if (s.tick < at) return { ...look, digit: (Math.random() * 10) | 0 }
      if (s.tick === at) return { ...look, bold: true, dim: false }
      return look
    }
    let I = 0
    if (isActive && s.ptr) {
      const px = (s.ptr.x - L.left) / L.cellW
      const py = (s.ptr.y - L.gridTop) / L.rowH
      const d = Math.hypot(px - (c + 0.5), py - (r + 0.5))
      const p = Math.max(0, Math.min(1, 1 - (d - 0.6) / 2.8))
      I = p * p
    }
    // Calm numbers recede; restless ones brighten as the pointer nears.
    if (isActive && I > 0.15) {
      look.dim = false
      const ph = F.phase[i]!
      const type = F.clusters[k]!.type
      // Each kind is told apart by its motion alone: its direction and rhythm.
      if (type === 0) {
        // Drizzle: slow and downward. Fades, sinks a step, then sinks further
        // (or, with no room below, thins to a dot).
        const v = (0.5 + 0.5 * Math.sin(t * 1.7 + ph)) * I
        if (v > 0.25) look.dim = true
        if (v > 0.5) look.drop = 1
        if (v > 0.75) {
          look.drop = 2
          look.faded = L.rowH === 1
        }
      } else if (type === 1) {
        // Static: fast and sideways. Jumps a column either way, sometimes flickers.
        if (I > 0.55 && Math.random() < 0.12) look.digit = (Math.random() * 10) | 0
        const roll = Math.random()
        look.shiftX = roll < 0.28 * I ? -1 : roll < 0.55 * I ? 1 : 0
      } else if (type === 2) {
        // Ember: quick and in place. A heartbeat from faint to bold.
        const v = (0.5 + 0.5 * Math.sin(t * 4.4 + ph * 0.3)) * I
        look.dim = v < 0.3
        look.bold = v >= 0.55
      } else {
        // Bloom: slow and outward. Swells bold, marks growing either side.
        const v = (0.75 + 0.25 * Math.sin(t * 1.2 + ph * 0.2)) * I
        if (v > 0.3) look.bold = true
        if (v > 0.45) look.swell = 1
        if (v > 0.65) look.swell = 2
      }
    }
    if (k >= 0 && fresh.has(k)) look.dim = true
    if (shaking && shaking.has(i)) {
      look.shiftX = (s.shake!.until - s.tick) % 2 ? -1 : 1
      look.drop = 0
    }
    return look
  }

  // The lines of one cell, each exactly L.cellW wide.
  const cellLines = (look: Look): string[] => {
    const w = L.cellW
    if (L.kind === 'big') {
      const maxDrop = L.rowH * 2 - 5
      const drop = Math.min(maxDrop, look.drop)
      const glyph = bigGlyph(look.digit, L.rowH, drop)
      const padL = Math.max(0, Math.min(w - 3, Math.floor((w - 3) / 2) + look.shiftX))
      return glyph.map((g, li) => {
        // Bloom's swell: marks in the side padding, middle line first, then all three.
        const mark = look.swell === 2 ? (li === 1 ? '•' : li < L.glyphH ? '·' : ' ') : look.swell === 1 && li === 1 ? '·' : ' '
        const left = padL > 0 ? mark + ' '.repeat(padL - 1) : ''
        const rightPad = w - 3 - padL
        const right = rightPad > 0 ? ' '.repeat(rightPad - 1) + mark : ''
        return left + g + right
      })
    }
    const chars = Array.from({ length: L.rowH }, () => Array<string>(w).fill(' '))
    const centre = Math.floor((w - 1) / 2)
    const x = Math.max(0, Math.min(w - 1, centre + look.shiftX))
    // Drizzle sinks into the blank line below at its lowest where there is one,
    // and thins to a dot where there is not.
    const line = L.rowH > 1 && look.drop >= 2 ? 1 : 0
    chars[line]![x] = look.faded ? '.' : String(look.digit)
    if (look.swell > 0) {
      const mark = look.swell === 2 ? '•' : '·'
      if (x - 1 >= 0) chars[line]![x - 1] = mark
      if (x + 1 < w) chars[line]![x + 1] = mark
    }
    return chars.map(row => row.join(''))
  }

  // ---- the grid, or the file-complete message in its place ----
  let middle: RenderElement
  if (isDone) {
    middle = indentBox(
      <Box width={W} height={L.gridH} flexDirection="column" alignItems="center" justifyContent="center">
        <Text mono bold>{`${F.name} is sifted.`}</Text>
        <Text mono> </Text>
        {[0, 1].map(half =>
          W >= 4 * 16 + 3 ? (half === 0 ? (
            <Box flexDirection="row" columnGap={1}>{TYPES.map((_, ti) => chip(ti, true, false, 16))}</Box>
          ) : null) : (
            <Box flexDirection="row" columnGap={1}>{[half * 2, half * 2 + 1].map(ti => chip(ti, true, false, 16))}</Box>
          ),
        )}
        <Text mono> </Text>
        <Button key="next" variant="primary" label="Open next file" onPress={() => handlers?.nextFile()} />
      </Box>,
    )
  } else {
    const lines: RenderElement[] = []
    for (let r = 0; r < ROWS; r++) {
      const perLine: RenderElement[][] = Array.from({ length: L.rowH }, () => [])
      const lineHasInk: boolean[] = Array.from({ length: L.rowH }, () => false)
      for (let c = 0; c < COLS; c++) {
        const i = r * COLS + c
        const look = lookOf(i, r, c)
        const isSel = sel.has(i) || (pending !== null && pending.has(i))
        const cl = cellLines(look)
        cl.forEach((text, li) => {
          const inCell = li < L.glyphH
          // Each cell is its own fixed-width Box, so the cell under the pointer is
          // the cell drawn there. A selection tints the whole cell. Only props that
          // are on are written: the big layout draws ~700 of these, and a drawing
          // must stay under the surface's size limit.
          const boxProps = isSel && inCell ? { width: L.cellW, backgroundColor: 'subtle' } : { width: L.cellW }
          const textProps = {
            mono: true as const,
            ...(look.bold || isSel ? { bold: true } : {}),
            ...(look.dim && !isSel ? { dimColor: true } : {}),
          }
          perLine[li]!.push(
            <Box {...boxProps}>
              <Text {...textProps}>{text}</Text>
            </Box>,
          )
          if (text.trim() || (isSel && inCell)) lineHasInk[li] = true
        })
      }
      const lineCount = r === ROWS - 1 ? L.glyphH : L.rowH
      for (let li = 0; li < lineCount; li++)
        // A line with nothing on it (the breathing space between rows) is one
        // blank line, not 18 empty cells.
        lines.push(
          lineHasInk[li] ? (
            <Box flexDirection="row" height={1}>
              {spacer}
              {perLine[li]}
            </Box>
          ) : (
            <Text mono> </Text>
          ),
        )
    }
    middle = <Box flexDirection="column">{lines}</Box>
  }

  // ---- status line (one line, never wraps) ----
  const isToned = s.tone !== '' && s.tick < s.toneUntil
  const statusColor = isToned ? (s.tone === 'good' ? GOOD_TONE : BAD_TONE) : undefined
  // The long form when it fits the grid's width, else the short one.
  const statusNow = isIntro ? `Opening a file ${BREATH[s.tick % BREATH.length]}` : s.status
  const [longForm = '', shortForm] = statusNow.split('|')
  const statusText = longForm.length <= W || !shortForm ? longForm : shortForm
  const status = indent(
    <Text mono color={statusColor} dimColor={!isToned} maxLines={1}>
      {(statusText || ' ').slice(0, W)}
    </Text>,
  )

  // ---- bottom line: Claude on the left, quiet controls on the right ----
  const mode = props.mode ?? 'idle'
  const breath = BREATH[Math.floor((s.tick * TICK_MS) / 650) % BREATH.length]
  const claude =
    mode === 'ready' ? (
      <Box flexDirection="row" columnGap={2}>
        <Text mono color={GOOD_TONE}>● Claude is ready</Text>
        <Button key="back" plain label="Back to chat" onPress={() => handlers?.post('close')} />
      </Box>
    ) : mode === 'working' ? (
      <Text mono dimColor>{`Claude is working ${breath}`}</Text>
    ) : (
      <Text mono> </Text>
    )
  const isStacked = W < BOTTOM_ONE_LINE
  const bottom = indentBox(
    <Box width={W} flexDirection={isStacked ? "column" : "row"} justifyContent="space-between">
      {claude}
      <Box flexDirection="row">
        {props.music === 'on' || props.music === 'muted'
          ? [
              <Button
                key="mute"
                plain
                dimColor
                label={props.music === 'on' ? '♪ Mute' : '♪ Unmute'}
                onPress={() => handlers?.post('mute')}
              />,
              <Text mono dimColor> · </Text>,
            ]
          : null}
        <Button key="snooze" plain dimColor label="Snooze 1h" onPress={() => handlers?.post('snooze')} />
        <Text mono dimColor> · </Text>
        <Button key="off" plain dimColor label="Turn off" onPress={() => handlers?.post('off')} />
      </Box>
    </Box>,
  )

  const topSpace: RenderElement[] = Array.from({ length: L.top }, () => <Text mono> </Text>)
  return (
    <Box flexDirection="column">
      {topSpace}
      {header}
      {rule}
      <Text mono> </Text>
      {middle}
      <Text mono> </Text>
      {!isDone && status}
      {!isDone && <Text mono> </Text>}
      {!isDone && indentBox(binsRows(false, true, W))}
      {!isDone && <Text mono> </Text>}
      {bottom}
    </Box>
  )
}

export default SiftGame
