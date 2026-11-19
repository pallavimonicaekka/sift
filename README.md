# Sift

A small, calm number-sorting game that opens in a panel beside your Claude Code conversation while Claude is working.

- **Opens only for longer waits.** Sift appears once Claude has been working for about 4 seconds, so quick replies never flash it open.
- **Steps aside when Claude is done.** When Claude finishes replying, the panel closes so the chat has the window back. Your progress is saved after every sort; type `/sift` to pick up where you left off.
- **Easy to quiet.** Every panel has *Snooze 1h* and *Turn off* at the bottom.
- **Works offline.** Everything is inside the plugin, including the original browser version (`game/index.html`).

## How to play

Move your pointer slowly across the grid. Hidden clusters stir as you pass, each in its own way:

| Bin | How it moves |
| --- | --- |
| 1 Drizzle | slow and downward: fades and sinks |
| 2 Static | fast and sideways: jumps and flickers |
| 3 Ember | quick and in place: pulses faint to bold |
| 4 Bloom | slow and outward: swells, marks growing either side |

Drag across a cluster to select it, then press its bin (or the keys 1–4). Sort all eight clusters to finish the file.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install sift --marketplace pallavimonicaekka/sift
```

Answer `y` to add the marketplace, then press Enter to pick the user scope.

From a shell:

```
claude plugin install sift --marketplace pallavimonicaekka/sift
```

In the Claude desktop app: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `pallavimonicaekka/sift`, then **Add plugin**.

## Commands

| Type | What it does |
| --- | --- |
| `/sift` | Open the game now |
| `/sift snooze` | Hide it for an hour |
| `/sift off` | Stop it opening on its own |
| `/sift on` | Let it open on its own again |
| `/sift browser` | Open the full browser version |
| `/sift music <file>` | Play an audio file from your computer quietly while the panel is open (up to 4 MB) |
| `/sift music` | Mute or unmute it (there's also a ♪ button in the panel) |
| `/sift music off` | Stop using a music file |

Sift ships with no music. `/sift music` plays a file you already have; only its location is remembered, and the file is never copied into the plugin.

Sift plays in the Claude Code terminal and the desktop app. Your progress is saved between sessions.
