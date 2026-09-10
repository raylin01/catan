# Catan with remote AI players

Self-hosted browser Catan for 3–4 human or AI seats. Codex is the first remote connector. The game server owns the rules and private state; models connect over the same authenticated game API as browser players.

This fork reuses [Viral-Doshi/catan](https://github.com/Viral-Doshi/catan), pinned initially at `3a0a6b815ff999adf5fd5802fa3df9b99833fc2d`. Its MIT notice is retained in LICENSE. Original project documentation is in UPSTREAM.md and is historical; its 5–6-player/full-completeness claims do not describe this fork's supported release scope.

## Run the host

Requires Node 22.13 or newer. From this repository:

```sh
npm ci --ignore-scripts --prefix server
npm ci --ignore-scripts --prefix client
npm run build
npm start
```

Open http://127.0.0.1:3001. The first run writes a private `data/host-key` file. Enter that key in the host's create-room form; friends only need the room invitation/code and a display name. The key is never included in invitations. The host can spectate or join a separate human seat.

For local frontend development, keep that server running and use `npm run dev --prefix client`; Vite proxies `/api` to port 3001. Production serves the browser and API from one origin. The upstream split-service Render blueprint has been removed because it does not match this hosting architecture.

The default binds loopback and runs one active match, with separate room lobbies. `PORT`, `HOST`, `CATAN_DATA_DIR`, `CATAN_HOST_KEY`, and `CATAN_MAX_ACTIVE` configure the service. `CATAN_HOST_KEY` must be at least 16 characters. Keep `data/` on durable local storage and out of Git. Restarted active games recover paused for host review/resume.

Stop the server before copying the whole data directory for a backup or restoring it. Keep the existing host/controller credentials private. A rollback requires both a compatible application version and database snapshot; do not downgrade a saved schema blindly.

For Cloudflare Tunnel, point a published HTTPS hostname at `http://localhost:3001`. Do not expose your CLI process or host-key file. Tunnel creation/account/domain setup is separate; no tunnel is automatically published. Friends and remote AI clients use the HTTPS hostname. A Dockerfile is included for a server-only container; keep `/app/data` on a writable persistent volume. The AI CLI runs on each player's own machine, outside the server container.

## Join a Codex player from another computer

Install a compatible Codex CLI and log in on that computer. The implemented connector was developed against Codex CLI 0.146.0; it relies on the documented ignore-user-config, ephemeral, structured-output and tool-disable options. Each AI seat needs a separate session file.

Configure an AI slot in the browser lobby, then run:

```sh
node bridge/cli.js join --server https://your-game-host --code ROOMCODE --name Codex --model YOUR_MODEL --reasoning max --session .catan-session-one.json
node bridge/cli.js run --session .catan-session-one.json
```

`--reasoning` is optional and accepts `minimal`, `low`, `medium`, `high`, `xhigh`, or `max`; use a value supported by the selected model. When omitted, the connector keeps the model's default reasoning effort.

The runner marks its seat ready and waits for required game decisions or structured trade responses. It keeps a private bounded memory per session and invokes only its connector. It stops on provider errors, leaving the seat reserved. Ctrl-C also leaves the seat intact. The host can remove and replace any controller without resetting the hand or pieces. Restart the runner to retry the same seat; do not repeatedly join new seats.

The hosting server cannot verify a remote client's claimed model identity. Availability is a connected client's declaration. Provider credentials remain on its computer, and usage consumes that operator's provider allowance.

## Connect through MCP instead

Configure a local STDIO MCP server in your AI CLI with executable `node` and arguments:

```text
/absolute/path/to/game/bridge/cli.js mcp --server https://your-game-host --session /absolute/path/to/private-session.json
```

Tools are `catan_join`, `catan_observe`, and `catan_act`. Join a vacant AI slot using its code and name, observe, then send `ready`. Commands include the observed revision/generation and a unique request ID. Reuse the same envelope when retrying uncertain delivery; on an explicit stale-revision error, observe again and reconsider. MCP exposes actions but does not itself wake an idle model; the included runner provides automatic scheduling for CLI play.

## Card interactions

After a seven, each affected player selects their own discard. There is no automatic discard timer. Confirmed production, trades, costs, discards, and theft animate between the bank and player hands. Resource faces are visible only for your own transfers; other transfers show card backs and counts. Reduced-motion preferences suppress flying cards while preserving the transfer summary. Reloading establishes a baseline and does not replay old animations.

Robber theft has two steps for every client: `moveRobber {hexKey, stealFromPlayerId}` chooses the tile and victim; `chooseRobberCard {cardId}` selects one opaque card from the observed `robberPick.cardIds` or `legalActions`. The server shuffles physical cards once and preserves their mapping across refreshes and restarts. The resource is revealed only to the thief and victim. A paused room waits; replacing a controller preserves the pending choice. Clients that submit actions directly must support the new `robberPick` phase before connecting to this version.

## Gameplay contract

- Game rules and legal action checks are authoritative on the server; invalid actions cannot partially mutate state.
- Public player IDs and room codes are not controller credentials. Replacements revoke old credentials and preserve the seat.
- Only a player's own hand is visible. Spectators see public board state and card counts, including in four-AI games.
- Trading uses exact give/get quantities and a partner, followed by accept and proposer confirmation. Counteroffers replace the current offer. One targeted offer is active at a time. Settlement rechecks both hands atomically.
- Humans have shared public chat. AI observations omit chat, and no private messaging exists.
- Inactive or rate-limited players wait; there are no automatic moves, forfeits, or replacements.
- Polling fetches filtered observations. Accepted transitions and idempotency receipts persist together in SQLite. Do not run two server processes against one game database.

## Add a provider connector

`bridge/runner.js` schedules providers without importing Codex-specific behavior. A connector implements `id`, `ready()`, and `decide(view, {model,reasoning,memory,signal})`, returning `{action,memory}`. Register it in `bridge/connectors/index.js` and advertise its capabilities in `server/providers.js`. Provider-specific invocation, output parsing, cancellation and authentication belong in the connector. Game rules, UI seats and the runner must not need changes.

The Codex connector uses an isolated temporary directory and ephemeral calls with external tools, hooks, plugins and user configuration disabled. It still uses Codex's own login store. Session files contain seat credentials and private memory: treat them as secrets and do not share or commit them.

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
