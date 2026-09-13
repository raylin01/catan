import { useState, useRef, useEffect } from 'react';
import './DiscardModal.css';
import CardArtwork from './CardArtwork';

const RESOURCES = ['brick', 'lumber', 'wool', 'grain', 'ore'];

function DiscardModal({ socket, player, cardsToDiscard, addNotification, paused }) {
  const [selected, setSelected] = useState({ brick: 0, lumber: 0, wool: 0, grain: 0, ore: 0 });

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const panel = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    panel.current?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);
  const trapFocus = event => {
    if (event.key !== 'Tab') return;
    const buttons = [...panel.current.querySelectorAll('button:not(:disabled)')];
    if (!buttons.length) { event.preventDefault(); return; }
    if (event.shiftKey && (document.activeElement === buttons[0] || document.activeElement === panel.current)) {
      event.preventDefault(); buttons.at(-1).focus();
    } else if (!event.shiftKey && document.activeElement === buttons.at(-1)) {
      event.preventDefault(); buttons[0].focus();
    }
  };
  const totalSelected = Object.values(selected).reduce((a, b) => a + b, 0);

  const updateSelected = (resource, delta) => {
    const newAmount = Math.max(0, Math.min(player.resources[resource], selected[resource] + delta));
    if (delta > 0 && totalSelected >= cardsToDiscard) return;
    setSelected({ ...selected, [resource]: newAmount });
  };

  const handleDiscard = () => {
    if (totalSelected !== cardsToDiscard) {
      addNotification(`Must discard exactly ${cardsToDiscard} cards`);
      return;
    }

    if (busy || paused) return;
    setBusy(true); setError('');
    socket.emit('discardCards', { resources: selected }, (response) => {
      setBusy(false);
      if (!response.success) {
        setError(response.error);
      }
    });
  };

  return (
    <div className="modal-overlay">
      <div className="discard-modal" role="dialog" aria-modal="true" aria-labelledby="discard-title" ref={panel} tabIndex={-1} onKeyDown={trapFocus}>
        <h2 id="discard-title">Discard cards</h2>
        <p className="discard-info">
          A seven was rolled. Choose <strong>{cardsToDiscard}</strong> cards to return to the bank.
        </p>
        
        {paused && <p>The room is paused.</p>}
        {error && <p role="alert">{error}</p>}
        <div className="discard-progress" role="progressbar" aria-label="Cards selected for discard" aria-valuemin={0} aria-valuemax={cardsToDiscard} aria-valuenow={totalSelected}>
          <div 
            className="progress-bar"
            style={{ width: `${(totalSelected / cardsToDiscard) * 100}%` }}
          />
          <span className="progress-text">
            {totalSelected} / {cardsToDiscard}
          </span>
        </div>

        <div className="resource-discard-list">
          {RESOURCES.map(r => {
            const available = player.resources[r];
            if (available === 0) return null;
            
            return (
              <div key={r} className={`resource-discard-row ${selected[r] ? 'is-selected' : ''}`}>
                <div className="discard-card-art"><CardArtwork name={r}/></div>
                <span className="resource-name">{r}</span>
                <span className="resource-available">{available} in hand</span>
                <div className="discard-controls">
                  <button 
                    onClick={() => updateSelected(r, -1)}
                    aria-label={`Keep one ${r}`}
                    disabled={busy || paused || selected[r] === 0}
                  >
                    −
                  </button>
                  <span className="discard-amount">{selected[r]}</span>
                  <button 
                    onClick={() => updateSelected(r, 1)}
                    aria-label={`Discard one ${r}`}
                    disabled={busy || paused || selected[r] >= available || totalSelected >= cardsToDiscard}
                  >
                    +
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <button 
          className="confirm-discard"
          onClick={handleDiscard}
          disabled={busy || paused || totalSelected !== cardsToDiscard}
        >
          {busy ? 'Discarding…' : `Discard ${totalSelected} cards`}
        </button>
      </div>
    </div>
  );
}

export default DiscardModal;
