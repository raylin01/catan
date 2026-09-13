import { useState } from 'react';
import RulesModal from './RulesModal';
import GameIcon from './GameIcon';
import './Lobby.css';

function Lobby({ onCreateGame, onJoinGame, error, setError }) {
  const [mode, setMode] = useState(null); // null, 'create', 'join'
  const [playerName, setPlayerName] = useState('');
  const [gameCode, setGameCode] = useState('');
  const [showRules, setShowRules] = useState(false);
  const [isExtended, setIsExtended] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    
    if (!playerName.trim()) {
      setError('Please enter your name');
      return;
    }
    
    if (mode === 'create') {
      onCreateGame(playerName.trim(), isExtended);
    } else if (mode === 'join') {
      if (!gameCode.trim()) {
        setError('Please enter a game code');
        return;
      }
      onJoinGame(gameCode.trim().toUpperCase(), playerName.trim());
    }
  };

  return (
    <div className="lobby">
      <div className="lobby-bg"></div>
      
      {/* Rules Button */}
      <button 
        className="rules-btn"
        onClick={() => setShowRules(true)}
      >
        <GameIcon name="overview" size={18} /> Rules
      </button>
      
      <div className="lobby-content">
        <div className="lobby-header">
          <h1>CATAN</h1>
          <p className="subtitle">Online Multiplayer</p>
        </div>

        {mode === null ? (
          <div className="lobby-menu fade-in">
            <button 
              className="menu-btn create-btn"
              onClick={() => setMode('create')}
            >
              <GameIcon className="btn-icon" name="settlement" size={22} />
              Create New Game
            </button>
            
            <button 
              className="menu-btn join-btn"
              onClick={() => setMode('join')}
            >
              <GameIcon className="btn-icon" name="players" size={22} />
              Join Game
            </button>
          </div>
        ) : (
          <form className="lobby-form fade-in" onSubmit={handleSubmit}>
            <button 
              type="button" 
              className="back-btn"
              onClick={() => { setMode(null); setError(null); }}
            >
              ← Back
            </button>
            
            <h2>{mode === 'create' ? 'Create New Game' : 'Join Game'}</h2>
            
            <div className="form-group">
              <label htmlFor="playerName">Your Name</label>
              <input
                id="playerName"
                type="text"
                value={playerName}
                onChange={(e) => setPlayerName(e.target.value)}
                placeholder="Enter your name"
                maxLength={20}
                autoFocus
              />
            </div>
            
            {mode === 'create' && (
              <>
                <div className="form-group game-mode-group">
                  <label>Game Mode</label>
                  <div className="game-mode-options">
                    <button
                      type="button"
                      className={`mode-option ${!isExtended ? 'active' : ''}`}
                      onClick={() => setIsExtended(false)}
                    >
                      <GameIcon className="mode-icon" name="dice" size={22} />
                      <span className="mode-label">Standard</span>
                      <span className="mode-desc">3–4 players</span>
                    </button>
                    <button
                      type="button"
                      className={`mode-option ${isExtended ? 'active' : ''}`}
                      onClick={() => setIsExtended(true)}
                    >
                      <GameIcon className="mode-icon" name="players" size={22} />
                      <span className="mode-label">Extended</span>
                      <span className="mode-desc">5–6 players</span>
                    </button>
                  </div>
                </div>
                
                {isExtended && <p className="mode-desc">The extra player takes an action phase after the production player.</p>}
              </>
            )}
            
            {mode === 'join' && (
              <div className="form-group">
                <label htmlFor="gameCode">Game Code</label>
                <input
                  id="gameCode"
                  type="text"
                  value={gameCode}
                  onChange={(e) => setGameCode(e.target.value.toUpperCase())}
                  placeholder="Enter 6-letter code"
                  maxLength={6}
                  className="code-input"
                />
              </div>
            )}
            
            {error && <div className="error-message">{error}</div>}
            
            <button type="submit" className="submit-btn">
              {mode === 'create' ? 'Create Game' : 'Join Game'}
            </button>
          </form>
        )}

        <div className="lobby-footer">
          <p>3–6 players · First to 10 victory points wins</p>
          <p className="credits">Created by <span className="creator-name">Viral Doshi</span></p>
        </div>
      </div>
      
      {/* Rules Modal */}
      {showRules && <RulesModal onClose={() => setShowRules(false)} />}
    </div>
  );
}

export default Lobby;
