import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  plugin: 'sift',
  component: 'Pane',
  requestId: 'sift',
  props: {
    title: 'Sift',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

const setup = async ($: any, on: any, extra?: () => void) => {
  const clock = mock.clock(on)
  mock.store(on)
  const opened: string[] = []
  const closed: string[] = []
  on('command.register', () => ({ value: { command: 'sift' } }))
  on('ui.open', (_: unknown, e: { id: string }) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.close', (_: unknown, e: { id: string }) => {
    closed.push(e.id)
    return { value: undefined }
  })
  on('ui.toast', () => ({ value: undefined }))
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('turn.start', (_: unknown, e: { turnId: string }) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: 'done' }))
  extra?.()
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  return { clock, opened, closed }
}

test('a quick reply never opens Sift', async ($, on) => {
  const { clock, opened } = await setup($, on)
  await $.turn.start({ text: 'hi', turnId: 't1' })
  await clock.advance(2000)
  await $.turn.complete({ reason: 'answer' } as any)
  await clock.advance(5000)
  expect(opened.length).toBe(0)
})

test('Sift opens after 4 seconds of work, then closes when Claude is done', async ($, on) => {
  const { clock, opened, closed } = await setup($, on)
  await $.turn.start({ text: 'build it', turnId: 't1' })
  await clock.advance(4100)
  expect(opened).toEqual(['sift'])
  expect(closed).toEqual([])

  await $.turn.complete({ reason: 'answer' } as any)
  expect(closed).toEqual(['sift'])
})

test('a quick reply with Sift closed does not try to close it', async ($, on) => {
  const { clock, closed } = await setup($, on)
  await $.turn.start({ text: 'hi', turnId: 't1' })
  await clock.advance(1000)
  await $.turn.complete({ reason: 'answer' } as any)
  expect(closed).toEqual([])
})

test('turning Sift off keeps it closed on the next long turn', async ($, on) => {
  const { clock, opened } = await setup($, on)
  await $.command.run({ command: 'sift', args: 'off' } as any)
  await $.turn.start({ text: 'long', turnId: 't2' })
  await clock.advance(10000)
  expect(opened.length).toBe(0)
})

test('the game draws a file in the panel', async ($, on) => {
  await setup($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.resize({ columns: 60, rows: 20, in: 'game' })
  await ui.advance(1800) // past the opening scramble
  const head = await ui.find({ type: 'Text', text: /File 01/, in: 'game' })
  expect(head).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /Move slowly/, in: 'game' })).toBeTruthy()
  // Four bins plus Snooze and Turn off.
  expect(await ui.findAll({ type: 'Button', in: 'game' })).toHaveLength(6)
  // Sorting with nothing selected says so, gently.
  await ui.key({ key: '1', in: 'game' })
  const hint = await ui.find({ type: 'Text', text: /Select restless/, in: 'game' })
  expect(hint).toBeTruthy()
  // A drag over the grid selects and the game keeps running.
  await ui.pointer({ type: 'down', x: 4, y: 10, button: 'left', in: 'game' })
  await ui.pointer({ type: 'move', x: 13, y: 13, button: 'left', in: 'game' })
  await ui.pointer({ type: 'up', x: 13, y: 13, button: 'left', in: 'game' })
  await ui.advance(500)
  await ui.key({ key: '1', in: 'game' })
  expect(await ui.find({ type: 'Text', text: /Select restless/, in: 'game' })).toBeFalsy()
  await ui.unmount()
})

