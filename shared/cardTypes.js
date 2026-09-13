/** Resource and commodity card names shared by transport and presentation. */
export const RESOURCE_CARDS = Object.freeze(['brick','lumber','wool','grain','ore']);
export const COMMODITY_CARDS = Object.freeze(['paper','coin','cloth']);
export const ALL_HAND_CARDS = Object.freeze([...RESOURCE_CARDS,...COMMODITY_CARDS]);

export function hasCitiesKnights(gameOrOptions) {
  return Boolean(gameOrOptions?.citiesKnights ||
    (gameOrOptions?.gameOptions ?? gameOrOptions)?.expansions?.includes('cities_knights'));
}

export function cardTypesFor(gameOrOptions) {
  return hasCitiesKnights(gameOrOptions) ? ALL_HAND_CARDS : RESOURCE_CARDS;
}

export function combinedHand(player) {
  return {
    ...(player?.resources && typeof player.resources === 'object' ? player.resources : {}),
    ...(player?.commodities && typeof player.commodities === 'object' ? player.commodities : {}),
  };
}
