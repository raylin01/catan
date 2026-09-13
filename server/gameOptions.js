import {scenarioFor,scenarioLayouts} from '../shared/scenarios.js';
import {validateNewWorldSetup} from '../shared/newWorld.js';

/** Lobby rules are persisted values, never process-wide switches. */
export function baseGameOptions() {
  return {version: 1, extension56: false, expansions: [], scenario: 'base'};
}

export function validateGameOptions(input, seatCount) {
  const value = input === undefined ? baseGameOptions() : input;
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !['version', 'extension56', 'expansions', 'scenario', 'setup'].includes(key))) {
    return {success: false, error: 'Invalid game options'};
  }
  const {version = 1, extension56 = false, expansions = [], scenario = 'base'} = value;
  if (version !== 1 || typeof extension56 !== 'boolean' || !Array.isArray(expansions)
    || expansions.some(expansion=>expansion!=='seafarers') || new Set(expansions).size!==expansions.length) {
    return {success: false, error: 'This ruleset is not supported'};
  }
  if (!(extension56 ? [5, 6] : [3, 4]).includes(seatCount)) {
    return {success: false, error: extension56 ? 'Choose 5 or 6 seats for the extension' : 'Choose 3 or 4 seats, or enable the 5–6 player extension'};
  }
  if (!expansions.length) {
    if (scenario!=='base' || value.setup!==undefined) return {success:false,error:'Choose the base scenario without Seafarers setup options'};
    return {success: true, gameOptions: {version, extension56, expansions: [], scenario}};
  }
  const selected=scenarioFor(scenario);
  if (!selected) return {success:false,error:'Choose a supported Seafarers scenario'};
  const setup=value.setup===undefined ? {} : value.setup;
  if (!setup || typeof setup!=='object' || Array.isArray(setup)
    || Object.keys(setup).some(key=>!['layout','seed','terrainMix','hexSwaps'].includes(key))) return {success:false,error:'Invalid board setup'};
  const layout=setup.layout??(selected.randomLayout?'variable':'fixed');
  const seed=setup.seed??null;
  if (!scenarioLayouts(scenario,seatCount).includes(layout)
    || (seed!==null&&(!Number.isSafeInteger(seed)||seed<0||seed>0xffffffff))) return {success:false,error:'Choose a valid layout and a seed from 0 to 4294967295'};
  let custom={};
  if (scenario==='new_world') {
    const validated=validateNewWorldSetup(setup,seatCount);
    if(!validated.success)return validated;
    custom=validated.setup;
  } else if(setup.terrainMix!==undefined||setup.hexSwaps!==undefined) return {success:false,error:'Custom terrain and island shapes are available in New World'};
  return {success:true,gameOptions:{version,extension56,expansions:['seafarers'],scenario,setup:{layout,seed,...custom}}};
}

// Existing saves were base games. An absent field retains those exact rules.
export function roomGameOptions(room) {
  return structuredClone(room.gameOptions ?? room.game?.gameOptions ?? baseGameOptions());
}

export function rulesVersionFor(options) {
  if (options?.expansions?.includes('seafarers')) return `catan-seafarers-${options.extension56?'56-':''}2025-v1`;
  return options?.extension56 ? 'catan-base-56-2025-v1' : 'catan-rules-1';
}

// Every transport and negotiation path shares the engine's turn gate.
export {isPlayerTradingAllowed as canTradeWithPlayers} from './gameLogic.js';