test('a new file opens with a scramble that settles, and input waits for it', async ($, on) => {
  await setup($, on)
  const ui: any = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.resize({ columns: 60, rows: 30, in: 'game' })
  const gridText = async () => {
    const out: string[] = []
    const walk = (n: any) => {
      if (n == null || typeof n !== 'object') return
      if (Array.isArray(n)) return n.forEach(walk)
      // Grid cells only: the 5-wide bin samples keep moving by design.
      if (n.type === 'Box' && n.props?.width === 3 && n.children?.[0]?.type === 'Text')
        out.push(JSON.stringify(n.children[0].children))
      ;(n.children ?? []).forEach(walk)
    }
    walk(await ui.drawn({ in: 'game' }))
    return out.join('')
  }
  await ui.advance(220)
  expect(await ui.find({ type: 'Text', text: /Opening a file/, in: 'game' })).toBeTruthy()
  // Mid-scramble the digits keep changing from frame to frame.
  const a = await gridText()
  await ui.advance(110)
  const b = await gridText()
  expect(a).not.toBe(b)
  // Sorting is ignored while it decodes.
  await ui.key({ key: '1', in: 'game' })
  expect(await ui.find({ type: 'Text', text: /Select restless/, in: 'game' })).toBeFalsy()
  // Once settled, the grid holds still (the pointer is away) and the hint shows.
  await ui.advance(1800)
  expect(await ui.find({ type: 'Text', text: /Opening a file/, in: 'game' })).toBeFalsy()
  expect(await ui.find({ type: 'Text', text: /Move slowly/, in: 'game' })).toBeTruthy()
  const c = await gridText()
  await ui.advance(330)
  expect(await gridText()).toBe(c)
  await ui.key({ key: '1', in: 'game' })
  expect(await ui.find({ type: 'Text', text: /Select restless/, in: 'game' })).toBeTruthy()
  await ui.unmount()
})

test('a chosen music file loops while the panel is open and stops when it closes', async ($, on) => {
  const plays: { mime: string; loop: boolean }[] = []
  const { clock } = await setup($, on, () => {
    on('fs.exists', () => ({ value: true }))
    on('fs.stat', () => ({ value: { kind: 'file', size: 1000, mtimeMs: 0, isLink: false } }))
    on('fs.read', () => ({ value: { base64: 'AAAA' } }))
    on('audio.play', (_: unknown, e: any) => {
      plays.push({ mime: e.clip.mime, loop: e.shouldLoop === true })
      return { value: undefined }
    })
  })
  await $.command.run({ command: 'sift', args: 'music /tmp/My Song.mp3' } as any)
  await $.turn.start({ text: 'long', turnId: 't6' })
  await clock.advance(4100)
  expect(plays).toHaveLength(1)
  expect(plays[0]!.mime).toBe('audio/mpeg')
  expect(plays[0]!.loop).toBe(true)
  // The panel shows a mute control while music is chosen.
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.advance(300)
  expect(await ui.find({ type: 'Button', key: 'mute', in: 'game' })).toBeTruthy()
  await ui.unmount()
  // Muting from the command, then unmuting with the panel open, plays it again.
  await $.command.run({ command: 'sift', args: 'music' } as any)
  expect(plays).toHaveLength(1)
  await $.command.run({ command: 'sift', args: 'music' } as any)
  await clock.advance(10)
  expect(plays).toHaveLength(2)
})

test('a large panel draws ordinary digits in wider cells, never block shapes', async ($, on) => {
  await setup($, on)
  const ui: any = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.resize({ columns: 160, rows: 60, in: 'game' })
  await ui.advance(1800)
  const tree = JSON.stringify(await ui.drawn({ in: 'game' }))
  expect(/[▀▄█]/.test(tree)).toBe(false)
  // Cells grow with the panel: a 160-column panel gets 7-wide cells.
  expect(tree).toContain('"width":7')
  await ui.unmount()
})

test('a finished file shows its quiet message and the next-file button', async ($, on) => {
  mock.clock(on)
  mock.store(on, { game: { file: 3, seed: 424242, refined: [0, 1, 2, 3, 4, 5, 6, 7] } })
  on('command.register', () => ({ value: { command: 'sift' } }))
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.advance(300)
  expect(await ui.find({ type: 'Text', text: /is sifted\./, in: 'game' })).toBeTruthy()
  expect(await ui.find({ type: 'Button', key: 'next', in: 'game' })).toBeTruthy()
  // The bins inside the message are not buttons: only next, Snooze and Turn off.
  expect(await ui.findAll({ type: 'Button', in: 'game' })).toHaveLength(3)
  await ui.unmount()
})

