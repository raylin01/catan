import GameIcon from '../components/GameIcon';
import ResourceCards from '../components/ResourceCards';
import CardArtwork from '../components/CardArtwork';
import './ReplayHand.css';

const RESOURCES = ['brick', 'lumber', 'wool', 'grain', 'ore'];
const DEV_CARD_INFO = {
  knight: { label: 'Knight', icon: 'knight', tone: 'umber' },
  victoryPoint: { label: 'Victory Point', icon: 'trophy', tone: 'gold' },
  roadBuilding: { label: 'Road Building', icon: 'road', tone: 'green' },
  yearOfPlenty: { label: 'Year of Plenty', icon: 'yearOfPlenty', tone: 'blue' },
  monopoly: { label: 'Monopoly', icon: 'monopoly', tone: 'purple' }
};

function cardCount(value) {
  if (typeof value === 'number') return value;
  return Array.isArray(value) ? value.length : 0;
}

function resourceCount(value) {
  if (typeof value === 'number') return value;
  if (!value || typeof value !== 'object') return 0;
  return Object.values(value).reduce((sum, count) => sum + (Number(count) || 0), 0);
}

function devCount(player) {
  return cardCount(player?.developmentCards) + cardCount(player?.newDevCards ?? player?.newDevelopmentCards);
}

function playerColor(player, index) {
  return player?.color || ['#d96855', '#4f94b5', '#dc9b51', '#63a892'][index % 4];
}

function ConcealedCards({ kind, count }) {
  const label = `${count} ${kind === 'resource' ? 'resource' : 'development'} card${count === 1 ? '' : 's'}`;
  return <div className={`replay-card-back replay-card-back--${kind}`} aria-label={label} title={label}>
    <GameIcon name={kind === 'resource' ? 'cards' : 'devCard'} size={22} />
    <strong>{count}</strong>
  </div>;
}

function ConcealedHand({ player, index }) {
  return <article className="replay-concealed-hand" style={{ '--replay-seat-color': playerColor(player, index) }}>
    <header><i aria-hidden="true" /><strong>{player?.name || `Player ${index + 1}`}</strong></header>
    <div className="replay-concealed-cards">
      <ConcealedCards kind="resource" count={resourceCount(player?.resources)} />
      <ConcealedCards kind="development" count={devCount(player)} />
    </div>
  </article>;
}

function groupedCards(cards, isNew) {
  if (!Array.isArray(cards)) return [];
  const grouped = new Map();
  cards.forEach(rawCard => {
    const type = typeof rawCard === 'string' ? rawCard : rawCard?.type;
    const key = `${type || 'unknown'}:${isNew ? 'new' : 'ready'}`;
    const current = grouped.get(key) || { type, isNew, count: 0 };
    current.count += 1;
    grouped.set(key, current);
  });
  return [...grouped.values()];
}

function DevelopmentCards({ player }) {
  const ready = player?.developmentCards;
  const fresh = player?.newDevCards ?? player?.newDevelopmentCards;
  const visible = Array.isArray(ready) && (fresh == null || Array.isArray(fresh));
  if (!visible) return <ConcealedCards kind="development" count={devCount(player)} />;
  const cards = [...groupedCards(ready, false), ...groupedCards(fresh || [], true)];
  if (!cards.length) return <div className="replay-no-dev-cards">No development cards</div>;
  return <div className="replay-development-cards" aria-label="Development cards">
    {cards.map(card => {
      const info = DEV_CARD_INFO[card.type] || { label: 'Development Card', icon: 'devCard', tone: 'blue' };
      return <div key={`${card.type || 'unknown'}-${card.isNew ? 'new' : 'ready'}`} className={`replay-development-card replay-development-card--${info.tone}`} title={`${info.label}${card.isNew ? ', bought this turn' : ''}`}>
        {card.isNew && <span className="replay-new-card-badge">New</span>}
        <div className="replay-development-art"><CardArtwork name={card.type} /></div>
        <span><GameIcon name={info.icon} size={11} />{info.label}</span>
        {card.count > 1 && <strong>×{card.count}</strong>}
      </div>;
    })}
  </div>;
}

function CompactVisibleHand({ player, index }) {
  const resourcesVisible = player?.resources && typeof player.resources === 'object' && !Array.isArray(player.resources);
  return <article className="replay-visible-hand replay-visible-hand--compact" data-replay-hand={player.id} style={{ '--replay-seat-color': playerColor(player, index) }}>
    <header><i aria-hidden="true" /><strong>{player?.name || `Player ${index + 1}`}</strong></header>
    <div className="replay-compact-hand-body">
      {resourcesVisible ? <div className="replay-compact-resources" aria-label="Resource cards">
        {RESOURCES.map(resource => <div key={resource} className={`replay-compact-resource replay-compact-resource--${resource} ${Number(player.resources[resource]) ? '' : 'is-empty'}`} title={`${resource}: ${Number(player.resources[resource]) || 0}`}>
          <CardArtwork name={resource} />
          <strong>{Number(player.resources[resource]) || 0}</strong>
        </div>)}
      </div> : <ConcealedCards kind="resource" count={resourceCount(player?.resources)} />}
      <DevelopmentCards player={player} />
    </div>
  </article>;
}

function ProminentHand({ player, index, onCardInfo }) {
  const resourcesVisible = player?.resources && typeof player.resources === 'object' && !Array.isArray(player.resources);
  return <article className="replay-visible-hand replay-visible-hand--primary" style={{ '--replay-seat-color': playerColor(player, index) }} data-own-hand>
    <header>
      <span><i aria-hidden="true" /><strong>{player?.name || `Player ${index + 1}`}'s hand</strong></span>
      <small>Recorded player view</small>
    </header>
    <div className="replay-primary-hand-body">
      {resourcesVisible ? <ResourceCards resources={player.resources} onRightClick={onCardInfo} /> : <ConcealedCards kind="resource" count={resourceCount(player?.resources)} />}
      <DevelopmentCards player={player} />
    </div>
  </article>;
}

export default function ReplayHand({ players = [], perspective = 'public', onCardInfo }) {
  if (!players.length) return null;
  if (perspective === 'omniscient') {
    return <section className="replay-table-hands replay-table-hands--omniscient" aria-label="All recorded hands">
      <div className="replay-table-hands-title"><strong>All hands</strong><span>Omniscient replay</span></div>
      <div className="replay-all-hands-grid" style={{ '--replay-seat-count': players.length }}>
        {players.map((player, index) => <CompactVisibleHand key={player.id || index} player={player} index={index} />)}
      </div>
    </section>;
  }

  const selectedIndex = players.findIndex(player => player.id === perspective);
  const selectedPlayer = selectedIndex >= 0 ? players[selectedIndex] : null;
  const hasPrivateHand = selectedPlayer?.resources && typeof selectedPlayer.resources === 'object' && !Array.isArray(selectedPlayer.resources);

  return <section className={`replay-table-hands ${hasPrivateHand ? 'replay-table-hands--seat' : 'replay-table-hands--public'}`} aria-label="Recorded hands">
    {hasPrivateHand && <ProminentHand player={selectedPlayer} index={selectedIndex} onCardInfo={onCardInfo} />}
    {!hasPrivateHand && <div className="replay-concealed-hands-row">
      {players.map((player, index) => (
        <ConcealedHand key={player.id || index} player={player} index={index} />
      ))}
    </div>}
  </section>;
}
