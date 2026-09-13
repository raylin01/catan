import {NEW_WORLD_COMPONENTS} from './newWorldComponents.js';

export const NEW_WORLD_TERRAINS = [
  {id:'sea',label:'Sea'}, {id:'gold',label:'Gold fields'}, {id:'hills',label:'Hills'},
  {id:'forest',label:'Forest'}, {id:'pasture',label:'Pasture'}, {id:'fields',label:'Fields'},
  {id:'mountains',label:'Mountains'}, {id:'desert',label:'Desert'},
];

export function newWorldComponents(playerCount) {
  return structuredClone(NEW_WORLD_COMPONENTS[playerCount >= 5 ? 'extended' : 'standard']);
}

/** Validate optional New World edits within the published frame and physical supply. */
export function validateNewWorldSetup(setup, playerCount) {
  const components = newWorldComponents(playerCount);
  const normalized = {};
  if (setup.terrainMix !== undefined) {
    const mix = setup.terrainMix;
    if (!mix || typeof mix !== 'object' || Array.isArray(mix)
      || Object.keys(mix).length !== NEW_WORLD_TERRAINS.length
      || NEW_WORLD_TERRAINS.some(({id}) => !Object.hasOwn(mix,id) || !Number.isSafeInteger(mix[id]) || mix[id] < 0 || mix[id] > components.terrainMaxima[id])) {
      return {success:false,error:'Choose whole terrain counts within the available supply'};
    }
    if (Object.values(mix).reduce((sum,count) => sum+count,0) !== components.frameSlots) {
      return {success:false,error:`Use exactly ${components.frameSlots} hexes to fill this board`};
    }
    const numbered = components.frameSlots-mix.sea-mix.desert;
    if (numbered > Object.values(components.numberDiscs).reduce((sum,count) => sum+count,0)) {
      return {success:false,error:'There are not enough number discs for this terrain mix'};
    }
    normalized.terrainMix = Object.fromEntries(NEW_WORLD_TERRAINS.map(({id})=>[id,mix[id]]));
  }
  if (setup.hexSwaps !== undefined) {
    const swaps = setup.hexSwaps, locations = new Set(components.hexKeys);
    if (!Array.isArray(swaps) || swaps.length > components.frameSlots*2
      || swaps.some(pair => !Array.isArray(pair) || pair.length !== 2 || pair[0] === pair[1] || pair.some(key => !locations.has(key)))) {
      return {success:false,error:'Choose two different board hexes for each swap'};
    }
    if (swaps.length) normalized.hexSwaps = swaps.map(pair=>[...pair]);
  }
  return {success:true,setup:normalized};
}