test('while Claude works, the bottom line breathes', async ($, on) => {
  await setup($, on)
  await $.turn.start({ text: 'go', turnId: 't3' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.advance(300)
  const first = await ui.find({ type: 'Text', text: /Claude is working/, in: 'game' })
  await ui.advance(700)
  const later = await ui.find({ type: 'Text', text: /Claude is working/, in: 'game' })
  expect(first?.text).not.toBe(later?.text)
  await ui.unmount()
})

test('every piece of game text is fixed-width, so the grid lines up with the pointer', async ($, on) => {
  await setup($, on)
  await $.turn.start({ text: 'go', turnId: 't4' })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui: any = await $.ui.mount({ ...PANE, surface })
    await ui.resize({ columns: 100, rows: 45, in: 'game' })
    await ui.advance(300)
    const notMono: string[] = []
    const walk = (n: any) => {
      if (n == null || typeof n !== 'object') return
      if (Array.isArray(n)) return n.forEach(walk)
      if (n.type === 'Text' && n.props?.mono !== true) notMono.push(JSON.stringify(n).slice(0, 60))
      ;(n.children ?? []).forEach(walk)
    }
    walk(await ui.drawn({ in: 'game' }))
    expect(notMono).toEqual([])
    await ui.unmount()
  }
})

test('clusters are told apart by motion alone: no colour on the grid or bins', async ($, on) => {
  await setup($, on)
  await $.turn.start({ text: 'go', turnId: 't5' })
  const ui: any = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.resize({ columns: 100, rows: 45, in: 'game' })
  await ui.advance(3000) // let any status tone fade
  const coloured: string[] = []
  const walk = (n: any) => {
    if (n == null || typeof n !== 'object') return
    if (Array.isArray(n)) return n.forEach(walk)
    if (n.type === 'Text' && n.props?.color) coloured.push(JSON.stringify(n).slice(0, 80))
    ;(n.children ?? []).forEach(walk)
  }
  // Sweep the pointer over the grid so every kind gets a chance to stir.
  for (let y = 4; y < 40; y += 3)
    for (let x = 3; x < 97; x += 4) {
      await ui.pointer({ type: 'move', x, y, in: 'game' })
      await ui.advance(110)
      walk(await ui.drawn({ in: 'game' }))
    }
  expect(coloured).toEqual([])
  await ui.unmount()
})

test('every grid cell is its own fixed-width box, so selection cannot drift across a row', async ($, on) => {
  await setup($, on)
  for (const [columns, rows] of [[46, 44], [93, 44], [130, 60]] as const) {
    const ui: any = await $.ui.mount({ ...PANE, surface: 'desktop' })
    await ui.resize({ columns, rows, in: 'game' })
    await ui.advance(300)
    let cellBoxes = 0
    let looseGridText = 0
    const walk = (n: any, inCell: boolean) => {
      if (n == null || typeof n !== 'object') return
      if (Array.isArray(n)) return n.forEach(x => walk(x, inCell))
      const isCell = n.type === 'Box' && typeof n.props?.width === 'number' && n.props.width > 0 && n.children?.[0]?.type === 'Text'
      if (isCell) cellBoxes++
      ;(n.children ?? []).forEach((x: any) => walk(x, inCell || isCell))
    }
    const tree = await ui.drawn({ in: 'game' })
    walk(tree, false)
    // Well under the surface's 100,000-character limit, with room for selections.
    expect(JSON.stringify(tree).length).toBeLessThan(80000)
    // 18 cells on each of at least 10 grid lines (plus the margin spacers).
    expect(cellBoxes).toBeGreaterThanOrEqual(180)
    expect(looseGridText).toBe(0)
    await ui.unmount()
  }
})

test('each bin plays a clearly changing motion sample', async ($, on) => {
  await setup($, on)
  const ui: any = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.resize({ columns: 93, rows: 44, in: 'game' })
  const seen: Set<string>[] = [new Set(), new Set(), new Set(), new Set()]
  // A sample is the 5-wide Box just before each bin's Button.
  const collect = (n: any) => {
    if (n == null || typeof n !== 'object') return
    if (Array.isArray(n)) return n.forEach(collect)
    if (n.type === 'Box' && n.props?.flexDirection === 'row') {
      const kids = (n.children ?? []).flat()
      const btn = kids.find((k: any) => k?.type === 'Button' && /^bin-\d$/.test(k.key ?? k.props?.key ?? ''))
      const box = kids.find((k: any) => k?.type === 'Box' && k.props?.width === 5)
      if (btn && box) {
        const ti = Number(String(btn.key ?? btn.props.key).slice(4))
        seen[ti]!.add(JSON.stringify(box.children))
      }
    }
    ;(n.children ?? []).forEach(collect)
  }
  for (let i = 0; i < 30; i++) {
    await ui.advance(110)
    collect(await ui.drawn({ in: 'game' }))
  }
  for (const states of seen) expect(states.size).toBeGreaterThanOrEqual(3)
  await ui.unmount()
})
