import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { SiftGame, SiftMode, SiftMusic, SiftPrefs } from '../types'

// How long Claude must be working before Sift opens on its own.
const OPEN_DELAY_MS = 4000
const SNOOZE_MS = 60 * 60 * 1000
const PANE = 'sift'

const mode = atom({ plugin: 'sift', key: 'mode' } as const, 'idle' as SiftMode)
const game = atom({ plugin: 'sift', key: 'game' } as const, null as SiftGame | null, {
  shape: 'game-1',
})
const prefs = atom(
  { plugin: 'sift', key: 'prefs' } as const,
  { off: false, snoozeUntil: 0 } as SiftPrefs,
  { shape: 'prefs-1' },
)

const music = atom({ plugin: 'sift', key: 'music' } as const, 'on' as SiftMusic)

const isGame = (g: unknown): g is SiftGame =>
  typeof g === 'object' &&
  g !== null &&
  typeof (g as SiftGame).file === 'number' &&
  typeof (g as SiftGame).seed === 'number' &&
  Array.isArray((g as SiftGame).refined) &&
  (g as SiftGame).refined.every(k => typeof k === 'number')

// The session's moment-to-moment facts. A reload starts these over, which is
// harmless: the next turn sets them again.
let isWorking = false
let isPaneOpen = false
let turnSeq = 0
let timer: { cancel: () => void } | undefined

// Sift asks for about 80% of the window. The surface caps what it grants (the
// terminal at 45%), and a width the person drags to always wins and is kept.
const SHARE = 0.8

// ---------------------------------------------------------------------------
// Music: "Uneasy Piano" (made with Suno on a Pro plan by Sift's author, who
// owns it), shipped in assets/ and looped quietly while the panel is open. A person can
// swap in a file from their own computer with `/sift music <path>`: only its
// path is remembered, and that file is never copied into the plugin.
// ---------------------------------------------------------------------------

const MUSIC_GAIN = 0.35
const THEME_ASSET = 'assets/uneasy-piano.m4a'
const MAX_MUSIC_BYTES = 4 * 1024 * 1024 // what one file read can return
let playing: AbortController | undefined

const mimeFor = (path: string) => {
  const ext = path.toLowerCase().split('.').pop()
  return ext === 'wav' ? 'audio/wav' : ext === 'm4a' || ext === 'aac' ? 'audio/mp4' : ext === 'ogg' ? 'audio/ogg' : 'audio/mpeg'
}

function stopMusic() {
  playing?.abort()
  playing = undefined
}

async function startMusic($: EngineInterface) {
  if (playing || (await read($, music)) !== 'on') return
  const path = (await $.store.get('musicPath')) as string | undefined
  const controller = new AbortController()
  playing = controller
  try {
    const options = { shouldLoop: true as const, gain: MUSIC_GAIN, signal: controller.signal }
    if (!path) {
      await $.audio.play({ asset: THEME_ASSET }, options)
      return
    }
    const { base64 } = (await $.fs.read(path, { as: 'bytes' })) as { base64: string }
    if (controller.signal.aborted) return
    await $.audio.play({ base64, mime: mimeFor(path) }, options)
  } catch {
    $.ui.toast(path ? 'Sift could not play your music file. Type /sift music sift to go back to Sift\'s theme.' : 'Sift could not play its music here.')
  } finally {
    if (playing === controller) playing = undefined
  }
}

async function setMusicMuted($: EngineInterface, muted: boolean) {
  await update($, music, () => (muted ? 'muted' : 'on'))
  await $.store.set('musicMuted', muted)
  if (muted) stopMusic()
  else if (isPaneOpen) void startMusic($)
}

async function openPane($: EngineInterface) {
  isPaneOpen = true
  const windowColumns = Number((await $.store.get('windowColumns')) ?? 0)
  const columns = windowColumns > 0 ? Math.round(windowColumns * SHARE) : 160
  await $.ui.open({ id: PANE, title: 'Sift', columns })
  void startMusic($)
}

