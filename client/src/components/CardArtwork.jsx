import {CARD_ARTWORK} from '../presentation/artwork';
import './CardArtwork.css';

const LABELS = {brick:'Brick works', lumber:'Lumber forest', wool:'Sheep pasture', grain:'Grain field', ore:'Ore mountains', knight:'Knight', victoryPoint:'Victory point', roadBuilding:'Road building', yearOfPlenty:'Year of plenty', monopoly:'Monopoly'};

export default function CardArtwork({name, className = '', decorative = true}) {
  return <img className={`card-artwork card-artwork--${name} ${className}`.trim()}
    src={CARD_ARTWORK[name]} alt={decorative ? '' : LABELS[name] || 'Card illustration'}
    aria-hidden={decorative ? true : undefined} draggable="false" />;
}
