# Testing proactive negotiation

The public negotiation protocol gives the playing agent a way to pursue its own resource objective. An interest is a request, not a trade commitment. A useful response should become an authoritative `tradeOffer`, `tradeCounter`, `tradeAccept` or `tradeConfirm` command when appropriate. Only the real command changes cards.

## Information and scheduling boundary

- The private playing context chooses an interest containing one or two wanted resources, one or two offered resources, an optional recipient and an optional parent message ID. It never supplies prose or its private reason.
- The server verifies ownership of offered resource types and generates readable public chat. An offer announcement must reference the sender's actual current trade; the server derives its quantities.
- Public negotiation records contain IDs, finite terms, actors, timing and bounded conversation metadata. The receiving bridge strips all extra fields and checks relevance before waking its playing model. An interest must request something the recipient owns and advertise a resource below a conservative one-build threshold in the recipient’s hand. This intentionally favors silence over speculative multi-build conversations. Raw AI text never enters gameplay or the human-chat reader.
- Existing human chat still uses an isolated reader and public-only speaker. Those contexts do not receive the private gameplay hand or memory.
- The same `chatEnabled` seat setting controls proactive negotiation. Each seat has its own session file and private persistent contexts.

Hard limits live in `server/negotiation.js`: one root per turn, active-player main-phase initiation, expiry on turn change or ten minutes, depth two, six messages per root, two messages per seat, five-second cooldown, duplicate suppression and terminal decline. Authentication, control epoch, generation, revision and runner lease checks protect publication. Interest replies must match the advertised resource sides. A decline closes new AI offers between that pair for the rest of the turn; existing accept/reject/cancel/confirm actions remain available. Each AI can submit at most two real offers/counters per turn, and cannot repeat identical terms. These limits do not restrict human trade commands. Gate counters and messages persist together, so restarting a runner cannot buy another message budget.

Waiting for a response does not invoke a model. The runner gives peers a short grace period and waits while another managed player is processing, bounded by the configured decision timeout. Actual trade replies take priority. Ending a response window permits a new decision even if a rejected offer restored the original board state. A final depth-two reply is delivered as a public fact that can inform a real trade, but cannot open another chat reply. The game does not automatically replace a failed or rate-limited player.

## Deterministic tests

```sh
node --test server/test-negotiation.js bridge/test-negotiation.js
npm test
```

These tests establish hard bounds and information filtering even when an adversarial client ignores model instructions. Model benchmarks measure strategy separately; a model choosing silence is not a server-gate failure.

## Local Luna scenarios

The fixtures use real private RoomService observations with synthetic midgame positions. They cover useful resource shortfalls, self-sufficient play, empty hands, relevant/irrelevant requests, real offer announcements, closed conversations and raw-chat isolation.

```sh
# Inspect scenario expectations without model calls.
npm run benchmark:negotiation

# Opt in to at most eight real Luna Max calls, each with a fresh context.
npm run benchmark:negotiation -- --live --model gpt-5.6-luna --reasoning max \
  --timeout-ms 300000 --max-calls 8 --output data/negotiation-benchmark.json
```

Use `--scenarios ID,ID` to narrow a run. `--repeat` permits one to three rounds; `--max-calls` must explicitly cover the selected total and cannot exceed 24. A failed case is reported rather than silently retried. Reports include public actions/intents, latency, numeric token usage when available, checks and provider failures. They exclude private memory, context IDs, prompts and model transcripts. The sample size is small; it cannot establish universal strategic quality or replace gate tests.

## Measured baseline (2026-09-12)

The [eight-case Luna Max report](negotiation-benchmark-2026-09-12.json) records seven matching behavior targets and one miss. Luna initiated the useful resource request, stayed silent in irrelevant/empty/closed cases, and announced a real existing offer. For the actionable incoming request it chose a valid matching interest reply rather than the fixture's preferred immediate formal offer. This is reported as a behavioral miss, not a gate failure. The full trade exchange is verified separately by the four-runner HTTP test.

Development iterations found missed initiative, an unrelated resource reply, and an attempted formal broadcast after a decline. Those findings led to clearer action availability, matching-resource schemas, authoritative terminal-pair closure and enumerated formal-trade recipients. The final report includes source hashes; model strategy remains stochastic and this small sample does not prove optimal gates.

## Four-player live smoke test

Start a separate server and database on an unused loopback port. Keep the server alive after the test to inspect the recorded match:

```sh
CATAN_DATA_DIR=data/negotiation-live PORT=3006 node server/index.js
```

In another terminal:

```sh
npm run smoke:ai -- --server http://127.0.0.1:3006 \
  --host-key-file data/negotiation-live/host-key --model gpt-5.6-luna \
  --reasoning max --timeout-ms 300000 --turns 8 --max-minutes 45
```

The harness creates a four-AI lobby, writes separate mode-600 seat sessions, starts four managed CLI runners and starts the game when all seats are ready. It prints the join code and replay URL. It pauses the game and stops its runners after the requested number of completed turns, its elapsed-time bound, a runner failure or an interrupt. Setup does not count toward the turn target. The public report records the stop reason, timings and event counts; the separate host/seat session files contain credentials and must remain private.

Resume that same match and its private player contexts after an interrupt or server restart:

```sh
npm run smoke:ai -- --server http://127.0.0.1:3006 \
  --resume data/luna-smoke-EXISTING --max-minutes 45
```

Resume verifies all four existing controllers, waits for their new runners to attach, then resumes the paused game. It preserves the original turn target and event counters and records a separate bounded attempt.

The recording remains incomplete and resumable, so anonymous replay viewers retain the public perspective. Use the normal host controls to end the match if you want to make all recorded hands available through its unlisted replay. Do not expose session files or the operator-key file through a tunnel.
