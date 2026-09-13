# Catan Online by rlin

Browser Catan for 3–4 human or remotely controlled AI seats. The public website hosts the game server only; it never runs model inference. Each AI operator runs their own agent or Codex CLI on their own computer and connects through the authenticated game API.

This fork reuses [Viral-Doshi/catan](https://github.com/Viral-Doshi/catan), pinned initially at `3a0a6b815ff999adf5fd5802fa3df9b99833fc2d`. Its MIT notice is retained in LICENSE. Original project documentation is in UPSTREAM.md and is historical; its 5–6-player/full-completeness claims do not describe this fork's supported release scope.

## Run the host

Requires Node 22.13 or newer. From this repository:

```sh
npm ci --ignore-scripts --prefix server
npm ci --ignore-scripts --prefix client
npm run build
npm start
```

Open http://127.0.0.1:3001. Anyone can create a room without a key, up to 16 unfinished rooms. A private `data/host-key` is generated on first start for operator capacity override and recording administration; it is never included in invitations. The room creator can spectate or claim a separate human seat.

For local frontend development, keep that server running and use `npm run dev --prefix client`; Vite proxies `/api` to port 3001. Production serves the browser and API from one origin. The upstream split-service Render blueprint has been removed because it does not match this hosting architecture.

The default binds loopback. `PORT`, `HOST`, `CATAN_DATA_DIR`, `CATAN_HOST_KEY`, `CATAN_MAX_ROOMS`, `CATAN_PUBLIC_URL`, `CATAN_SITE_NAME`, `CATAN_BRIDGE_REF`, and optional `CATAN_TRUST_PROXY` configure it; see [.env.example](.env.example). `CATAN_HOST_KEY` must be at least 16 characters if set explicitly. Keep `data/` on durable private storage and out of Git. Restarted active games recover paused for creator review/resume. Unfinished rooms close after four hours without a lobby or game action; polling and AI heartbeats do not extend that clock. A closed room retains its unlisted replay.

For a public host, copy `.env.example` to `.env`, replace `CATAN_BRIDGE_REF` with a published matching ref, and start with `node --env-file=.env server/index.js`. Node does not load `.env` through `npm start` automatically.

Stop the server before copying the whole data directory for a backup or restoring it. Keep the existing host/controller credentials private. A rollback requires both a compatible application version and database snapshot; do not downgrade a saved schema blindly.

For a public [Cloudflare Tunnel](https://developers.cloudflare.com/tunnel/setup/) deployment, set `CATAN_PUBLIC_URL=https://catan.rlin.dev` and point that HTTPS hostname at `http://127.0.0.1:3001`. The service should remain bound to loopback on the host, with no direct public port. Set `CATAN_BRIDGE_REF` to a **published tag or commit matching the deployed server** before sharing downloadable agent instructions; this feature currently lives on a branch, so `main` is not yet the matching client source. Do not expose the host-key file or any player's CLI process. Tunnel account, hostname, and route setup are separate; starting this app does not publish a tunnel.

The optional `CATAN_TRUST_PROXY` setting controls which proxy address Express trusts for client IPs and rate limits. For a tunnel connector on the same host with no direct origin access, use `loopback`; for a separate proxy/container, use its exact IP or CIDR after verifying the network path. Leave it unset until that path is known. Do not use a broad trust value for a publicly reachable origin. The canonical `CATAN_PUBLIC_URL` supplies public links independently of proxy headers. See [Express's proxy guidance](https://expressjs.com/en/guide/behind-proxies/).

The [Dockerfile](Dockerfile) builds the browser and installs server dependencies, then runs only `server/index.js`; it does not include the bridge or a model CLI. Bind its published port to host loopback and mount `/app/data` on a writable persistent volume. For example: `docker build -t catan-online .` then `docker run --rm -p 127.0.0.1:3001:3001 -v catan-data:/app/data -e CATAN_PUBLIC_URL=https://catan.rlin.dev -e CATAN_BRIDGE_REF=PUBLISHED_REF catan-online`. Replace `PUBLISHED_REF` with the same published tag or commit used by players. The AI CLI stays on each player's computer.

## Bring your own agent or Codex CLI

From the public site, copy or download the Markdown agent guide for a room or vacant AI seat. It contains the public server URL, room code, provider/model choice, and matching client ref; it never contains a controller token or operator key. Players need Node.js 22.13 or newer and a checkout of the published source at that ref. The bridge runtime uses Node's built-in modules and needs no npm install.

For an **External agent (MCP)** seat, configure `node /absolute/path/to/bridge/cli.js mcp --server https://catan.rlin.dev --session /absolute/private/path/seat.json` as a local STDIO MCP server in an agent CLI that supports it. Its tools are `catan_join`, `catan_observe`, and `catan_act`; `catan_join` defaults to provider `mcp`. The agent must remain active to observe and act. Direct MCP has no automatic scheduler, chat reader, or bounded negotiation pipeline. Do not run MCP and an automatic runner for the same seat.

For a **Codex CLI** seat, use the automatic runner below.

Install a compatible Codex CLI and log in on that computer. The implemented connector was developed against Codex CLI 0.146.0; it relies on the documented ignore-user-config, explicit session resume, structured-output and tool-disable options. Each AI seat needs a separate session file.

Configure a Codex AI slot in the browser lobby, then run from the matching local checkout:

```sh
node bridge/cli.js join --server https://catan.rlin.dev --code ROOMCODE --name Codex --provider codex --model YOUR_MODEL --reasoning max --session .catan-session-one.json
node bridge/cli.js run --session .catan-session-one.json
```

`--reasoning` is optional and accepts `minimal`, `low`, `medium`, `high`, `xhigh`, or `max`; use a value supported by the selected model. When omitted, the connector keeps the model's default reasoning effort.

The runner marks its seat ready and waits for required game decisions, structured trade responses, validated human chat proposals, or relevant bounded AI negotiation intents. It keeps separate persistent gameplay, chat-reader, and public-speaker contexts in its private session file. Idle network polling makes no model calls; processing new chat does use the chosen chat model. It stops on provider errors, leaving the seat reserved. Ctrl-C also leaves the seat intact. The host can remove and replace any controller without resetting the hand or pieces. Restart the runner to retry the same seat; do not repeatedly join new seats.

The hosting server cannot verify a remote client's claimed model identity. Availability is a connected client's declaration. Provider credentials remain on its computer, and usage consumes that operator's provider allowance.

## AI controls and connected chat

In the lobby, choose each AI seat’s playing model and optional separate chat model/reasoning. An empty chat model uses the playing model. Turn off **Consider player chat** to keep that seat focused on game actions. Configure seats before controllers join; releasing and setting an occupied controller revokes its old credentials.

The host can **Pause AI**, **Resume AI**, or **Cancel decision** in the lobby and active-game host controls. Pause keeps an attached Codex runner waiting and blocks direct MCP actions. Cancel invalidates the current decision, pauses the seat, and detaches any runner. To continue, resume the seat and restart a Codex runner with its existing session, or have the external MCP agent observe again. Ctrl-C stops a local runner without giving up its seat. The website cannot launch a CLI on another computer. AI controllers may also send those commands for their own seat.

Status comes from bridge execution and server timestamps, never an LLM status tool. The Codex bridge reports choosing a move, considering chat, preparing a reply, or waiting. Direct MCP reports only its observe/action activity. A 20-second runner lease prevents two live automatic processes controlling one seat; 20 seconds without activity becomes stale and 45 seconds becomes offline. Every AI command is fenced by its current control epoch, so an old decision cannot commit after pause, cancel, or replacement. Provider errors stop the runner and leave the game waiting.

Raw human chat goes only to a separate reader context with no game tools or private hand. Its output is validated into finite resource/trade/robber/build suggestions, bound to the original message and player. The private playing agent evaluates those suggestions and submits any real action. A chat proposal is never an accepted trade by itself. The public speaker receives only public board facts, validated public negotiation proposals, a narrow acknowledge/decline choice, and confirmed public actions; it never receives the playing agent’s hand, development cards, strategic memory, raw chat, or private command effects. Human-triggered replies remain optional and rate-limited; their free-form text does not wake other AI readers. Proactive AI negotiation uses a separate finite public intent protocol, described below. Model instructions reduce manipulation risk; field validation and server authority enforce the actual information and action boundaries.

Context IDs and pending validated proposals are stored in the mode-600 seat session file. Codex histories are persisted by the local CLI; treat them as private game data. Each channel resumes only its own explicit ID. No tools, user configuration, plugins, or hooks are enabled for these model calls. A changed channel model starts a new context.

## Proactive AI negotiation and local benchmarks

The playing agent can announce a concrete resource interest, decline a proposal, or announce a real trade it already offered. The server renders these structured messages into public chat. It accepts no arbitrary model prose or private rationale on this path. Other AI players receive only the typed intent when relevant, and their playing agent chooses whether to submit a real trade or a bounded response. Silence remains the default.

The server permits one new negotiation topic per game turn, initiated by the active player during the main phase. Topics expire on turn change or after ten minutes. Exchanges have at most six messages, depth two, two messages per seat, a five-second per-seat cooldown, duplicate suppression and terminal declines. Declines close new AI offers between that pair until the turn changes; each AI also has a two-offer/counter budget per turn. Pausing, cancellation and controller replacement fence negotiation requests exactly like game actions. During a response window the runner waits without model calls, giving other managed players time to finish before ending the turn.

The decision timeout defaults to 60 seconds. For Luna Max, configure a five-minute bound when joining or starting a runner:

```sh
node bridge/cli.js run --session .catan-session-one.json --decision-timeout-ms 300000
```

See [AI negotiation testing](docs/ai-negotiation.md) for deterministic gate tests, bounded live-model scenario benchmarks and the four-player smoke harness. A live benchmark requires `--live`; the default makes no model calls. Detailed prompts, strategic memory and context IDs are excluded from benchmark reports and shared replays. Local Codex session histories remain private on the machine running the CLI.

## Card interactions

After a seven, each affected player selects their own discard. There is no automatic discard timer. Confirmed production, trades, costs, discards, and theft animate between the bank and player hands. Resource faces are visible only for your own transfers; other transfers show card backs and counts. Reduced-motion preferences suppress flying cards while preserving the transfer summary. Reloading establishes a baseline and does not replay old animations.

Robber theft has two steps for every client: `moveRobber {hexKey, stealFromPlayerId}` chooses the tile and victim; `chooseRobberCard {cardId}` selects one opaque card from the observed `robberPick.cardIds` or `legalActions`. The server shuffles physical cards once and preserves their mapping across refreshes and restarts. The resource is revealed only to the thief and victim. A paused room waits; replacing a controller preserves the pending choice. Clients that submit actions directly must support the new `robberPick` phase before connecting to this version.

## Gameplay contract

- Game rules and legal action checks are authoritative on the server; invalid actions cannot partially mutate state.
- Public player IDs and room codes are not controller credentials. Replacements revoke old credentials and preserve the seat.
- Only a player's own hand is visible. Spectators see public board state and card counts, including in four-AI games.
- Trading uses exact give/get quantities and a partner, followed by accept and proposer confirmation. Counteroffers replace the current offer. One targeted offer is active at a time. Settlement rechecks both hands atomically.
- All chat is public. AI gameplay observations omit raw chat; the managed bridge supplies validated suggestions through a separate reader. No private messaging exists.
- Inactive or rate-limited players wait; there are no automatic moves, forfeits, or replacements. All unfinished rooms close after four hours without a lobby/game action.
- Polling fetches filtered observations. Accepted transitions and idempotency receipts persist together in SQLite. Do not run two server processes against one game database.

## Add a provider connector

`bridge/runner.js` schedules providers without importing Codex-specific behavior. A connector implements `id`, `ready()`, and `decide(view, {model,reasoning,memory,contextId,lastOutcome,signal,timeoutMs})`, returning `{action,negotiation,memory,contextId,publicReply}` (choose either an action or a negotiation). Optional `readChat(input, options)` and `speak(input, options)` return `{value,contextId}` for their isolated channels. `publicReply` is `silent`, `acknowledge`, or `decline`; private prose never crosses to the speaker. The runner handles status reporting, leases, validation, and scheduling for every connector. Register it in `bridge/connectors/index.js` and advertise its capabilities in `server/providers.js`. Provider-specific invocation, output parsing, cancellation and authentication belong in the connector. Game rules, UI seats and the runner must not need changes.

The Codex connector uses an isolated temporary directory for each call and resumes explicit, separate channel histories with external tools, hooks, plugins and user configuration disabled. It still uses Codex's own login store. Session files contain seat credentials and private memory: treat them as secrets and do not share or commit them.

## Match recordings

The server records every lobby automatically, including matches that are paused or never finish. Accepted actions, public chat, controller changes, resolved game state and event timing commit to SQLite together with the live room. Restarted matches retain their history and gain a recovery marker. Rooms saved before recording was installed begin with a **partial** baseline; earlier actions cannot be recovered.

Recordings have random unlisted IDs independent of room codes. There is no public recording directory. The operator can list recordings with `GET /api/replays` and the `X-Host-Key` header. Keep the data directory private: authoritative recordings contain every hand. A won match or one permanently ended by the host allows anyone with its recording link to view every hand and choose any player perspective. A paused or interrupted match remains protected: public viewers see counts, and only the current controller can access its own generation's private history. A replacement controller does not inherit the previous controller's private history.

Recorded AI diagnostics include the configured provider/model, reported status transitions and accepted actions. They exclude model prompts, local transcripts, private strategic memory, context IDs, raw provider errors and credentials. Polling and unchanged heartbeats do not create journal events. A recording explains what happened, but cannot explain unrecorded private model reasoning.

Recordings stay on disk until the operator explicitly deletes a terminal recording. Paused and unfinished matches cannot be deleted while they remain resumable; won, manually ended, and inactivity-closed matches can. Ending or closing a match does not declare a winner. Recording data shares the existing SQLite backup lifecycle; do not delete database tables or copy a running WAL database piecemeal. See [the replay API and file format](docs/replays.md) for exports and downstream analysis.

Open **Recordings** from the home screen and enter the operator key to browse matches, copy unlisted links or delete terminal recordings. A lobby or active table also has **View recording / View replay**. Opening a replay does not vacate your seat. Its clock follows elapsed match time at 0.5×–8×, with optional idle skipping. Scrub to any time, step between turns, or choose robber, VP, award and winner markers above the timeline. Finished matches default to **Omniscient** with every hand visible; click a player panel for that player's board and hand presentation at the same moment. **Events**, **Chat**, **Details**, and **Charts** show the recorded facts available to that perspective. **Export** downloads its JSONL gzip file.

To try sample replays in an isolated database without changing existing games:

```sh
npm run samples -- --db data/replay-demo/rooms.sqlite
CATAN_DATA_DIR=data/replay-demo PORT=3005 npm start
```

The generator refuses an existing database path and creates two finished matches plus one paused match. They are marked **Sample match**, use scripted human-seat controllers and synthetic event timing, and make no model calls. Follow the printed replay paths at `http://127.0.0.1:3005`, or use the separate `data/replay-demo/host-key` to open that server's archive. Restarting the demo marks the unfinished match as interrupted, just as recovery does for a real match. Use a new output directory to regenerate samples.

## Verify

```sh
npm test
node server/test-game.js
node server/test-full-game.js
node server/test-edge-cases.js
node server/test-longest-road-rigorous.js
npm run build
```

HTTP tests bind ephemeral loopback ports. Test connectors are fixtures, not silent gameplay substitutes. Full remote-host/tunnel acceptance needs the actual hosting computer and another participant's computer; local process tests alone do not prove that deployment.

Production dependency audits were clear at implementation review. The inherited Vite 5/esbuild development toolchain still has two audit findings requiring a separate major-version migration. Host the production build using `npm start` or the Docker image; do not expose the Vite development server through the tunnel.
