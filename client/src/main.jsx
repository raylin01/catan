import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import './tabletop.css'
import './game-hud.css';
import './game-ui.css';
import {GamePresentation} from './presentation/GamePresentation'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <GamePresentation><App /></GamePresentation>
  </React.StrictMode>,
)
