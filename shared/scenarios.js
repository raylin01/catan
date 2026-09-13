/** Public scenario catalog. Hidden map stacks and rewards belong to the server. */
export const SEAFARERS_SCENARIOS = [
  {id:'heading_for_new_shores',title:'Heading for New Shores',goal:14,
    description:'Leave the main island and earn points for your first settlement on each smaller island.',
    maps:{3:'heading_3',4:'heading_4',5:'heading_56',6:'heading_56'}},
  {id:'the_four_islands',title:'The Four Islands',extendedTitle:'The Six Islands',goal:13,
    description:'Choose your home islands, then establish settlements on unexplored islands.',
    maps:{3:'four_islands_3',4:'four_islands_4',5:'six_islands_56',6:'six_islands_56'}},
  {id:'the_fog_islands',title:'The Fog Islands',goal:12,
    description:'Reveal unknown waters and land as you extend your routes into the fog.',
    maps:{3:'fog_3',4:'fog_4',5:'fog_56',6:'fog_56'}},
  {id:'through_the_desert',title:'Through the Desert',goal:14,
    description:'Cross the desert or sail around it to settle unexplored regions.',
    maps:{3:'desert_3',4:'desert_4',5:'desert_56',6:'desert_56'}},
  {id:'the_forgotten_tribe',title:'The Forgotten Tribe',goal:13,
    description:'Reach the tribe’s shores to collect victory points, development cards, and portable harbors.',
    maps:{3:'forgotten_34',4:'forgotten_34',5:'forgotten_56',6:'forgotten_56'}},
  {id:'cloth_for_catan',title:'Cloth for Catan',goal:14,longestRoute:false,
    description:'Connect to island villages and collect cloth. The game also ends when five villages run out.',
    maps:{3:'cloth_34',4:'cloth_34',5:'cloth_56',6:'cloth_56'}},
  {id:'the_pirate_islands',title:'The Pirate Islands',goal:10,longestRoute:false,largestArmy:false,
    description:'Build warships, withstand the pirate fleet, and recapture your fortress to win.',
    maps:{3:'pirate_34',4:'pirate_34',5:'pirate_56',6:'pirate_56'}},
  {id:'the_wonders_of_catan',title:'The Wonders of Catan',goal:10,
    description:'Complete a wonder, or reach the victory-point goal with the most advanced wonder.',
    maps:{3:'wonders_34',4:'wonders_34',5:'wonders_56',6:'wonders_56'}},
  {id:'new_world',title:'New World',goal:12,randomLayout:true,
    description:'Explore a newly generated archipelago and place its harbors together before settling.',
    maps:{3:'new_world_34',4:'new_world_34',5:'new_world_56',6:'new_world_56'}},
];

export function scenarioFor(id) {
  return SEAFARERS_SCENARIOS.find(scenario=>scenario.id===id) || null;
}

export function scenarioMapKey(id,playerCount) {
  return scenarioFor(id)?.maps[playerCount] || null;
}

export function scenarioTitle(id,playerCount) {
  const scenario=scenarioFor(id);
  return playerCount>=5 && scenario?.extendedTitle ? scenario.extendedTitle : scenario?.title || 'Base game';
}

/** Published variable recipes use their exact regional and number exclusions. */
export function scenarioLayouts(id, playerCount) {
  if (id === 'new_world') return ['variable'];
  if (id === 'the_pirate_islands' || (playerCount >= 5 && id !== 'heading_for_new_shores')) return ['fixed'];
  return ['fixed', 'variable'];
}

export function victoryGoal(options) {
  const cities=options?.expansions?.includes('cities_knights');
  return options?.expansions?.includes('seafarers') ? (scenarioFor(options.scenario)?.goal || 10)+(cities?2:0) : cities?13:10;
}
