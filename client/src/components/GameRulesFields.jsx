import {NEW_WORLD_TERRAINS,newWorldComponents,validateNewWorldSetup} from '../../../shared/newWorld.js';
import GameIcon from './GameIcon';
import {SEAFARERS_SCENARIOS, scenarioFor, scenarioLayouts, scenarioTitle, victoryGoal} from '../../../shared/scenarios.js';

export function rulesDraft(options, seatCount = 4) {
  return {
    seatCount: String(seatCount),
    extension56: options?.extension56 === true,
    seafarers: options?.expansions?.includes('seafarers') === true,
    scenario: scenarioFor(options?.scenario)?.id || 'heading_for_new_shores',
    layout: options?.setup?.layout || 'fixed',
    seed: options?.setup?.seed == null ? '' : String(options.setup.seed),
    terrainMix:options?.setup?.terrainMix,
    hexSwaps:options?.setup?.hexSwaps,
  };
}

export function gameOptionsForDraft(draft) {
  return {
    version: 1,
    extension56: draft.extension56,
    expansions: draft.seafarers ? ['seafarers'] : [],
    scenario: draft.seafarers ? draft.scenario : 'base',
    ...(draft.seafarers ? {setup: {
      layout: draft.scenario === 'new_world' ? 'variable' : draft.layout,
      seed: draft.seed === '' ? null : Number(draft.seed),
      ...(draft.scenario==='new_world' && draft.terrainMix ? {terrainMix:draft.terrainMix}:{}),
      ...(draft.scenario==='new_world' && draft.hexSwaps?.length ? {hexSwaps:draft.hexSwaps}:{}),
    }} : {}),
  };
}

export function validRulesDraft(draft) {
  if (!draft.seafarers) return true;
  const seedValid=draft.seed === '' || (/^\d+$/.test(draft.seed) && Number(draft.seed) <= 0xffffffff);
  return seedValid && (draft.scenario!=='new_world' || validateNewWorldSetup(gameOptionsForDraft(draft).setup,Number(draft.seatCount)).success);
}

export function gameRulesLabel(options, count) {
  const name = options?.expansions?.includes('seafarers')
    ? `Seafarers · ${scenarioTitle(options.scenario, count)}` : 'Base game';
  return `${name}${options?.extension56 ? ' · 5–6 player extension' : ''} · ${count} seats`;
}

export default function GameRulesFields({value, onChange, disabled = false}) {
  const change = patch => {
    const next = {...value, ...patch};
    if (patch.seatCount && patch.seatCount!==value.seatCount) {next.terrainMix=undefined;next.hexSwaps=undefined;}
    if (patch.terrainMix !== undefined || patch.seed !== undefined) next.hexSwaps=undefined;
    const layouts = scenarioLayouts(next.scenario, Number(next.seatCount));
    if (!layouts.includes(next.layout)) next.layout = layouts[0];
    onChange(next);
  };
  const components=newWorldComponents(Number(value.seatCount));
  const customValidation=validateNewWorldSetup(gameOptionsForDraft(value).setup || {},Number(value.seatCount));
  const seedValid=value.seed==='' || (/^\d+$/.test(value.seed) && Number(value.seed)<=0xffffffff);
  const selected = scenarioFor(value.scenario);
  const layouts = scenarioLayouts(value.scenario, Number(value.seatCount));
  return (
    <div className="game-rules-fields">
      <div className="game-rules-toggles">
        <label className="room-rules-switch">
          <input type="checkbox" checked={value.extension56} disabled={disabled}
            onChange={event => change({extension56: event.target.checked, seatCount: event.target.checked ? '5' : '4'})}/>
          <span>5–6 player extension</span>
        </label>
        <label className="room-rules-switch">
          <input type="checkbox" checked={value.seafarers} disabled={disabled}
            onChange={event => change({seafarers: event.target.checked})}/>
          <span>Seafarers</span>
        </label>
      </div>
      <label className="game-rules-field">
        Seats
        <select value={value.seatCount} onChange={event => change({seatCount: event.target.value})} disabled={disabled}>
          {(value.extension56 ? [5, 6] : [3, 4]).map(count => <option key={count} value={count}>{count} seats</option>)}
        </select>
      </label>
      {value.seafarers && <>
        <label className="game-rules-field game-rules-scenario">
          Scenario
          <select value={value.scenario} disabled={disabled} onChange={event => change({scenario: event.target.value, layout: event.target.value === 'new_world' ? 'variable' : value.layout})}>
            {SEAFARERS_SCENARIOS.map(scenario => <option key={scenario.id} value={scenario.id}>{scenarioTitle(scenario.id, Number(value.seatCount))}</option>)}
          </select>
        </label>
        <p className="room-field-help game-rules-description">{selected?.description} {value.scenario === 'the_pirate_islands' ? 'Reach 10 victory points and recapture your fortress.' : value.scenario === 'the_wonders_of_catan' ? 'Complete level 4, or reach 10 VP with a wonder strictly ahead of all opponents.' : `${victoryGoal(gameOptionsForDraft(value))} victory points to win.`}</p>
        <label className="game-rules-field">
          Board setup
          <select value={value.scenario === 'new_world' ? 'variable' : value.layout} disabled={disabled || layouts.length === 1} onChange={event => change({layout: event.target.value})}>
            {layouts.map(layout => <option key={layout} value={layout}>{layout === 'fixed' ? 'Official fixed layout' : 'Variable layout'}</option>)}
          </select>
        </label>
        {value.scenario==='new_world' && <details className="game-rules-terrain">
          <summary>Customize terrain</summary>
          <p className="room-field-help">Use {components.frameSlots} tiles in total, within the available component supply.</p>
          <div className="new-world-terrain-counts">{NEW_WORLD_TERRAINS.map(({id,label})=><label key={id}><span><GameIcon name={id} size={18}/>{label}</span><input type="number" min="0" max={components.terrainMaxima[id]} step="1" inputMode="numeric" value={(value.terrainMix || components.defaultTerrain)[id]} disabled={disabled} onChange={event=>change({terrainMix:{...(value.terrainMix || components.defaultTerrain),[id]:Number(event.target.value)}})}/><small>of {components.terrainMaxima[id]}</small></label>)}</div>
          <p className="room-field-help" role="status">{Object.values(value.terrainMix || components.defaultTerrain).reduce((sum,count)=>sum+count,0)} / {components.frameSlots} tiles</p>
          {!customValidation.success && <p className="room-field-help" role="alert">{customValidation.error}</p>}
          <button type="button" className="room-secondary-button" disabled={disabled || !value.terrainMix} onClick={()=>onChange({...value,terrainMix:undefined,hexSwaps:undefined})}>Use standard terrain</button>
        </details>}
        <details className="game-rules-seed">
          <summary>Repeat a board setup</summary>
          <label className="game-rules-field">
            Setup seed (optional)
            <input type="number" inputMode="numeric" min="0" max="4294967295" step="1" value={value.seed} disabled={disabled}
              onChange={event => change({seed: event.target.value})} placeholder="Random" aria-invalid={!seedValid}/>
          </label>
          <p className="room-field-help">Use the same number to repeat the public board layout.</p>
          {!seedValid && <p className="room-field-help" role="alert">Enter a whole number from 0 to 4294967295, or leave this blank.</p>}
        </details>
      </>}
      {value.extension56 && <p className="room-field-help game-rules-description">After each normal turn, the player three seats later takes an extra action phase. They can trade with the bank and ports, build, and play cards.</p>}
    </div>
  );
}
