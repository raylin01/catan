export const PLACEMENT_CONFIRMATION_KEY = 'catanConfirmPlacements';
export const ROBBER_CONFIRMATION_KEY = 'catanConfirmRobber';

const placementTypes = new Set(['placeSettlement', 'placeRoad', 'upgradeToCity', 'placeShip', 'moveShip', 'placePort']);
const robberTypes = new Set(['moveRobber', 'movePirate', 'driveRobber']);

export const requiresPlacementConfirmation = type => placementTypes.has(type) || robberTypes.has(type);

export function readPlacementConfirmation(storage) {
  try { return storage?.getItem(PLACEMENT_CONFIRMATION_KEY) !== 'off'; }
  catch { return true; }
}

export function readRobberConfirmation(storage) {
  try { return storage?.getItem(ROBBER_CONFIRMATION_KEY) !== 'off'; }
  catch { return true; }
}

export function shouldConfirmAction(type, {confirmPlacements, confirmRobber}) {
  if (placementTypes.has(type)) return confirmPlacements;
  if (robberTypes.has(type)) return confirmRobber;
  return false;
}

export function actionKey(action) {
  return `${action.type}:${JSON.stringify(action.payload || {})}`;
}

export function stagePlacement(current, action, context, commit) {
  if (current?.status === 'sending') return current;
  if (current?.status === 'pending' && current.context === context && actionKey(current.action) === actionKey(action)) return current;
  return {status: 'pending', action, context, commit};
}

export function canConfirmPlacement(pending, context, legalActions, blocked) {
  return !blocked && pending?.status === 'pending' && pending.context === context &&
    legalActions.some(action => actionKey(action) === actionKey(pending.action));
}

export function consumePlacement(pending, context, legalActions, blocked) {
  if (!canConfirmPlacement(pending, context, legalActions, blocked)) return null;
  return {...pending, status: 'sending'};
}
