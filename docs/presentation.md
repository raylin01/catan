# Board and gameplay presentation

The interface borrows physical board-game materials: painted terrain, ivory number discs, wooden pieces, and illustrated paper cards. The painted coastal backdrop has a subtle, slow daylight cycle. It is decorative and never covers or handles game input.

The match uses a game HUD: a compact scoreboard, a large central board, contextual build/trade controls, and a floating card hand. Build controls use the same wooden silhouettes as placed pieces. Bank trades and mandatory discards show painted resource cards with explicit quantities. Development cards open from the hand; the action dock does not repeat that control. Short desktop windows move the scoreboard beside the board to preserve playing space; phones stack the board and actions above a sticky hand. Replay uses the same match components, with a matching real-time timeline, collapsible event/chat inspector, charts and archive controls. Select a player in the scoreboard to see their recorded hand; public counts for other players remain in the scoreboard. The omniscient view has compact illustrated hand trays. Lobby forms, AI settings and reference dialogs share the HUD materials.

Resource hands are straight. Robber choices form an upright overlapping fan; hover or keyboard focus lifts one card and spreads its neighbours. Long hands wrap into accessible rows, with fewer cards per row on phones. Cards remain opaque until the server confirms the selection.

Chat is a nonmodal floating window. Drag its title or corner handle to move/resize; focused handles also accept arrow keys (Shift for smaller steps) and Home to reset. Minimize/Escape preserves the draft in memory until the seat/game changes. Only window geometry is stored locally. New messages do not force readers to the bottom; a new-message button returns to the latest. Message identity, rather than list length, tracks the server's rolling history window.

The coastal illustration has separately masked cloud and water layers, refraction, moving glints, and slow sunlight. All layers share the original image coordinates, so shoreline and mountain edges remain stationary. Scenery pauses in place when disabled or when the tab is hidden; reduced motion disables animation. Dice/card/piece sounds use Kenney Casino Audio 1.1 recordings under CC0. The bundled clips have reduced high frequencies, lower peaks and short edge fades. Separate slides and card fans distinguish individual draws from multi-card transfers; a full shuffle is available in the design audition controls. Samples decode after the first browser gesture when sound is enabled, stay cached, and never queue old action sounds during loading. Muting stops active clips so old tails cannot resume later.

