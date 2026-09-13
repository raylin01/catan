import * as G from '../gameLogic.js';

const RESOURCES = ['brick', 'lumber', 'wool', 'grain', 'ore'];
const COSTS = {
  city: {ore: 3, grain: 2},
  settlement: {brick: 1, lumber: 1, wool: 1, grain: 1},
  road: {brick: 1, lumber: 1},
  developmentCard: {ore: 1, grain: 1, wool: 1},
};
const PIPS = {2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 8: 5, 9: 4, 10: 3, 11: 2, 12: 1};
const PLAYER_NAMES = ['Mira', 'Jon', 'Cora', 'Theo', 'Nia', 'Remy'];
const DEFAULT_SEED = 0xC47A2026;

const clone = value => structuredClone(value);

/**
 * Return a small deterministic PRNG used only while a sample match runs.
 *
 * A string seed is accepted for CLI callers that want readable seed names.
 * The function intentionally has no dependency on the game engine's private
 * random implementation; it only replaces Math.random for the duration of a
 * call to playScriptedMatch.
 */
export function seededRandom(input = DEFAULT_SEED) {
  let seed;
  if (typeof input === 'string') {
    seed = 2166136261;
    for (const character of input) {
      seed ^= character.codePointAt(0);
      seed = Math.imul(seed, 16777619);
    }
  } else if (Number.isFinite(input)) {
    seed = Number(input);
  } else {
    throw new TypeError('seed must be a finite number or string');
  }

  let state = seed | 0;
  return () => {
    state = state + 0x6D2B79F5 | 0;
    let value = Math.imul(state ^ state >>> 15, 1 | state);
    value = value + Math.imul(value ^ value >>> 7, 61 | value) ^ value;
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

function scoreVertex(game, vertexKey) {
  const hexes = G.getVertexAdjacentHexes(game, vertexKey).filter(hex => hex.resource);
  const diversity = new Set(hexes.map(hex => hex.resource)).size;
  return hexes.reduce((score, hex) => score + (PIPS[hex.number] || 0), 0) +
    diversity * 3 +
    hexes.filter(hex => hex.resource === 'ore' || hex.resource === 'grain').length;
}

function scoreRoad(game, edgeKey) {
  const match = edgeKey.match(/^e_(-?\d+)_(-?\d+)_(\d)$/);
  if (!match) return -Infinity;
  const [, q, r, direction] = match.map(Number);
  const vertices = [G.vertexKey(q, r, direction), G.vertexKey(q, r, (direction + 1) % 6)];
  return Math.max(...vertices.flatMap(vertex => [vertex, ...G.getAdjacentVertices(vertex, game.hexes)])
    .map(vertex => scoreVertex(game, vertex)));
}

function scoreShip(view, edgeKey) {
  const match = /^e_(-?\d+)_(-?\d+)_(\d)$/.exec(edgeKey);
  if (!match) return -Infinity;
  const [,q,r,direction] = match.map(Number);
  const adjacent = [G.vertexKey(q,r,direction),G.vertexKey(q,r,(direction+1)%6)]
    .flatMap(vertex=>G.getVertexAdjacentHexes(view.gameState,vertex));
  const home = view.gameState.seafarers?.homeRegions?.[view.seatId] || [];
  const goals = Object.values(view.gameState.hexes).filter(hex=>hex.terrain==='fog'
    || (hex.terrain!=='sea' && hex.region && !home.includes(hex.region)));
  if (!goals.length) return scoreRoad(view.gameState,edgeKey);
  const distance = Math.min(...adjacent.flatMap(hex=>goals.map(target=>Math.max(
    Math.abs(hex.q-target.q),Math.abs(hex.r-target.r),Math.abs(hex.q+hex.r-target.q-target.r)))));
  return 100-distance*10+adjacent.filter(hex=>hex.terrain==='fog').length*20;
}

function chooseScenarioChoice(view) {
  const actions=view.legalActions.filter(action=>action.type==='resolveSeafarersChoice');
  const hand=ownPlayer(view)?.resources || {};
  return actions.sort((a,b)=>{
    const missing=action=>deficit(desiredCost(view),hand,action.payload.optionId);
    return missing(b)-missing(a);
  })[0];
}

function best(actions, type, score = () => 0) {
  return actions
    .filter(action => action.type === type)
    .sort((a, b) => score(b.payload) - score(a.payload))[0];
}

function ownPlayer(view) {
  return view.gameState.players[view.gameState.myIndex];
}

function countsOnBoard(view) {
  const counts = {settlement: 0, city: 0};
  for (const vertex of Object.values(view.gameState.vertices)) {
    if (vertex.owner === view.gameState.myIndex && vertex.building) counts[vertex.building]++;
  }
  return counts;
}

function desiredCost(view) {
  const player = ownPlayer(view);
  const built = countsOnBoard(view);
  if (player.cities > 0 && built.settlement > 0) return COSTS.city;
  if (player.settlements > 0) return COSTS.settlement;
  return COSTS.developmentCard;
}

function deficit(cost, hand, resource) {
  return Math.max(0, (cost[resource] || 0) - hand[resource]);
}

function chooseBankTrade(view, cost) {
  const hand = ownPlayer(view).resources;
  const actions = view.legalActions.filter(action => action.type === 'bankTrade');
  return actions
    .sort((a, b) => {
      const score = action => deficit(cost, hand, action.payload.getResource) * 20 +
        Math.max(0, hand[action.payload.giveResource] - (cost[action.payload.giveResource] || 0)) -
        (cost[action.payload.giveResource] || 0) * 2;
      return score(b) - score(a);
    })
    .find(action => deficit(cost, hand, action.payload.getResource) > 0 &&
      hand[action.payload.giveResource] - action.payload.giveAmount >= 0);
}

function chooseDiscard(view) {
  let remaining = view.decision.count;
  const result = Object.fromEntries(RESOURCES.map(resource => [resource, 0]));
  const ordered = [...RESOURCES].sort((a, b) => view.decision.resources[b] - view.decision.resources[a]);
  for (const resource of ordered) {
    const amount = Math.min(remaining, view.decision.resources[resource]);
    result[resource] = amount;
    remaining -= amount;
  }
  if (remaining !== 0) throw new Error('Scripted discard could not satisfy the server decision');
  return result;
}

function normalizeStopAfter(stopAfter) {
  if (stopAfter == null) return {turns: null, commands: null, pause: true, predicate: null};
  if (Number.isSafeInteger(stopAfter) && stopAfter >= 0) {
    return {turns: stopAfter, commands: null, pause: true, predicate: null};
  }
  if (typeof stopAfter === 'function') {
    return {turns: null, commands: null, pause: true, predicate: stopAfter};
  }
  if (!stopAfter || typeof stopAfter !== 'object' || Array.isArray(stopAfter)) {
    throw new TypeError('stopAfter must be a turn count or an options object');
  }
  const turns = stopAfter.turns ?? null;
  const commands = stopAfter.commands ?? stopAfter.actions ?? null;
  if (turns !== null && (!Number.isSafeInteger(turns) || turns < 0)) {
    throw new TypeError('stopAfter.turns must be a non-negative integer');
  }
  if (commands !== null && (!Number.isSafeInteger(commands) || commands < 0)) {
    throw new TypeError('stopAfter.commands must be a non-negative integer');
  }
  if (stopAfter.pause !== undefined && typeof stopAfter.pause !== 'boolean') {
    throw new TypeError('stopAfter.pause must be boolean');
  }
  if (stopAfter.when !== undefined && typeof stopAfter.when !== 'function') {
    throw new TypeError('stopAfter.when must be a function');
  }
  return {
    turns,
    commands,
    pause: stopAfter.pause !== false,
    predicate: stopAfter.when || null,
  };
}

function actorInfo(actor) {
  return {
    role: actor.role,
    name: actor.name || null,
    seatId: actor.seatId || null,
    generation: actor.generation || 0,
  };
}

function safeReplayId(created, room, view) {
  return created?.replayId ?? room?.replayId ?? room?.recordingId ?? view?.replayId ?? null;
}

function resourceTotal(resources) {
  return RESOURCES.reduce((total, resource) => total + (resources?.[resource] || 0), 0);
}

function summarizePlayers(game) {
  return (game?.players || []).map(player => ({
    id: player.id,
    name: player.name,
    victoryPoints: player.victoryPoints,
    resources: resourceTotal(player.resources),
    developmentCards: player.developmentCards?.length || 0,
    newDevelopmentCards: player.newDevCards?.length || 0,
    settlements: player.settlements,
    cities: player.cities,
    roads: player.roads,
  }));
}

function requireSuccess(result, action, context) {
  if (!result?.success) {
    const detail = result?.error ? `: ${result.error}` : '';
    throw new Error(`Scripted ${action} failed${detail}${context ? ` (${context})` : ''}`);
  }
  return result;
}

/**
 * Play a deterministic match through RoomService's public commands.
 *
 * The fixture uses three ordinary human seats named Mira, Jon and Cora, so no
 * provider, paid model, connector, lease or fabricated AI result is involved.
 * `stopAfter` may be a number of completed rolls, or an object such as
 * `{turns: 6, pause: true}`. An object may also use `commands`/`actions` or a
 * `when(context)` predicate. A reached stop is resolved with the real host
 * `pause` command by default, leaving an unfinished recording resumable.
 *
 * `onTransition` receives one object after each accepted RoomService command:
 * `{code, replayId, sequence, revision, actor, command, result, room, state}`.
 * `room` and `state` are the same cloned internal snapshot, provided for an
 * in-process recorder/projection comparison. They contain no clear auth token;
 * callers must project them before persisting a replay payload.
 *
 * The return value contains a credential-free overview. A non-enumerable
 * `localCredentials` field is available to an in-process test if it needs to
 * make another authenticated call; callers should never persist or print it.
 */
export function playScriptedMatch({
  service,
  title = 'Sample match',
  seed = DEFAULT_SEED,
  now,
  onTransition,
  maxTurns = 1000,
  stopAfter,
  sample = true,
  seatCount = 3,
  gameOptions,
} = {}) {
  if (!service || typeof service.create !== 'function' || typeof service.command !== 'function' ||
      typeof service.observe !== 'function') {
    throw new TypeError('playScriptedMatch requires a RoomService-compatible service');
  }
  if (!Number.isSafeInteger(maxTurns) || maxTurns < 1) throw new TypeError('maxTurns must be positive');
  if (typeof onTransition !== 'undefined' && typeof onTransition !== 'function') {
    throw new TypeError('onTransition must be a function');
  }
  if (typeof title !== 'string' || !title.trim() || title.trim().length > 40) {
    throw new TypeError('title must contain 1–40 characters');
  }
  const stop = normalizeStopAfter(stopAfter);
  const originalRandom = Math.random;
  const originalNow = service.now;
  let replacementNow;
  if (now !== undefined) {
    if (typeof now === 'function') replacementNow = now;
    else if (Number.isFinite(now)) replacementNow = () => now;
    else throw new TypeError('now must be a function or finite number');
  }
  Math.random = seededRandom(seed);
  if (replacementNow) service.now = replacementNow;

  let created;
  let code;
  let host;
  let bots;
  let request = 0;
  let commands = 0;
  let turns = 0;
  let transitionCount = 0;
  let stopped = false;
  let chatSent = false;
  const successful = {};
  const playedCards = new Set();
  const turnMemory = new Map();

  try {
    created = requireSuccess(service.create({
      name: title.trim(),
      title: title.trim(),
      seatCount,
      gameOptions,
      sample: sample === true,
    }), 'room creation');
    code = created.code;
    host = {token: created.token, role: 'host', name: title.trim(), generation: 0};
    const lobby = requireSuccess(service.observe(code, host.token), 'lobby observation');
    bots = lobby.slots.map((slot, index) => {
      if (typeof service.now?.advance === 'function') {
        service.now.advance({type: 'join', actor: {role: 'human', name: PLAYER_NAMES[index]}});
      }
      const joined = requireSuccess(service.join(code, {
        name: PLAYER_NAMES[index],
        role: 'human',
        seatId: slot.id,
      }), 'seat join', PLAYER_NAMES[index]);
      turnMemory.set(joined.seatId, {paidRoad: false});
      return {...joined, name: PLAYER_NAMES[index]};
    });

    const actorFor = id => bots.find(bot => bot.seatId === id);
    const observe = actor => {
      const view = service.observe(code, actor.token);
      return requireSuccess(view, 'observation', actor.name);
    };
    const command = (actor, view, type, payload = {}) => {
      const requestId = `sample-${++request}`;
      const envelope = {
        requestId,
        revision: view.revision,
        generation: actor.generation || 0,
        type,
        payload,
      };
      // The sample generator supplies an optional deterministic clock with an
      // advance hook. Advancing once per accepted command keeps replay timing
      // human-readable while all service.now() calls during that command see
      // one consistent timestamp. Ordinary callers can pass any plain clock.
      if (typeof service.now?.advance === 'function') service.now.advance({type, actor: actorInfo(actor)});
      const result = service.command(code, actor.token, envelope);
      requireSuccess(result, type, actor.name || actor.role);
      commands++;
      successful[type] = (successful[type] || 0) + 1;
      if (type === 'playDevCard') playedCards.add(payload.cardType);
      const room = service.roomFor(code);
      const replayId = safeReplayId(created, room, view);
      const recording = replayId && typeof service.recordingFor === 'function'
        ? service.recordingFor(replayId)
        : null;
      if (typeof onTransition === 'function') {
        const snapshot = room ? clone(room) : null;
        onTransition({
          code,
          replayId,
          sequence: ++transitionCount,
          recordingSequence: recording?.lastSeq ?? null,
          revision: result.revision ?? room?.revision ?? null,
          actor: actorInfo(actor),
          command: {requestId, type, payload: clone(payload)},
          result: clone(result),
          room: snapshot,
          state: snapshot,
        });
      } else {
        transitionCount++;
      }
      return result;
    };

    for (const bot of bots) {
      const view = observe(bot);
      command(bot, view, 'ready');
    }
    command(host, observe(host), 'start');

    while (observe(host).gameState?.phase === 'setup') {
      const state = observe(host).gameState;
      const actor = actorFor(state.pendingChoice?.actorId || state.players[state.currentPlayerIndex].id);
      if (!actor) throw new Error('Setup selected an unknown scripted seat');
      const view = observe(actor);
      const scenarioChoice=chooseScenarioChoice(view)||best(view.legalActions,'placePort');
      if(scenarioChoice){command(actor,view,scenarioChoice.type,scenarioChoice.payload);continue;}
      const settlement = best(view.legalActions, 'placeSettlement', payload => scoreVertex(view.gameState, payload.vertexKey)
        +(state.seafarers?G.getVertexAdjacentHexes(state,payload.vertexKey).filter(hex=>hex.terrain==='sea'||hex.terrain==='fog').length*6:0));
      if (settlement) {
        command(actor, view, settlement.type, settlement.payload);
        continue;
      }
      const road = (state.seafarers&&best(view.legalActions,'placeShip',payload=>scoreShip(view,payload.edgeKey)))
        ||best(view.legalActions, 'placeRoad', payload => scoreRoad(view.gameState, payload.edgeKey));
      if (road) {
        command(actor, view, road.type, road.payload);
        continue;
      }
      const advance = best(view.legalActions, 'advanceSetup');
      if (!advance) throw new Error('Setup has no legal continuation');
      command(actor, view, advance.type, advance.payload);
    }

    const shouldStop = () => {
      const room = service.roomFor(code);
      const game = room?.game;
      const snapshot = room ? clone(room) : null;
      const context = {
        code,
        title: title.trim(),
        commands,
        turns,
        room: snapshot,
        game: snapshot?.game || null,
        successful: {...successful},
      };
      return (stop.turns !== null && turns >= stop.turns) ||
        (stop.commands !== null && commands >= stop.commands) ||
        (stop.predicate?.(context) === true);
    };

    while (true) {
      const hostView = observe(host);
      const game = hostView.gameState;
      if (!game) throw new Error('Active sample room has no game state');
      if (game.phase === 'finished') break;
      if (service.roomFor(code).paused) {
        stopped = true;
        break;
      }
      if (turns >= maxTurns) throw new Error(`Scripted match exceeded maxTurns=${maxTurns}`);
      if (shouldStop()) {
        stopped = true;
        if (stop.pause) command(host, observe(host), 'pause');
        break;
      }

      if(game.pendingChoice) {
        const actor=actorFor(game.pendingChoice.actorId),view=observe(actor),action=chooseScenarioChoice(view);
        if(!action)throw new Error('Scenario choice has no legal continuation');
        command(actor,view,action.type,action.payload);continue;
      }

      if (game.turnPhase === 'discard') {
        let discarded = false;
        for (const bot of bots) {
          const view = observe(bot);
          if (view.decision?.type === 'discardCards') {
            command(bot, view, 'discardCards', {resources: chooseDiscard(view)});
            discarded = true;
            break;
          }
        }
        if (!discarded) throw new Error('Discard phase has no player decision');
        continue;
      }

      const currentId = game.players[game.currentPlayerIndex].id;
      const actor = actorFor(currentId);
      if (!actor) throw new Error('Current player has no scripted controller');
      const view = observe(actor);
      const me = ownPlayer(view);
      if (!RESOURCES.every(resource => Number.isSafeInteger(me.resources[resource]) && me.resources[resource] >= 0)) {
        throw new Error('Current player has an invalid resource balance');
      }
      if (game.turnPhase === 'roll' && turnMemory.get(currentId)) turnMemory.get(currentId).paidRoad = false;

      if (game.turnPhase === 'robber') {
        const moves = view.legalActions.filter(action => action.type === 'moveRobber'||action.type === 'movePirate');
        const move = moves.find(action => action.payload.stealFromPlayerId) || moves[0];
        if (!move) throw new Error('Robber has no legal destination');
        command(actor, view, move.type, move.payload);
        continue;
      }
      if (game.turnPhase === 'robberPick') {
        const card = view.legalActions.find(action => action.type === 'chooseRobberCard');
        if (!card) throw new Error('Robber has no face-down card choice');
        command(actor, view, card.type, card.payload);
        continue;
      }
      if (game.yearOfPlentyPicks > 0) {
        const cost = desiredCost(view);
        const picks = view.legalActions.filter(action => action.type === 'yearOfPlentyPick');
        const pick = picks.sort((a, b) => deficit(cost, me.resources, b.payload.resource) -
          deficit(cost, me.resources, a.payload.resource))[0];
        if (!pick) throw new Error('Year of Plenty has no available bank resource');
        command(actor, view, pick.type, pick.payload);
        continue;
      }
      if (game.freeRoads > 0) {
        const road = (game.seafarers&&best(view.legalActions,'placeShip',payload=>scoreShip(view,payload.edgeKey)))
          ||best(view.legalActions, 'placeRoad', payload => scoreRoad(view.gameState, payload.edgeKey));
        const finish = best(view.legalActions, 'finishFreeRoads');
        const action = road || finish;
        if (!action) throw new Error('Road Building has no resolution');
        command(actor, view, action.type, action.payload);
        continue;
      }

      if (game.turnPhase === 'roll') {
        const devPriority = ['knight', 'yearOfPlenty', 'monopoly', 'roadBuilding'];
        const dev = devPriority
          .map(card => view.legalActions.find(action => action.type === 'playDevCard' && action.payload.cardType === card))
          .find(Boolean);
        if (dev) {
          if (dev.payload.cardType === 'monopoly') {
            const cost = desiredCost(view);
            dev.payload = view.legalActions
              .filter(action => action.type === 'playDevCard' && action.payload.cardType === 'monopoly')
              .sort((a, b) => deficit(cost, me.resources, b.payload.params.resource) -
                deficit(cost, me.resources, a.payload.params.resource))[0].payload;
          }
          command(actor, view, dev.type, dev.payload);
          continue;
        }
        const roll = best(view.legalActions, 'rollDice');
        if (!roll) throw new Error('Roll phase has no roll action');
        command(actor, view, roll.type, roll.payload);
        turns++;
        continue;
      }

      if (game.turnPhase !== 'main') throw new Error(`Unknown game phase ${game.turnPhase}`);

      if (!chatSent) {
        command(actor, view, 'chat', {message: 'The sample table is ready to trade.'});
        chatSent = true;
        continue;
      }

      // Execute one real offer, acceptance and confirmation once both players
      // naturally have a mutually useful card. No hand or board state is
      // injected to force this exchange.
      if (!successful.tradeConfirm && view.gameState.playerTradingAllowed !== false) {
        for (const target of bots.filter(bot => bot.seatId !== actor.seatId)) {
          const targetView = observe(target);
          const theirHand = ownPlayer(targetView).resources;
          const exchange = RESOURCES.flatMap(give => RESOURCES.map(get => ({give, get})))
            .find(({give, get}) => give !== get && me.resources[give] >= 2 && theirHand[get] >= 2);
          if (!exchange) continue;
          command(actor, view, 'tradeOffer', {
            to: target.seatId,
            give: {[exchange.give]: 1},
            get: {[exchange.get]: 1},
          });
          let responseView = observe(target);
          command(target, responseView, 'tradeAccept', {tradeId: responseView.trade.id});
          responseView = observe(actor);
          command(actor, responseView, 'tradeConfirm', {tradeId: responseView.trade.id});
          break;
        }
        if (successful.tradeConfirm) continue;
      }

      const city = best(view.legalActions, 'upgradeToCity', payload => scoreVertex(view.gameState, payload.vertexKey));
      if (city) {
        command(actor, view, city.type, city.payload);
        continue;
      }
      const settlement = best(view.legalActions, 'placeSettlement', payload => scoreVertex(view.gameState, payload.vertexKey));
      if (settlement) {
        command(actor, view, settlement.type, settlement.payload);
        continue;
      }

      const cost = desiredCost(view);
      const bankTrade = chooseBankTrade(view, cost);
      if (bankTrade) {
        command(actor, view, bankTrade.type, bankTrade.payload);
        continue;
      }

      const memory = turnMemory.get(currentId);
      const ship=game.seafarers&&best(view.legalActions,'placeShip',payload=>scoreShip(view,payload.edgeKey));
      if(ship&&memory&&!memory.paidRoad){command(actor,view,ship.type,ship.payload);memory.paidRoad=true;continue;}
      const road = best(view.legalActions, 'placeRoad', payload => scoreRoad(view.gameState, payload.edgeKey));
      if (road && memory && !memory.paidRoad && countsOnBoard(view).settlement === 0) {
        command(actor, view, road.type, road.payload);
        memory.paidRoad = true;
        continue;
      }
      if (road && memory && !memory.paidRoad && me.settlements > 0 &&
          me.resources.brick >= 1 && me.resources.lumber >= 1) {
        command(actor, view, road.type, road.payload);
        memory.paidRoad = true;
        continue;
      }

      const buy = best(view.legalActions, 'buyDevCard');
      if (buy) {
        command(actor, view, buy.type, buy.payload);
        continue;
      }

      const end = best(view.legalActions, 'endTurn');
      if (!end) throw new Error('Main phase has no end-turn action');
      command(actor, view, end.type, end.payload);
    }

    const room = service.roomFor(code);
    const finalView = requireSuccess(service.observe(code, host.token), 'final observation');
    const finalGame = finalView.gameState;
    const winner = finalGame?.winner ? finalGame.players.find(player => player.id === finalGame.winner) : null;
    const status = finalGame?.phase === 'finished' ? 'finished' : room.paused ? 'paused' : 'incomplete';
    const replayId = safeReplayId(created, room, finalView);
    const overview = {
      title: title.trim(),
      replayId,
      sample: room.sample === true || sample === true,
      status,
      paused: room.paused === true,
      players: summarizePlayers(room.game),
      winner: winner ? {id: winner.id, name: winner.name, victoryPoints: winner.victoryPoints} : null,
      turns,
      commands,
      revisions: room.revision,
      eventCount: Array.isArray(room.events) ? room.events.length : null,
      cardEventCount: Array.isArray(room.cardEvents) ? room.cardEvents.length : null,
      chatMessageCount: Array.isArray(room.chat) ? room.chat.length : null,
      recordingEventCount: typeof service.recordingFor === 'function' && replayId
        ? service.recordingFor(replayId)?.lastSeq ?? null
        : null,
      shareLink: replayId ? `/replay/${encodeURIComponent(replayId)}` : null,
    };
    const output = {
      success: true,
      code,
      replayId,
      title: title.trim(),
      sample: sample === true,
      status,
      paused: room.paused === true,
      turns,
      commands,
      transitions: transitionCount,
      successful,
      playedCards: [...playedCards],
      winner: overview.winner,
      overview,
    };
    // Keep credentials available to an in-process test only when explicitly
    // requested by property access. Non-enumerability prevents accidental
    // JSON output or replay export from carrying a room auth token.
    Object.defineProperty(output, 'localCredentials', {
      enumerable: false,
      value: {
        host: {token: host.token, generation: host.generation},
        players: bots.map(bot => ({token: bot.token, seatId: bot.seatId, generation: bot.generation})),
      },
    });
    return output;
  } finally {
    Math.random = originalRandom;
    service.now = originalNow;
  }
}

export const scriptedMatchDefaults = Object.freeze({
  seed: DEFAULT_SEED,
  maxTurns: 1000,
  players: [...PLAYER_NAMES],
});
