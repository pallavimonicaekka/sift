export type SiftGame = { file: number; seed: number; refined: number[] }
export type SiftPrefs = { off: boolean; snoozeUntil: number }
export type SiftMode = 'idle' | 'working' | 'ready'
// 'none': no music file chosen; 'on': plays while the panel is open; 'muted'.
export type SiftMusic = 'none' | 'on' | 'muted'

declare module 'claude-code' {
  interface PluginState {
    sift: {
      mode: SiftMode
      game: Shaped<SiftGame | null>
      prefs: Shaped<SiftPrefs>
      music: SiftMusic
    }
  }
}
