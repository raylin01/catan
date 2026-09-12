import { useEffect, useRef, useState } from 'react';
import './CardReveal.css';
import GameIcon from './GameIcon';
import CardArtwork from './CardArtwork';
import { useGamePresentation } from '../presentation/GamePresentation';

const DEV_CARD_INFO = {
  knight: {
    name: 'Knight',
    icon: 'knight',
    description: 'Move the robber to a new hex and steal a resource from an opponent with a building adjacent to that hex.',
    tone: 'umber'
  },
  victoryPoint: {
    name: 'Victory Point',
    icon: 'trophy',
    description: 'Worth 1 Victory Point! This is kept SECRET from other players until you win. Only you can see this VP.',
    tone: 'gold'
  },
  roadBuilding: {
    name: 'Road Building',
    icon: 'road',
    description: 'Build 2 roads immediately for free, following normal placement rules.',
    tone: 'green'
  },
  yearOfPlenty: {
    name: 'Year of Plenty',
    icon: 'yearOfPlenty',
    description: 'Take any 2 resource cards from the bank. They can be 2 of the same or different resources.',
    tone: 'blue'
  },
  monopoly: {
    name: 'Monopoly',
    icon: 'monopoly',
    description: 'Name 1 resource. All other players must give you ALL of their cards of that type.',
    tone: 'purple'
  }
};

function CardReveal({ cardType, onClose }) {
  const [isAnimating, setIsAnimating] = useState(true);
  const [isFlipped, setIsFlipped] = useState(false);
  const overlayRef = useRef(null);
  const soundedCard = useRef(null);
  const { playSound } = useGamePresentation();
  
  const cardInfo = DEV_CARD_INFO[cardType];
  
  useEffect(() => {
    const previous = document.activeElement;
    overlayRef.current?.focus();
    setIsAnimating(true);
    setIsFlipped(false);
    // Start flip animation after a short delay
    const flipTimer = setTimeout(() => {
      setIsFlipped(true);
      if (soundedCard.current !== cardType) {
        soundedCard.current = cardType;
        playSound('card');
      }
    }, 500);
    
    // End animation state
    const animTimer = setTimeout(() => {
      setIsAnimating(false);
    }, 1500);
    
    return () => {
      clearTimeout(flipTimer);
      clearTimeout(animTimer);
      if (previous?.isConnected) previous.focus();
    };
  }, [cardType, playSound]);
  
  if (!cardInfo) return null;
  
  return (
    <div
      className="card-reveal-overlay"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="card-reveal-title"
      tabIndex={-1}
      ref={overlayRef}
      onKeyDown={event => {
        if (event.key === 'Escape') onClose();
        if (event.key === 'Tab') {
          event.preventDefault();
          overlayRef.current?.querySelector('.card-reveal-close')?.focus();
        }
      }}
    >
      <div className="card-reveal-container" onClick={event => event.stopPropagation()}>
        <div className={`card-reveal ${isFlipped ? 'flipped' : ''} ${isAnimating ? 'animating' : ''}`}>
          {/* Card Back */}
          <div className="reveal-card-face reveal-card-back">
            <div className="reveal-card-back-design">
              <div className="reveal-card-back-pattern">
                <GameIcon className="reveal-card-back-icon" name="devCard" size={56} />
              </div>
              <div className="reveal-card-back-text">Development Card</div>
            </div>
          </div>
          
          {/* Card Front */}
          <div className={`reveal-card-face reveal-card-front reveal-card-front--${cardInfo.tone}`}>
            <div className="reveal-card-border">
              <div className="reveal-card-header">
                <GameIcon className="reveal-card-icon" name={cardInfo.icon} size={30} />
                <h2 id="card-reveal-title" className="reveal-card-title">{cardInfo.name}</h2>
              </div>
              
              <div className="reveal-card-body">
                <div className="reveal-card-art">
                  <CardArtwork name={cardType} decorative={false} />
                </div>
                <p className="reveal-card-description">{cardInfo.description}</p>
              </div>
              
              <div className="reveal-card-footer">
                <span className="reveal-card-type">Development Card</span>
              </div>
            </div>
          </div>
        </div>
        
        <button type="button" className="card-reveal-close" onClick={onClose}>Keep card</button>
      </div>
    </div>
  );
}

export default CardReveal;
