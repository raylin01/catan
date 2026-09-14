import React from 'react';
import {createRoot} from 'react-dom/client';
import {GamePresentation} from '../presentation/GamePresentation';
import DesignPlayground from './DesignPlayground';
import TradePrototype,{TradePrototypeProvider,TradePrototypeTools,useTradePrototypeEvents} from './TradePrototype';
import '../room.css';
import '../index.css';
import '../tabletop.css';
import './design.css';
import '../game-hud.css';
import '../game-ui.css';
function PrototypeGame(){const events=useTradePrototypeEvents();return <DesignPlayground tradePanelComponent={TradePrototype} extraEvents={events}/>;}
createRoot(document.getElementById('root')).render(<React.StrictMode><GamePresentation><TradePrototypeProvider><div className="trade-prototype-root"><TradePrototypeTools/><PrototypeGame/></div></TradePrototypeProvider></GamePresentation></React.StrictMode>);
