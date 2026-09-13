import {CARD_ARTWORK} from '../presentation/artwork';
import './CardArtwork.css';
import {CITIES_KNIGHTS_CARDS} from '../../../shared/citiesKnights.js';
import {GameIconSymbol} from './GameIcon';

const LABELS = {brick:'Brick works', lumber:'Lumber forest', wool:'Sheep pasture', grain:'Grain field', ore:'Ore mountains', knight:'Knight', victoryPoint:'Victory point', roadBuilding:'Road building', yearOfPlenty:'Year of plenty', monopoly:'Monopoly'};

export default function CardArtwork({name, className = '', decorative = true}) {
  if (name?.startsWith('progress')) {
    const track = name.slice(8).toLowerCase();
    const color = {science:'#477e52',trade:'#b38b32',politics:'#416b91'}[track] || '#766348';
    return <svg viewBox="0 0 80 110" className={`card-artwork ${className}`} role={decorative?undefined:'img'} aria-label={decorative?undefined:`${track} progress card`} aria-hidden={decorative||undefined}><rect x="2" y="2" width="76" height="106" rx="6" fill={color} stroke="#e8d0a2" strokeWidth="4"/><rect x="9" y="9" width="62" height="92" rx="3" fill="none" stroke="#dec897"/><path d="M12 20L68 90M12 40L58 96M22 14L68 60M12 90L68 20M12 60L58 14M22 96L68 40" stroke="#f3dfb5" opacity=".15"/><circle cx="40" cy="55" r="23" fill="#ead6a5" stroke="#755431" strokeWidth="2"/><GameIconSymbol name={track} x={40} y={55} size={30}/></svg>;
  }
  return <img className={`card-artwork card-artwork--${name} ${className}`.trim()}
    src={CARD_ARTWORK[name]} alt={decorative ? '' : LABELS[name] || CITIES_KNIGHTS_CARDS[name]?.name || name || 'Card illustration'}
    aria-hidden={decorative ? true : undefined} draggable="false" />;
}
