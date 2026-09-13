import GameIcon from './GameIcon';
import { useEffect, useRef, useState } from 'react';
import { useGamePresentation } from '../presentation/GamePresentation';
import './DiceDisplay.css';

const FACE_DOTS = {
  1: [5], 2: [1, 9], 3: [1, 5, 9], 4: [1, 3, 7, 9],
  5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9],
};
const LANDING_ROTATION = {
  1: ['0deg', '0deg'], 2: ['-90deg', '0deg'], 3: ['0deg', '-90deg'],
  4: ['0deg', '90deg'], 5: ['90deg', '0deg'], 6: ['0deg', '180deg'],
};

function DieFace({ value, side }) {
  const dots = FACE_DOTS[value];
  return <span className={`die-face die-face-${side}`} aria-hidden="true">
    {Array.from({ length: 9 }, (_, index) => <span key={index} className={`die-dot ${dots.includes(index + 1) ? 'is-visible' : ''}`} />)}
  </span>;
}

function Die({ value, index, rollId, tumbling }) {
  const [x, y] = LANDING_ROTATION[value] || LANDING_ROTATION[1];
  return <span className={`die-stage die-stage-${index} ${tumbling ? 'is-tumbling' : ''}`} aria-hidden="true">
    <span className="die-shadow" />
    <span key={`${rollId ?? 'roll'}-${index}`} className={`die-cube ${tumbling ? 'is-tumbling' : ''} die-cube-${index}`} style={{ '--die-x': x, '--die-y': y }}>
      <DieFace value={1} side="front" /><DieFace value={6} side="back" />
      <DieFace value={3} side="right" /><DieFace value={4} side="left" />
      <DieFace value={2} side="top" /><DieFace value={5} side="bottom" />
    </span>
  </span>;
}

function DiceDisplay({ citiesKnights, roll, rollId, onRightClick, animate = true, duration = 900 }) {
  const [tumbling, setTumbling] = useState(false);
  const { playSound } = useGamePresentation();
  const animatedRollId = useRef(null);
  const soundedRollId = useRef(null);
  const tumbleTimer = useRef(null);
  const hasRoll = Boolean(roll);
  const motionDuration = Number.isFinite(duration) && duration > 0 ? duration : 900;
  useEffect(() => {
    if (!hasRoll || !animate || rollId == null) {
      window.clearTimeout(tumbleTimer.current);
      setTumbling(false);
      return;
    }
    // Changing playback speed must not roll already-settled dice again.
    if (animatedRollId.current === rollId) return;
    animatedRollId.current = rollId;
    window.clearTimeout(tumbleTimer.current);
    setTumbling(true);
    if (soundedRollId.current !== rollId) {
      soundedRollId.current = rollId;
      playSound('dice');
    }
    tumbleTimer.current = window.setTimeout(() => setTumbling(false), motionDuration);
  }, [rollId, animate, motionDuration, hasRoll, playSound]);
  useEffect(() => () => { window.clearTimeout(tumbleTimer.current); animatedRollId.current = null; }, []);

  if (!roll) return null;
  const isSeven = roll.total === 7;
  const handleContextMenu = (event) => {
    if (!onRightClick) return;
    event.preventDefault();
    onRightClick(event, 'diceRoll', {
      title: `Dice roll: ${roll.total}${citiesKnights?.eventDie?` · ${citiesKnights.eventDie} event`:''}`,
      description: citiesKnights ? `Red die ${roll.die1}, white die ${roll.die2}. ${citiesKnights.eventDie==='barbarian'?'The barbarians advance one space.':'The matching improvement track and red die determine progress-card draws.'} ${isSeven?'Players exceeding their hand limit discard half; each city wall protects two extra cards.':`Tiles numbered ${roll.total} produce resources and city commodities.`}` : isSeven
        ? 'Rolling a 7 activates the robber. Players with 8 or more cards discard half, then the current player moves the robber and steals.'
        : `Hexes numbered ${roll.total} produce resources for adjacent settlements and cities.`,
      number: roll.total,
    });
  };

  return <div
    className={`dice-display ${tumbling ? 'is-tumbling' : ''} ${isSeven ? 'seven' : ''}`}
    onContextMenu={handleContextMenu}
    title={onRightClick ? 'Right-click for roll details' : undefined}
    style={{ '--dice-duration': `${motionDuration}ms` }}
    role="status" aria-live="polite" aria-busy={tumbling}
    aria-label={`Rolled ${roll.die1} and ${roll.die2}, total ${roll.total}${citiesKnights?.eventDie?`, ${citiesKnights.eventDie} event`:''}${isSeven ? citiesKnights&&!citiesKnights.barbarian.attacked?'. Resolve required discards.':'. Robber activated.' : '.'}`}
  >
    <div className={`dice-container ${citiesKnights?'ck-dice':''}`}>
      <span className="dice-tray-mark" aria-hidden="true" />
      <Die value={roll.die1} index={1} rollId={rollId} tumbling={tumbling} />
      <Die value={roll.die2} index={2} rollId={rollId} tumbling={tumbling} />
      {citiesKnights?.eventDie&&<span key={`${rollId}-event`} className={`ck-event-die track-${citiesKnights.eventDie} ${tumbling?'is-tumbling':''}`} role="img" aria-label={`${citiesKnights.eventDie} event die`}><GameIcon name={citiesKnights.eventDie} size={30}/></span>}
    </div>
    <div className="dice-result" aria-hidden="true">
      <span className="dice-total">{roll.total}</span>
      {isSeven && <span className="robber-alert">{citiesKnights&&!citiesKnights.barbarian.attacked?'Seven':'Robber'}</span>}
    </div>
  </div>;
}

export default DiceDisplay;
