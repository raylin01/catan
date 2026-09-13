import React from 'react';
import ReactDOM from 'react-dom/client';
import {GamePresentation} from '../presentation/GamePresentation';
import DesignPlayground from './DesignPlayground';
import '../room.css';
import '../index.css';
import '../tabletop.css';
import './design.css';
import '../game-hud.css';
import '../game-ui.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <GamePresentation>
      <DesignPlayground />
    </GamePresentation>
  </React.StrictMode>
);