async function closePane($: EngineInterface) {
  isPaneOpen = false
  stopMusic()
  await update($, mode, () => (isWorking ? 'working' : 'idle'))
  await $.ui.close({ id: PANE })
}

async function savePrefs($: EngineInterface, next: SiftPrefs) {
  await update($, prefs, () => next)
  await $.store.set('prefs', next)
}

async function snooze($: EngineInterface) {
  const now = await $.clock.now()
  await savePrefs($, { off: false, snoozeUntil: now + SNOOZE_MS })
  await closePane($)
  $.ui.toast('Sift is snoozed for an hour. Type /sift on to wake it sooner.')
}

async function turnOff($: EngineInterface) {
  await savePrefs($, { off: true, snoozeUntil: 0 })
  await closePane($)
  $.ui.toast('Sift is off. Type /sift on to bring it back, or /sift to play now.')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const storedPrefs = (await $.store.get('prefs')) as SiftPrefs | undefined
    if (storedPrefs && typeof storedPrefs.off === 'boolean') {
      await update($, prefs, () => storedPrefs)
    }
    const storedGame = await $.store.get('game')
    if (isGame(storedGame)) await update($, game, () => storedGame)
    const musicMuted = (await $.store.get('musicMuted')) === true
    await update($, music, () => (musicMuted ? 'muted' : 'on'))

    await $.command.register({
      name: 'sift',
      description: 'Sift: play now, or "on", "off", "snooze", "browser", "music"',
      argumentHint: '[on | off | snooze | browser | music [on | off | sift | <file>]]',
    })

    return next(e)
  })

  on('command.run', { command: 'sift' }, async ($, e) => {
    const raw = e.args.trim()
    const arg = raw.toLowerCase()
    if (arg === 'music' || arg.startsWith('music ')) {
      // Keep the path's own spelling; strip quotes a pasted path may carry.
      let path = raw.slice(5).trim().replace(/^["']|["']$/g, '')
      const word = path.toLowerCase()
      if (word === '' || word === 'off' || word === 'on') {
        const muted = word === '' ? (await read($, music)) === 'on' : word === 'off'
        await setMusicMuted($, muted)
        return { text: muted ? 'Sift music is muted.' : 'Sift music is on.' }
      }
      if (word === 'sift' || word === 'default') {
        stopMusic()
        await $.store.set('musicPath', '')
        await setMusicMuted($, false)
        return { text: "Sift will play its own theme. Your music file was not touched." }
      }
      if (path.startsWith('~/')) path = `${await $.env.get('HOME')}/${path.slice(2)}`
      if (!(await $.fs.exists(path))) return { text: `Could not find a file at ${path}` }
      const { size } = await $.fs.stat(path)
      if (size > MAX_MUSIC_BYTES) return { text: 'That file is over 4 MB. Choose a shorter clip or a smaller (lower bitrate) file.' }
      stopMusic()
      await $.store.set('musicPath', path)
      await setMusicMuted($, false)
      return { text: 'Sift will play that file quietly while the panel is open. Mute it from the panel, or type /sift music.' }
    }
    if (arg === 'off') {
      await turnOff($)
      return { text: 'Sift is off. It will not open on its own until you type /sift on.' }
    }
    if (arg === 'snooze') {
      await snooze($)
      return { text: 'Sift is snoozed for an hour.' }
    }
    if (arg === 'on') {
      await savePrefs($, { off: false, snoozeUntil: 0 })
      return { text: 'Sift is on. It opens when Claude has been working for a few seconds.' }
    }
    if (arg === 'browser') {
      const file = `${$.plugin.root}/game/index.html`
      for (const opener of ['open', 'xdg-open']) {
        try {
          const ran = await $.process.run([opener, file])
          if (ran.exitCode === 0) return { text: 'Opened the full Sift in your browser.' }
        } catch {
          // try the next opener
        }
      }
      return { text: `Could not open a browser. The game file is at ${file}` }
    }
    await openPane($)
    return { text: 'Sift is open beside the chat.' }
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)

    isWorking = true
    turnSeq += 1
    const thisTurn = turnSeq
    timer?.cancel()
    timer = undefined
    await update($, mode, () => 'working')

    const p = await read($, prefs)
    const now = await $.clock.now()
    if (!p.off && p.snoozeUntil <= now && !isPaneOpen) {
      timer = $.clock.after(OPEN_DELAY_MS, () => {
        if (isWorking && turnSeq === thisTurn && !isPaneOpen) void openPane($)
      })
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)

    isWorking = false
    timer?.cancel()
    timer = undefined
    // Claude's reply is done: close the game so the chat has the window back.
    // Progress is saved after every sort, so nothing is lost.
    if (isPaneOpen) await closePane($)
    else await update($, mode, () => 'idle')

    return next(e)
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) {
      isPaneOpen = false
      stopMusic()
      await update($, mode, () => (isWorking ? 'working' : 'idle'))
    }
    return next(e)
  })

  // The game posts its progress here so it survives closing the pane.
  on('ui.message', async ($, e, next) => {
    const data = e.data as { type?: string; game?: unknown } | null
    if (data && data.type === 'close') await closePane($)
    if (data && data.type === 'snooze') await snooze($)
    if (data && data.type === 'off') await turnOff($)
    if (data && data.type === 'mute') await setMusicMuted($, (await read($, music)) === 'on')
    if (data && data.type === 'save' && isGame(data.game)) {
      const saved = { file: data.game.file, seed: data.game.seed, refined: data.game.refined.slice(0, 16) }
      await update($, game, () => saved)
      await $.store.set('game', saved)
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const now = await read($, mode)
    const saved = await read($, game)
    const tune = await read($, music)
    const claude =
      now === 'ready' ? (
        <Text color="#7fa35a">● Claude is ready</Text>
      ) : now === 'working' ? (
        <Text dimColor>Claude is working ···</Text>
      ) : (
        <Text dimColor>Sift</Text>
      )

    // Minimized on the desktop app: a glance, nothing more.
    if (e.props.placement === 'widget') {
      return (
        <Box flexDirection="column" paddingLeft={1}>
          <Text bold>Sift</Text>
          {claude}
        </Box>
      )
    }

    // Surfaces that cannot run the game: the status and the quiet controls.
    if (e.surface !== 'terminal' && e.surface !== 'desktop') {
      return (
        <Box flexDirection="column" paddingLeft={1}>
          {claude}
          <Text> </Text>
          <Text dimColor>Sift plays in the terminal and the desktop app.</Text>
          <Text> </Text>
          <Box flexDirection="row" columnGap={1}>
            {now === 'ready' && <Button key="back" plain label="Back to chat" onPress={() => closePane($)} />}
            <Button key="snooze" plain dimColor label="Snooze 1h" onPress={() => snooze($)} />
            <Text dimColor>·</Text>
            <Button key="off" plain dimColor label="Turn off" onPress={() => turnOff($)} />
          </Box>
        </Box>
      )
    }

    // The game draws the whole panel and owns all its spacing: its region is
    // exactly the panel's body, so pointer cells and drawn cells share an origin.
    // On the desktop app the viewport is the chat beside the docked panel, so the
    // window is the two together; in the terminal the viewport is the whole width.
    const chatColumns = e.viewport?.columns ?? 0
    const windowColumns =
      chatColumns > 0 ? (e.surface === 'desktop' && e.props.placement === 'dock' ? chatColumns + e.props.bodyColumns : chatColumns) : 0
    if (windowColumns > 0) await $.store.set('windowColumns', windowColumns)
    const { Client } = $.ui.resolve(e)
    return (
      <Client
        key="game"
        module="./sift-game.tsx"
        props={{ game: saved, mode: now, music: tune, paneRows: e.props.scroll.bodyRows }}
        width={e.props.bodyColumns}
        height={e.props.scroll.bodyRows}
      />
    )
  })
}
