/** Lobby rules are persisted values, never process-wide switches. */
export function baseGameOptions() {
  return {version: 1, extension56: false, expansions: [], scenario: 'base'};
}

export function validateGameOptions(input, seatCount) {
  const value = input === undefined ? baseGameOptions() : input;
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !['version', 'extension56', 'expansions', 'scenario'].includes(key))) {
    return {success: false, error: 'Invalid game options'};
  }
  const {version = 1, extension56 = false, expansions = [], scenario = 'base'} = value;
  if (version !== 1 || typeof extension56 !== 'boolean' || !Array.isArray(expansions)
    || expansions.length !== 0 || scenario !== 'base') {
    return {success: false, error: 'This ruleset is not supported'};
  }
  if (!(extension56 ? [5, 6] : [3, 4]).includes(seatCount)) {
    return {success: false, error: extension56 ? 'Choose 5 or 6 seats for the extension' : 'Choose 3 or 4 seats, or enable the 5–6 player extension'};
  }
  return {success: true, gameOptions: {version, extension56, expansions: [], scenario}};
}

// Existing saves were base games. An absent field retains those exact rules.
export function roomGameOptions(room) {
  return structuredClone(room.gameOptions ?? room.game?.gameOptions ?? baseGameOptions());
}

export function rulesVersionFor(options) {
  return options?.extension56 ? 'catan-base-56-2025-v1' : 'catan-rules-1';
}

// Every transport and negotiation path shares the engine's turn gate.
export {isPlayerTradingAllowed as canTradeWithPlayers} from './gameLogic.js';
