import { useEffect, useRef, useState } from 'react';
import GameIcon from './GameIcon';
import './ResourceCards.css';

const RESOURCES = [
  { key: 'brick', name: 'Brick', color: '#b85b3f' },
  { key: 'lumber', name: 'Lumber', color: '#416d3c' },
  { key: 'wool', name: 'Wool', color: '#91b96e' },
  { key: 'grain', name: 'Grain', color: '#d1a94e' },
  { key: 'ore', name: 'Ore', color: '#74777b' },
];

function ResourceCards({ resources, compact = false, selectable = false, selected = {}, onSelect, onRightClick, gain = null, gainDelay = 900 }) {
  const seenGainIds = useRef(new Set(gain?.id == null ? [] : [gain.id]));
  const [activeGain, setActiveGain] = useState(null);
  const gainId = gain?.id;

  useEffect(() => {
    if (gainId == null || seenGainIds.current.has(gainId)) return undefined;
    setActiveGain(null);
    seenGainIds.current.add(gainId);
    if (seenGainIds.current.size > 100) seenGainIds.current.delete(seenGainIds.current.values().next().value);
    const positive = Object.fromEntries(RESOURCES.map(({ key }) => [key, Number.isFinite(gain.gains?.[key]) ? Math.max(0, Math.floor(gain.gains[key])) : 0]));
    if (!Object.values(positive).some(Boolean) && gain.fromRoll === 7) return undefined;
    const delay = gain.fromRoll ? gainDelay : 0;
    let clearTimer;
    const showTimer = window.setTimeout(() => {
      setActiveGain({ id: gainId, gains: positive });
      clearTimer = window.setTimeout(() => setActiveGain(current => current?.id === gainId ? null : current), 4000);
    }, delay);
    return () => { window.clearTimeout(showTimer); window.clearTimeout(clearTimer); };
  }, [gainId, gainDelay]);

  if (typeof resources === 'number') {
    return <div className="resource-cards compact">
      <div className="total-cards"><span className="count">{resources} resource cards</span></div>
    </div>;
  }

  const gainedResources = activeGain ? RESOURCES.filter(resource => activeGain.gains[resource.key] > 0) : [];
  const gainSummary = gainedResources.length
    ? gainedResources.map(resource => `+${activeGain.gains[resource.key]} ${resource.name}`).join(', ')
    : 'No resources produced';
  const handleContextMenu = (event, resourceKey) => {
    if (selectable && (selected[resourceKey] || 0) > 0) {
      event.preventDefault();
      onSelect?.(resourceKey, -1);
    } else if (onRightClick) onRightClick(event, resourceKey);
  };

  return <div className={`resource-cards ${compact ? 'compact' : ''}`}>
    {activeGain && <div key={activeGain.id} className="resource-gain-summary" role="status" aria-live="polite">{gainSummary}</div>}
    {RESOURCES.map(resource => {
      const count = resources?.[resource.key] || 0;
      const selectedCount = selected[resource.key] || 0;
      const gained = activeGain?.gains[resource.key] || 0;
      return <div
        key={resource.key}
        data-hand-resource={resource.key}
        className={`resource-card ${count === 0 ? 'empty' : ''} ${selectable ? 'selectable' : ''} ${onRightClick ? 'has-info' : ''} ${gained ? 'is-receiving' : ''}`}
        style={{ '--resource-color': resource.color }}
        onClick={selectable && count > selectedCount ? () => onSelect?.(resource.key, 1) : undefined}
        onContextMenu={event => handleContextMenu(event, resource.key)}
        title={onRightClick && !selectable ? 'Right-click for info' : undefined}
      >
        {gained > 0 && <div key={`${activeGain.id}-${resource.key}`} className="resource-gain-flyer" aria-hidden="true">
          <GameIcon name={resource.key} size={20} className="resource-gain-icon" />
          <strong>+{gained}</strong>
        </div>}
        <div className="card-top"><GameIcon name={resource.key} size={24} className="resource-icon" /></div>
        <div className="card-bottom">
          <span className="resource-name">{resource.name}</span>
          <span className="resource-count">{count}</span>
          {selectable && selectedCount > 0 && <span className="selected-indicator">−{selectedCount}</span>}
        </div>
      </div>;
    })}
  </div>;
}

export default ResourceCards;