References: [CATAN base game](https://www.catan.com/catan), [physical board and cards](https://www.catan.com/sites/default/files/2025-04/CATAN_Board_3DRender.jpg), and [CATAN 3D Edition](https://www.catan.com/catan-3d-edition). The painted WebP assets and SVG pieces/icons in this repository are original; these references are not bundled artwork. Original illustrations were generated with the built-in image generation tool under parent-agent art direction. The exact prompt set is in `docs/artwork-prompts.json`; compressed runtime assets are in `client/src/assets/painted` (about 1.6 MB total). Audio comes from [Kenney Casino Audio](https://kenney.nl/assets/casino-audio), licensed [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). Author license and per-file sources, processing settings and hashes are in `client/src/assets/audio/KENNEY-LICENSE.txt` and `provenance.json`. The eleven MP3 files total about 115 KB; playback never contacts the source site.

## Local design playground

With client dependencies installed, run from the repository root:

```sh
npm run dev --prefix client -- --host 127.0.0.1 --port 5177 --strictPort
```

Open `http://127.0.0.1:5177/design.html`. Choose an unused port if 5177 is occupied. Do not stop an existing game to launch a design preview.

This development-only entry uses the actual game components with a deterministic synthetic fixture. It needs no backend or AI connector and makes no game API requests. Expand **Test controls** above the game to exercise resource draws, discards, trade receipts, development cards, road/settlement/city placement, robber movement, setup, spectators and omniscient hands. Spectator mode remains selected when exercising rolls, pieces, robber movement and development-card delivery; its projected hands/receipts are concealed. Private decision scenarios switch back to the player. Motion speed can be slowed to inspect intermediate frames. Reset returns to the initial sample. Controls start collapsed so the fixture shows the actual match layout.

**Scenery preview** hides the match to inspect the background. **Dice sound**, **Card draw sound**, **Card handling sound**, **Card shuffle sound** and **Piece sound** audition the recorded clips after enabling Sound. **Chat activity** appends synthetic messages for checking scroll/unread behavior. These controls never call an AI model or a game server.

The fixture is a presentation tool, not a rules or multiplayer test. It does not simulate legality, bank conservation, wins, multi-seat trade confirmation, persistence or remote controllers. The standard production build includes only `index.html`; the playground and its fixture are excluded.


## Choice and HUD polish

Selecting a build action lights only its legal board targets. Settlement sites and roads use soft gold pulses; eligible city upgrades get rings and an upward marker, with a colored city preview on hover or keyboard focus. Robber destinations have illuminated tile outlines. Paused games and observer views show no active placement targets. Reduced motion keeps the highlights steady. Optional build placement can be cancelled from its action heading or with Escape; required setup/robber choices remain required.

The robber's action dock explains the next choice, replacing disabled build buttons and the banner over the roster. The game log lives in the live/spectator header, with a bounded recent-events panel, semantic icons, timestamps, outside-click/Escape dismissal and close-button focus restoration. Replay retains its existing event inspector. Chat's explicit Restore layout control returns its size/position to defaults without clearing a draft. These controls use the shared HUD materials and fit narrow screens.

## Board navigation

The shared live, spectator and replay board uses the available arena with no reserved side gutters. Scroll over the board to zoom around the pointer, drag to pan, or use the fixed +/− and Fit controls. Touch supports one-finger pan and two-finger pinch. Zoom is limited to 100–300% of the fitted board and pan is bounded so the island stays recoverable. The board is keyboard focusable: +/− zoom, arrows pan, and 0/Home fits. Keyboard placement targets pan into view when focused.

A drag must move at least six pixels and suppresses the resulting placement click; ordinary clicks, keyboard placement and right-click help remain available. Camera state is local presentation state, retained through moves, replay seeks and perspective changes, and reset for a different game. Resize clamps the camera to the new viewport. HUD, dice, card-transfer overlays and timeline remain outside the camera transform. There is no automatic camera animation, including with reduced motion.

## Presentation contracts

- Confirmed receipts and board snapshots drive motion. Animation never submits an action, changes resources, delays an authoritative update, or infers hidden card identities.
- Initial snapshots, replay seeks and perspective changes establish a silent baseline. Board `resetKey` also handles control-context changes. Repeated polling does not replay effects. Recovery after a failed observation or a long suspension establishes a fresh baseline; older room revisions and responses from a previous seat/session are ignored.
- Replay playback scales motion through 8×. Changing speed does not reroll settled dice. Paused replay frames remain static.
- Live spectators see fresh dice rolls, piece/robber changes and transfer fans. They do not see private pickers or drawn-card reveals. Polling may combine changes; replay seeks and fast playback do not guarantee every transient animation from skipped frames.
- Development purchases now record an incoming face-down delivery as well as resource payment. The receipt stores only the public development-card category, never its private identity. This applies to new receipts; older recordings are not rewritten, and development-card plays have no separate card-transfer animation.
- Transfer fans carry an exact-count badge; concealed transfers use card backs. All face-up artwork is derived from the already-authorized view.
- Audio overlap is bounded to four voices, repeated receipts are gated, and replacing a same-kind voice prevents buildup at high replay speeds. Missing/corrupt files fail quietly; opt-in retries failed loads.
- Sound starts enabled on a fresh visit and activates after a browser gesture. The visible sound toggle remembers an explicit mute across visits. Unavailable audio is harmless, and hidden tabs do not start new sounds. Background animation has a separate persisted toggle.
- `prefers-reduced-motion` disables the scenic cycle and piece/dice motion, and replaces card movement with restrained feedback. Counts and game status remain available without animation or audio.
- Placement targets support keyboard activation, resource details support click/keyboard, and development-card dialogs restore focus on dismissal.

## Verification

`npm test` includes presentation snapshot/motion and audio opt-in tests alongside the existing game, bridge and replay contracts. Run `npm run build` and the standalone engine tests used by CI as well.

For rendered checks, use both the playground and a separately hosted sample replay: test desktop and phone widths, confirm visible resource counts, open and submit discard/bank-trade forms, inspect concealed hands, use keyboard placement, and seek/switch perspectives while paused. Review slow animation frames, then verify settled dice stay settled after a speed change. Check that sound starts off and scenery can be paused. Never use a live match's credentials or database as a design fixture.
