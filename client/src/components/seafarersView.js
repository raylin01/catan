import {scenarioFor, scenarioTitle, victoryGoal} from '../../../shared/scenarios.js';

export const WONDERS = [
  {id:'great_wall',name:'Great Wall',requirement:'A building at a Wall marker',cost:{brick:3,lumber:1,grain:1},icon:'wall'},
  {id:'great_bridge',name:'Great Bridge',requirement:'A building at a Bridge marker',cost:{lumber:3,wool:1,grain:1},icon:'bridge'},
  {id:'grand_theater',name:'Grand Theater',requirement:'Two cities',cost:{brick:1,lumber:1,wool:3},icon:'wonder'},
  {id:'grand_castle',name:'Grand Castle',requirement:'One city and at least 6 victory points',cost:{brick:1,grain:1,ore:3},icon:'fortress'},
  {id:'grand_monument',name:'Grand Monument',requirement:'A port city and a route of at least 5 roads or ships',cost:{grain:3,ore:2},icon:'wonder'},
  {id:'lighthouse',name:'Lighthouse',requirement:'A building at a Lighthouse marker',cost:{lumber:3,wool:1,grain:1},icon:'lighthouse'},
  {id:'great_library',name:'Great Library',requirement:'Two cities',cost:{brick:1,lumber:1,wool:3},icon:'wonder'},
];
export const actionPayload = action => action?.payload || {};
export const actionsOfType = (actions, type) => actions.filter(action => action.type === type);
export function shipTargets(actions, source) {
  return actionsOfType(actions, 'moveShip').filter(action => !source || actionPayload(action).fromEdgeKey === source);
}
export function scenarioObjective(game) {
  const id = game.seafarers?.scenario || game.gameOptions?.scenario;
  const goal = game.seafarers?.goal || victoryGoal(game.gameOptions);
  if (id === 'the_pirate_islands') return `${goal} victory points and recapture your fortress`;
  if (id === 'the_wonders_of_catan') return `Complete level 4, or ${goal} VP with a wonder strictly ahead of every opponent`;
  if (id === 'cloth_for_catan') return `${goal} victory points, or highest score when 5 villages empty (cloth breaks ties)`;
  return `${goal} victory points to win`;
}
export function scenarioName(game) {
  return scenarioTitle(game.seafarers?.scenario || game.gameOptions?.scenario, game.players?.length || game.maxPlayers);
}
export function scenarioRules(game) {
  const id = game.seafarers?.scenario;
  const bonus = {
    heading_for_new_shores:'Your first settlement on each small island earns 2 bonus VP.',
    the_four_islands:'Your first settlement on each island outside your home islands earns 2 bonus VP.',
    through_the_desert:'Your first settlement in each unexplored region earns 2 bonus VP.',
    new_world:'Your first settlement on each island outside your home islands earns 1 bonus VP.',
    the_wonders_of_catan:'Your first settlement on each small island earns 1 bonus VP.',
    the_fog_islands:'A route reaching the fog reveals the tile. Producing land gives its resource immediately.',
    the_forgotten_tribe:'Ships collect the marked victory points, development cards and portable harbors.',
    cloth_for_catan:'Connect ships to villages to collect cloth. Every pair of cloth is worth 1 VP. No Longest Route.',
    the_pirate_islands:'Knight cards upgrade ships to warships. An optional fortress attack ends your action phase. No Longest Route or Largest Army.',
  };
  return bonus[id] || scenarioFor(id)?.description || '';
}
export function pendingChoiceStatus(game, playerId) {
  const choice = game.pendingChoice;
  if (!choice) return null;
  const actor = game.players.find(player => player.id === choice.actorId)?.name || 'A player';
  return choice.actorId === playerId ? choice.label : `${actor}: ${choice.label}`;
}
export function framePoint(frame, bounds, nearHex) {
  const middle = {x:(bounds.minX+bounds.maxX)/2,y:(bounds.minY+bounds.maxY)/2};
  const side = String(frame || 'south').replace('frame:','');
  if (side === 'north') return {x:nearHex?.x ?? middle.x,y:bounds.minY-25};
  if (side === 'east') return {x:bounds.maxX+25,y:nearHex?.y ?? middle.y};
  if (side === 'west') return {x:bounds.minX-25,y:nearHex?.y ?? middle.y};
  return {x:nearHex?.x ?? middle.x,y:bounds.maxY+25};
}
