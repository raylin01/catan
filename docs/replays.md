# Replay API and format

Recording begins when a lobby is created. The server saves accepted transitions and their resolved state, so playback does not roll dice again or execute a newer version of the rules. Rejected commands and idempotent retries do not add events. Actual public chat is recorded; mouse movement and tentative UI selections are not.

## Watching a match

The replay opens on the recorded board setup. Its playhead follows elapsed match time continuously, including the waiting time between moves, with 0.5×, 1×, 2×, 4× and 8× speeds. Scrub to any time or use previous/next turn. **Skip idle** is optional and off initially; when enabled, it keeps up to 1.2 seconds of each gap before jumping to the next recorded event. Seeking clears transient animations; playing shows recorded dice and card transfers at the selected speed.

Markers above the time slider identify robber moves, VP gains, Longest Road, Largest Army, turn changes and the winner. Nearby markers are grouped; open a group to choose a precise moment. Colored bands show whose turn occupied each interval. Charts also use elapsed time, with selectable points and an accessible data table.

Finished replays open in **Omniscient** view with every hand shown as cards. Click a player panel to use the shared game board and that player's hand presentation, with opponents' card backs and counts. The replay has no game-action controls or game socket. Unfinished matches retain the server's privacy restrictions: an unlisted viewer sees the public board; a currently authorized player can select their own recorded perspective. Public view remains an API option but is omitted from the finished replay's UI.

## Access

Recording IDs are random 256-bit unlisted identifiers. Possession permits public playback of an unfinished match. Once the match is won, manually ended, or closed after four hours of inactivity, possession also permits omniscient and individual-seat playback. A room invitation is not a replay identifier. The server sends `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, and `X-Robots-Tag: noindex, noarchive` on recording API responses.

While a match is unfinished, use a current player's `Authorization: Bearer …` header to request that seat's private perspective. Authorization is checked by the server for frames, events, metrics and exports. A controller can only view private history belonging to its recorded controller generation. Spectator and host room tokens do not grant omniscient access. Never put credentials in URLs.

Public and player views expose `bankAvailable` (per-resource booleans) and `bankTotal`, instead of exact bank pile counts. Exact historical pile changes would reveal another player's private discard composition. Live play uses the same disclosure policy and the bank menu shows **In stock / Empty**. Explicit omniscient replay retains full bank balances. Public board facts and legally necessary availability can still support ordinary gameplay deductions.

The private operator key grants directory and deletion access through `X-Host-Key`. Room creators do not need that key to play. There is no unauthenticated archive listing. Sharing a finished recording intentionally shares every recorded game fact, including hands and public chat. The recording excludes authentication and detailed model transcripts.

## Routes

| Request | Result |
| --- | --- |
| `GET /api/replays?limit=50&offset=0` | Operator-only paginated recording metadata. |
| `GET /api/replays/:id?at=123&perspective=public` | Metadata and the authoritative state at an event sequence. Omit `at` for the latest frame. |
| `GET /api/replays/:id/events?after=0&limit=200&perspective=public` | Events in ascending sequence, with perspective-filtered payloads. |
| `GET /api/replays/:id/metrics?perspective=public` | Per-event VP, road and building counts. Hidden VP is only included when that perspective permits it. |
| `GET /api/replays/:id/export?perspective=public&gzip=1` | A downloadable UTF-8 JSONL file, optionally gzip-compressed. |
| `DELETE /api/replays/:id` | Operator-only permanent deletion of a won, manually ended, or inactivity-closed match and its saved room. |

`perspective` accepts `public`, `omniscient`, or a recorded seat ID. Unauthorized perspectives are rejected rather than silently returning a different view. Metadata supplies the permitted perspective choices. Empty histories and partial recordings are valid. Sequence zero is the baseline before the first event.

## Stored facts

Each event has an increasing `seq`, a server timestamp `at`, non-decreasing `elapsedMs`, a turn index, a type, an actor and a human-readable summary. Turn zero covers the lobby/setup and first turn; accepted `endTurn` events advance the index. Elapsed time includes idle time and server downtime. These are server commit timings, not the time of a player's unsubmitted click.

The journal contains a baseline and RFC 6902-compatible `add`, `remove`, and `replace` state patches. Arrays are replaced as units. Checkpoints bound seeking work. State includes the board, player hands, remaining development deck, committed robber selection, trade, chat, pause state and card transfers. The server resolves randomness before recording; later replay never invokes the game engine.

Format, rules and projection versions are recorded separately. A future renderer may need an adapter for older formats; preserving facts does not guarantee pixel-identical rendering across UI releases. Player-perspective files contain only projected facts and cannot recover information omitted for privacy.

The export is newline-delimited JSON, with one object per line and a final newline:

- `kind: "metadata"` contains `recording` (including the three versions) and `perspective`.
- `kind: "initial"` contains `seq: 0` and the baseline `state`.
- `kind: "event"` contains event facts plus `patch`. Apply it to the preceding state to obtain the state after that event.
- `kind: "checkpoint"` contains `seq` and a complete `state` at that event. It is a seek shortcut, not an additional game action.

Read lines in order and apply only event patches; alternatively, begin at a checkpoint and apply later events. Resource counts, hidden card fields, event payloads and patches are projected before export. The downloaded file is self-contained and has no controller tokens or external trace dependencies.

## Analysis

Use the recorded terminal status and `winnerId` for outcome analysis. `won` has a winner; a manually ended, inactivity-closed, or unfinished recording does not. Partial recordings must be excluded from analyses that require the whole match. Sample recordings are labeled with `sample: true` and should be excluded from real-player statistics.

For VP charts, `publicVP` tracks visible points and `totalVP` adds hidden development-card points only when authorized. `roads` counts placed road pieces; `longestRoad` is the current connected road length. Settlement and city counts reflect pieces on the board, so upgrading a settlement decreases the settlement count and increases the city count.
