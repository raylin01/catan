import { useEffect, useMemo, useRef, useState } from 'react';
import './HexBoard.css';
import BoardViewport from './BoardViewport';
import {CARD_ARTWORK, TERRAIN_ARTWORK} from '../presentation/artwork';
import { useGamePresentation } from '../presentation/GamePresentation';
import { createBoardSnapshot, getBoardTransitions, motionDuration } from './boardMotion';

// Hex geometry constants - POINTY-TOP orientation
const HEX_SIZE = 50;
const BOARD_GUTTER = 62;
const COAST_NEIGHBORS = [[1, -1], [1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1]];
const EMPTY_ACTIVE_MOTION = { roads: new Set(), settlements: new Set(), cities: new Set(), robber: null };

const activateWithKeyboard = (event, callback) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  callback();
};

// Convert axial coordinates to pixel position (POINTY-TOP)
function axialToPixel(q, r) {
  const x = HEX_SIZE * Math.sqrt(3) * (q + r / 2);
  const y = HEX_SIZE * (3 / 2) * r;
  return { x, y };
}

// Get vertex position for POINTY-TOP hex
// Direction 0 = top, going clockwise: 1=upper-right, 2=lower-right, 3=bottom, 4=lower-left, 5=upper-left
function getVertexPosition(q, r, direction) {
  const center = axialToPixel(q, r);
  // For pointy-top, vertex 0 is at top (90 degrees from right = -90 from standard)
  // Angles: 0=90°, 1=30°, 2=-30°, 3=-90°, 4=-150°, 5=150°
  const angle = (90 - 60 * direction) * Math.PI / 180;
  return {
    x: center.x + HEX_SIZE * Math.cos(angle),
    y: center.y - HEX_SIZE * Math.sin(angle)
  };
}

// Generate hex path for POINTY-TOP orientation
function hexPath(cx, cy, size) {
  const points = [];
  for (let i = 0; i < 6; i++) {
    // Pointy-top: first vertex at top (90 degrees)
    const angle = (90 - 60 * i) * Math.PI / 180;
    points.push(`${cx + size * Math.cos(angle)},${cy - size * Math.sin(angle)}`);
  }
  return `M${points.join('L')}Z`;
}

// Number token colors based on probability
function getNumberColor(num) {
  if (num === 6 || num === 8) return '#d32f2f';
  return '#2c2c2c';
}

const TERRAIN_GRADIENTS = {
  forest: 'url(#forest-gradient)',
  hills: 'url(#hills-gradient)',
  pasture: 'url(#pasture-gradient)',
  fields: 'url(#fields-gradient)',
  mountains: 'url(#mountains-gradient)',
  desert: 'url(#desert-gradient)'
};

function terrainFill(terrain, fallback) {
  return TERRAIN_GRADIENTS[terrain] || fallback;
}

function probabilityDots(number) {
  return Math.max(1, 6 - Math.abs(7 - number));
}

function TerrainArtwork({terrain}) {
  return <image className="terrain-art" href={TERRAIN_ARTWORK[terrain]} x="-50" y="-50" width="100" height="100" preserveAspectRatio="xMidYMid slice" />;
}

// Create a position key for deduplication (rounded to avoid float issues)
function posKey(x, y) {
  return `${Math.round(x * 10)},${Math.round(y * 10)}`;
}

function HexBoard({ 
  hexes, 
  vertices, 
  edges, 
  robber,
  players,
  ports = [],
  selectedAction,
  isMyTurn,
  canBuildNow = false,
  myIndex,
  gamePhase,
  turnPhase,
  paused = false,
  onPlaceSettlement,
  onPlaceRoad,
  onUpgradeToCity,
  onHexClick,
  onHexRightClick,
  lastPlacedSettlement,
  freeRoads,
  legalActions = [],
  animate = true,
  resetKey,
  playbackRate = 1,
  cameraKey,
  cameraState
}) {
  const { playSound } = useGamePresentation();
  // Calculate board bounds
  const bounds = useMemo(() => {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    Object.values(hexes).forEach(hex => {
      const pos = axialToPixel(hex.q, hex.r);
      minX = Math.min(minX, pos.x - HEX_SIZE * 1.1);
      maxX = Math.max(maxX, pos.x + HEX_SIZE * 1.1);
      minY = Math.min(minY, pos.y - HEX_SIZE * 1.1);
      maxY = Math.max(maxY, pos.y + HEX_SIZE * 1.1);
    });
    return { minX, maxX, minY, maxY };
  }, [hexes]);

  const width = bounds.maxX - bounds.minX + BOARD_GUTTER * 2;
  const height = bounds.maxY - bounds.minY + BOARD_GUTTER * 2;
  const offsetX = -bounds.minX + BOARD_GUTTER;
  const offsetY = -bounds.minY + BOARD_GUTTER;

  // Check if vertex can be placed during setup or the acting player's main phase.
  const canPlaceAtVertex = (vKey) => {
    if (paused) return false;
    if (gamePhase === 'setup') {
      if (!isMyTurn) return false;
      if (selectedAction === 'settlement') return true;
    }
    if (gamePhase === 'playing') {
      if (!canBuildNow) return false;
      if (turnPhase === 'main' && selectedAction === 'settlement') return true;
    }
    return false;
  };

  // Check if vertex can be upgraded
  const canUpgradeVertex = (vKey, vertex) => {
    if (paused) return false;
    if (!canBuildNow) return false;
    if (gamePhase !== 'playing') return false;
    if (turnPhase !== 'main') return false;
    if (selectedAction !== 'city') return false;
    if (vertex.building !== 'settlement' || vertex.owner !== myIndex) return false;
    return true;
  };

  // Check if edge can be placed
  const canPlaceAtEdge = () => {
    if (paused) return false;
    if (gamePhase === 'setup') {
      if (!isMyTurn) return false;
      if (selectedAction === 'road') return true;
    }
    if (gamePhase === 'playing') {
      if (!canBuildNow) return false;
      if (turnPhase === 'main' && selectedAction === 'road') return true;
      if (freeRoads > 0 && selectedAction === 'road') return true;
    }
    return false;
  };

  // Can click on hex (for robber)
  const canChooseRobberDestination = gamePhase === 'playing' && !paused && turnPhase === 'robber' && isMyTurn;
  const legalRobberHexes = useMemo(() => new Set(
    legalActions
      .filter(action => action.type === 'moveRobber')
      .map(action => action.payload.hexKey)
  ), [legalActions]);

  // Parse vertex/edge keys
  const parseVertexKey = (key) => {
    const match = key.match(/v_(-?\d+)_(-?\d+)_(\d+)/);
    if (!match) return null;
    return { q: parseInt(match[1]), r: parseInt(match[2]), dir: parseInt(match[3]) };
  };

  const parseEdgeKey = (key) => {
    const match = key.match(/e_(-?\d+)_(-?\d+)_(\d+)/);
    if (!match) return null;
    return { q: parseInt(match[1]), r: parseInt(match[2]), dir: parseInt(match[3]) };
  };

  // Get edge endpoints - edge direction i connects vertex i to vertex (i+1)%6
  const getEdgeEndpoints = (q, r, dir) => {
    const center = axialToPixel(q, r);
    
    // Vertex angles for pointy-top hex (vertex 0 at top, going clockwise)
    const angles = [90, 30, -30, -90, -150, 150];
    
    const angle1 = angles[dir] * Math.PI / 180;
    const angle2 = angles[(dir + 1) % 6] * Math.PI / 180;
    
    return {
      v1: {
        x: center.x + HEX_SIZE * Math.cos(angle1),
        y: center.y - HEX_SIZE * Math.sin(angle1)
      },
      v2: {
        x: center.x + HEX_SIZE * Math.cos(angle2),
        y: center.y - HEX_SIZE * Math.sin(angle2)
      }
    };
  };

  // Collapse equivalent edge keys into one physical wooden road.
  const roads = useMemo(() => {
    const roadMap = new Map();
    
    Object.entries(edges).forEach(([key, edge]) => {
      if (!edge.road) return;
      
      const parsed = parseEdgeKey(key);
      if (!parsed) return;
      
      // Calculate the two vertex positions for this edge
      const { v1, v2 } = getEdgeEndpoints(parsed.q, parsed.r, parsed.dir);
      
      const id = [posKey(v1.x, v1.y), posKey(v2.x, v2.y)].sort().join('|');
      if (roadMap.has(id)) return;
      roadMap.set(id, {
        id,
        key,
        owner: edge.owner,
        v1,
        v2
      });
    });
    
    return [...roadMap.values()];
  }, [edges]);

  // Get unique edge positions for clickable areas (edges without roads)
  const clickableEdges = useMemo(() => {
    const edgeMap = new Map();
    
    // First, mark all positions that have roads
    const roadPositions = new Set();
    Object.entries(edges).forEach(([key, edge]) => {
      if (!edge.road) return;
      const parsed = parseEdgeKey(key);
      if (!parsed) return;
      const { v1, v2 } = getEdgeEndpoints(parsed.q, parsed.r, parsed.dir);
      const pk = [posKey(v1.x, v1.y), posKey(v2.x, v2.y)].sort().join('|');
      roadPositions.add(pk);
    });
    
    // Now add clickable areas for edges without roads
    Object.entries(edges).forEach(([key, edge]) => {
      const parsed = parseEdgeKey(key);
      if (!parsed) return;
      
      const { v1, v2 } = getEdgeEndpoints(parsed.q, parsed.r, parsed.dir);
      const pk = [posKey(v1.x, v1.y), posKey(v2.x, v2.y)].sort().join('|');
      
      // Skip if there's already a road at this position
      if (roadPositions.has(pk)) return;
      
      const existing = edgeMap.get(pk);
      if (existing) existing.keys.push(key);
      else edgeMap.set(pk, { id: pk, key, keys: [key], v1, v2 });
    });
    
    return [...edgeMap.values()];
  }, [edges]);

  // Get unique vertices - merge buildings from equivalent vertex keys
  const uniqueVertices = useMemo(() => {
    const seen = new Map();
    const result = [];
    
    Object.entries(vertices).forEach(([key, vertex]) => {
      const parsed = parseVertexKey(key);
      if (!parsed) return;
      
      // Check if hex exists
      if (!hexes[`${parsed.q},${parsed.r}`]) return;
      
      const pos = getVertexPosition(parsed.q, parsed.r, parsed.dir);
      const pk = posKey(pos.x, pos.y);
      
      if (!seen.has(pk)) {
        const entry = { id: pk, key, keys: [key], vertex, pos, parsed };
        seen.set(pk, entry);
        result.push(entry);
      } else {
        const existing = seen.get(pk);
        existing.keys.push(key);
        // Prefer the equivalent key carrying the actual building state.
        if (vertex.building && !existing.vertex.building) {
          const idx = result.findIndex(r => r.key === existing.key);
          if (idx !== -1) {
            existing.key = key;
            existing.vertex = vertex;
            existing.parsed = parsed;
            result[idx] = existing;
          }
        }
      }
    });
    
    return result;
  }, [vertices, hexes]);

  const coastEdges = useMemo(() => Object.values(hexes).flatMap((hex) => {
    return COAST_NEIGHBORS.flatMap(([dq, dr], direction) => {
      if (hexes[`${hex.q + dq},${hex.r + dr}`]) return [];
      const { v1, v2 } = getEdgeEndpoints(hex.q, hex.r, direction);
      return [{ id: `${hex.q},${hex.r}:${direction}`, v1, v2 }];
    });
  }), [hexes]);

  const snapshot = useMemo(
    () => createBoardSnapshot(roads, uniqueVertices, robber),
    [roads, uniqueVertices, robber]
  );
  const previousPresentation = useRef(null);
  const motionTimer = useRef(null);
  const [activeMotion, setActiveMotion] = useState(EMPTY_ACTIVE_MOTION);
  const resetChanged = previousPresentation.current && previousPresentation.current.resetKey !== resetKey;
  const transitions = animate && !resetChanged
    ? getBoardTransitions(previousPresentation.current?.snapshot, snapshot)
    : getBoardTransitions(null, snapshot);

  useEffect(() => {
    previousPresentation.current = { resetKey, snapshot };
  }, [resetKey, snapshot]);

  const pieceTransitionKey = [
    ...transitions.roads,
    ...transitions.settlements,
    ...transitions.cities
  ].sort().join(',');
  const pieceMotionDuration = motionDuration(playbackRate, 520);
  const robberMotionDuration = motionDuration(playbackRate, 440);

  useEffect(() => {
    if (!animate || resetChanged) {
      clearTimeout(motionTimer.current);
      motionTimer.current = null;
      setActiveMotion(EMPTY_ACTIVE_MOTION);
      return;
    }
    if (!pieceTransitionKey && !transitions.robber) return;

    setActiveMotion(current => ({
      roads: new Set([...current.roads, ...transitions.roads]),
      settlements: new Set([...current.settlements, ...transitions.settlements]),
      cities: new Set([...current.cities, ...transitions.cities]),
      robber: transitions.robber ? robber : current.robber
    }));
    if (pieceTransitionKey) playSound('piece');
    if (transitions.robber) playSound('robber');
    clearTimeout(motionTimer.current);
    motionTimer.current = setTimeout(() => {
      motionTimer.current = null;
      setActiveMotion(EMPTY_ACTIVE_MOTION);
    }, Math.max(Number.parseInt(pieceMotionDuration), Number.parseInt(robberMotionDuration)) + 40);
  }, [animate, pieceMotionDuration, pieceTransitionKey, playSound, resetChanged, robber, robberMotionDuration, transitions.cities, transitions.roads, transitions.robber, transitions.settlements]);

  useEffect(() => () => clearTimeout(motionTimer.current), []);

  const showEdgePlaceholders = canPlaceAtEdge();

  return (
    <BoardViewport cameraKey={cameraKey} cameraState={cameraState}>
    <svg
      className="hex-board"
      viewBox={`0 0 ${width} ${height}`}
      style={{
        maxWidth: '100%',
        maxHeight: '100%',
        '--piece-motion-duration': pieceMotionDuration,
        '--robber-motion-duration': robberMotionDuration
      }}
      role="group"
      aria-label="Catan game board"
    >
      <defs>
        <linearGradient id="ocean-gradient" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3a6c82" />
          <stop offset=".48" stopColor="#457d91" />
          <stop offset="1" stopColor="#2c566b" />
        </linearGradient>
        <radialGradient id="ocean-glow" cx="50%" cy="42%" r="66%">
          <stop offset="0" stopColor="#62b5bd" stopOpacity=".34" />
          <stop offset=".7" stopColor="#1b6678" stopOpacity=".08" />
          <stop offset="1" stopColor="#062838" stopOpacity=".54" />
        </radialGradient>
        <pattern id="water-lines" patternUnits="userSpaceOnUse" width="34" height="18">
          <path d="M-9 9 Q0 2 9 9 T27 9 T45 9" fill="none" stroke="#a9e0dc" strokeWidth="1.1" opacity=".16" />
        </pattern>
        <pattern id="paint-grain" patternUnits="userSpaceOnUse" width="17" height="19">
          <path d="M1 4 Q5 1 9 3 M9 14 Q13 11 17 13" fill="none" stroke="#fff8d8" strokeWidth="1.1" opacity=".16" />
          <circle cx="4" cy="13" r="1.1" fill="#183528" opacity=".13" />
          <circle cx="14" cy="6" r=".8" fill="#51321e" opacity=".13" />
        </pattern>
        <linearGradient id="forest-gradient" x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#477f50" /><stop offset=".52" stopColor="#2d6949" /><stop offset="1" stopColor="#19473b" />
        </linearGradient>
        <linearGradient id="hills-gradient" x1="0" y1="0" x2=".8" y2="1">
          <stop stopColor="#e58b51" /><stop offset=".55" stopColor="#c45e38" /><stop offset="1" stopColor="#8d3c2b" />
        </linearGradient>
        <linearGradient id="pasture-gradient" x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#b3ce72" /><stop offset=".58" stopColor="#79ad57" /><stop offset="1" stopColor="#508b49" />
        </linearGradient>
        <linearGradient id="fields-gradient" x1="0" y1="0" x2=".75" y2="1">
          <stop stopColor="#f2d675" /><stop offset=".5" stopColor="#d4a63f" /><stop offset="1" stopColor="#a96e22" />
        </linearGradient>
        <linearGradient id="mountains-gradient" x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#9da9a5" /><stop offset=".5" stopColor="#687a7d" /><stop offset="1" stopColor="#374e56" />
        </linearGradient>
        <linearGradient id="desert-gradient" x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#f2d69d" /><stop offset=".58" stopColor="#dcba76" /><stop offset="1" stopColor="#bd8b4e" />
        </linearGradient>
        <radialGradient id="token-face" cx="34%" cy="25%" r="80%">
          <stop stopColor="#fffdf2" /><stop offset=".65" stopColor="#f4e1b5" /><stop offset="1" stopColor="#d5b57e" />
        </radialGradient>
        <linearGradient id="token-rim" x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#fff2c8" /><stop offset=".42" stopColor="#a56f35" /><stop offset="1" stopColor="#59391f" />
        </linearGradient>
        <linearGradient id="wood-gradient" x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#b97b42" /><stop offset=".48" stopColor="#754526" /><stop offset="1" stopColor="#432718" />
        </linearGradient>
        <filter id="board-shadow" x="-20%" y="-20%" width="140%" height="150%">
          <feDropShadow dx="0" dy="6" stdDeviation="7" floodColor="#031e29" floodOpacity=".55" />
        </filter>
        <filter id="hex-shadow" x="-25%" y="-25%" width="150%" height="160%">
          <feDropShadow dx="0" dy="1" stdDeviation=".6" floodColor="#102a25" floodOpacity=".4" />
        </filter>
        <filter id="token-shadow" x="-45%" y="-45%" width="190%" height="200%">
          <feDropShadow dx="0" dy="1.2" stdDeviation=".75" floodColor="#28170d" floodOpacity=".35" />
        </filter>
        <filter id="building-shadow" x="-70%" y="-70%" width="240%" height="250%">
          <feDropShadow dx="1" dy="2.4" stdDeviation="1.4" floodColor="#07141a" floodOpacity=".72" />
        </filter>
        <filter id="piece-contact-shadow" x="-80%" y="-80%" width="260%" height="280%">
          <feGaussianBlur stdDeviation="1.8" />
        </filter>
        {Object.keys(hexes).map((key) => (
          <clipPath id={`tile-clip-${key.replace(',', '-')}`} key={`clip-${key}`}>
            <path d={hexPath(0, 0, HEX_SIZE - 2)} />
          </clipPath>
        ))}
      </defs>
      
      <g transform={`translate(${offsetX}, ${offsetY})`}>
        {/* Framed ocean and the shallow shelf beneath the island. */}
        <path className="ocean-frame" d={`M${-width*.29},${-height/2+3} L${width*.29},${-height/2+3} L${width/2-3},0 L${width*.29},${height/2-3} L${-width*.29},${height/2-3} L${-width/2+3},0 Z`} fill="url(#ocean-gradient)" filter="url(#board-shadow)" />
        <g className="island-shelf">
          {Object.values(hexes).map((hex) => {
            const pos = axialToPixel(hex.q, hex.r);
            return <path key={`shelf-${hex.q}-${hex.r}`} d={hexPath(pos.x, pos.y, HEX_SIZE + 4)} />;
          })}
        </g>
        <g className="coastline" aria-hidden="true">
          {coastEdges.map(({ id, v1, v2 }) => (
            <g key={id}>
              <line className="coastline-sand" x1={v1.x} y1={v1.y} x2={v2.x} y2={v2.y} />
              <line className="coastline-foam" x1={v1.x} y1={v1.y} x2={v2.x} y2={v2.y} />
            </g>
          ))}
        </g>
        
        {/* Hexes */}
        {Object.entries(hexes).map(([key, hex]) => {
          const pos = axialToPixel(hex.q, hex.r);
          const isRobberHere = robber === key;
          const isLegalRobberDestination = canChooseRobberDestination && legalRobberHexes.has(key);
          const clipId = `tile-clip-${key.replace(',', '-')}`;
          const dots = probabilityDots(hex.number);
          
          return (
            <g 
              key={key} 
              className={`hex ${isLegalRobberDestination ? 'clickable legal-robber-target' : ''} ${isRobberHere ? 'has-robber' : ''}`}
              role={isLegalRobberDestination ? 'button' : undefined}
              tabIndex={isLegalRobberDestination ? 0 : undefined}
              aria-label={isLegalRobberDestination ? `Move robber to ${hex.terrain} ${hex.number || 'desert'}` : undefined}
              onKeyDown={event => {
                if (isLegalRobberDestination) activateWithKeyboard(event, () => onHexClick(key));
              }}
              onClick={() => isLegalRobberDestination && onHexClick(key)}
              onContextMenu={(e) => onHexRightClick && onHexRightClick(e, hex)}
            >
              <path
                className="terrain-tile"
                d={hexPath(pos.x, pos.y, HEX_SIZE)}
                fill={terrainFill(hex.terrain, hex.color)}
                stroke="#6c6755"
                strokeWidth="1.5"
                filter="url(#hex-shadow)"
              />
              <g clipPath={`url(#${clipId})`} transform={`translate(${pos.x} ${pos.y})`}>
                <TerrainArtwork terrain={hex.terrain} />
              </g>
              <path
                d={hexPath(pos.x, pos.y, HEX_SIZE - 4)}
                fill="none"
                stroke="rgba(249,242,218,0.32)"
                strokeWidth=".65"
                className="tile-bevel"
              />
              
              {isLegalRobberDestination && <path className="robber-choice-ring" d={hexPath(pos.x, pos.y, HEX_SIZE - 2)} />}
              {/* Number token */}
              {hex.number && (
                <g className={`number-token ${hex.number === 6 || hex.number === 8 ? 'number-token--hot' : ''}`} filter="url(#token-shadow)">
                  <circle cx={pos.x} cy={pos.y + .8} r="17" fill="#a1967b" />
                  <circle cx={pos.x} cy={pos.y} r="16.5" fill="#f2e7c9" stroke="#b9ab8b" strokeWidth=".6" />
                  <text
                    x={pos.x}
                    y={pos.y + 3.5}
                    textAnchor="middle"
                    fontSize="15"
                    fontWeight="800"
                    fontFamily="Georgia, serif"
                    fill={getNumberColor(hex.number)}
                  >
                    {hex.number}
                  </text>
                  <g fill={getNumberColor(hex.number)}>
                    {Array.from({ length: dots }, (_, index) => (
                      <circle key={index} cx={pos.x + (index - (dots - 1) / 2) * 3.1} cy={pos.y + 10} r="1.05" />
                    ))}
                  </g>
                </g>
              )}
              
              {/* Robber */}
              {isRobberHere && (
                <g className={`robber ${transitions.robber || activeMotion.robber === key ? 'is-new' : ''}`} transform={`translate(${pos.x} ${pos.y - 2})`} filter="url(#building-shadow)">
                  <title>Robber</title>
                  <ellipse cx="0" cy="18" rx="12" ry="4" fill="#061217" opacity=".5" />
                  <path d="M-10 15 Q-9 3 -5 -3 Q-9 -8 -7 -14 Q-5 -21 0 -21 Q5 -21 7 -14 Q9 -8 5 -3 Q9 3 10 15Z" fill="#152329" stroke="#080e11" strokeWidth="2" />
                  <path d="M-3 -17 Q0 -20 3 -17 M-5 0 Q-1 -3 2 -1" fill="none" stroke="#516068" strokeWidth="1.3" strokeLinecap="round" opacity=".75" />
                </g>
              )}
            </g>
          );
        })}

        {/* Legal road previews remain fully governed by legalActions. */}
        {showEdgePlaceholders && clickableEdges.map(({ id, keys, v1, v2 }) => {
          const legalAction = legalActions.find(action => (
            action.type === 'placeRoad' && keys.includes(action.payload.edgeKey)
          ));
          if (!legalAction) return null;
          const legalKey = legalAction.payload.edgeKey;
          return (
            <g
              key={`click-${id}`}
              className="edge-placeholder"
              role="button"
              tabIndex={0}
              aria-label="Place road here"
              onClick={() => onPlaceRoad(legalKey)}
              onKeyDown={event => activateWithKeyboard(event, () => onPlaceRoad(legalKey))}
            >
              <rect className="edge-placeholder-hit" x="-10" y="-10"
                width={Math.hypot(v2.x - v1.x, v2.y - v1.y) + 20} height="20" rx="10"
                transform={`translate(${v1.x} ${v1.y}) rotate(${Math.atan2(v2.y - v1.y, v2.x - v1.x) * 180 / Math.PI})`} />
              <line className="edge-choice-aura" x1={v1.x} y1={v1.y} x2={v2.x} y2={v2.y} />
              <line className="edge-placeholder-halo" x1={v1.x} y1={v1.y} x2={v2.x} y2={v2.y} />
              <line className="edge-placeholder-piece" x1={v1.x} y1={v1.y} x2={v2.x} y2={v2.y} />
            </g>
          );
        })}

        {/* Roads - rendered separately from clickable areas */}
        {roads.map(({ id, owner, v1, v2 }) => (
          <g key={`road-${id}`} className={`road ${transitions.roads.has(id) || activeMotion.roads.has(id) ? 'is-new' : ''}`}>
            <line
              className="piece-contact-shadow"
              x1={v1.x + 1.5}
              y1={v1.y + 3.5}
              x2={v2.x + 1.5}
              y2={v2.y + 3.5}
              stroke="#061217"
              strokeOpacity=".52"
              strokeWidth="10.5"
              strokeLinecap="round"
              filter="url(#piece-contact-shadow)"
            />
            <line
              className="road-edge"
              x1={v1.x}
              y1={v1.y}
              x2={v2.x}
              y2={v2.y}
            />
            <line
              className="road-face"
              x1={v1.x}
              y1={v1.y}
              x2={v2.x}
              y2={v2.y}
              stroke={players[owner]?.color || '#ff0000'}
            />
            <line
              className="road-highlight"
              x1={v1.x}
              y1={v1.y - .8}
              x2={v2.x}
              y2={v2.y - .8}
            />
            <title>{`${players[owner]?.name || `Player ${owner + 1}`} road`}</title>
          </g>
        ))}

        {/* Vertices (settlements/cities) */}
        {uniqueVertices.map(({ id, key, keys, vertex, pos }) => {
          const canPlace = canPlaceAtVertex(key) && !vertex.building;
          const settlementAction = canPlace && legalActions.find(action => (
            action.type === 'placeSettlement' && keys.includes(action.payload.vertexKey)
          ));
          const cityAction = canUpgradeVertex(key, vertex) && legalActions.find(action => (
            action.type === 'upgradeToCity' && keys.includes(action.payload.vertexKey)
          ));
          const canUpgrade = Boolean(cityAction);
          const owner = players[vertex.owner];
          
          return (
            <g key={id} className="vertex-group">
              {/* Settlement */}
              {vertex.building === 'settlement' && (
                <g 
                  className={`settlement ${canUpgrade ? 'upgradeable' : ''} ${transitions.settlements.has(id) || activeMotion.settlements.has(id) ? 'is-new' : ''}`}
                  role={canUpgrade ? 'button' : undefined}
                  tabIndex={canUpgrade ? 0 : undefined}
                  aria-label={canUpgrade ? `Upgrade ${owner?.name || 'your'} settlement to a city` : undefined}
                  onClick={() => canUpgrade && onUpgradeToCity(cityAction.payload.vertexKey)}
                  onKeyDown={event => canUpgrade && activateWithKeyboard(event, () => onUpgradeToCity(cityAction.payload.vertexKey))}
                >
                  {canUpgrade && <>
                    <circle className="vertex-placeholder-hit" cx={pos.x} cy={pos.y} r="20" />
                    <circle className="choice-aura" cx={pos.x} cy={pos.y} r="21" />
                    <circle className="upgrade-choice-ring" cx={pos.x} cy={pos.y} r="17" />
                    <path className="upgrade-chevron" d={`M${pos.x - 5} ${pos.y - 22} L${pos.x} ${pos.y - 27} L${pos.x + 5} ${pos.y - 22}`} />
                  </>}
                  <ellipse className="building-contact-shadow" cx={pos.x + 1.5} cy={pos.y + 10} rx="12" ry="4" />
                  <path
                    className="building-side"
                    d={`M${pos.x - 9} ${pos.y + 4} L${pos.x + 9} ${pos.y + 4} L${pos.x + 7} ${pos.y + 10} L${pos.x - 7} ${pos.y + 10}Z`}
                    fill={owner?.color || '#c44'}
                  />
                  <path
                    className="building-face"
                    d={`M${pos.x - 10} ${pos.y - 2} L${pos.x} ${pos.y - 12} L${pos.x + 10} ${pos.y - 2} L${pos.x + 8} ${pos.y - 2} L${pos.x + 8} ${pos.y + 8} L${pos.x - 8} ${pos.y + 8} L${pos.x - 8} ${pos.y - 2} Z`}
                    fill={owner?.color || '#c44'}
                  />
                  <path className="building-highlight" d={`M${pos.x - 7} ${pos.y - 1} L${pos.x} ${pos.y - 8} L${pos.x + 7} ${pos.y - 1} M${pos.x - 6} ${pos.y + 1} V${pos.y + 5}`} />
                  <rect className="building-door" x={pos.x - 2} y={pos.y + 2} width="4" height="6" rx=".7" />
                  {canUpgrade && <g className="upgrade-preview" transform={`translate(${pos.x} ${pos.y - 7})`}>
                    <path d="M-13 9V-3L-7-9L-1-3V-14H7V-7H12V9Z" fill={owner?.color || '#c44'} />
                    <path d="M-9 0L-7-3L-4 0M2-10H5M9-3V4" className="upgrade-preview-detail" />
                  </g>}
                  <title>{`${owner?.name || `Player ${vertex.owner + 1}`} settlement${canUpgrade ? '; upgrade available' : ''}`}</title>
                </g>
              )}
              
              {/* City */}
              {vertex.building === 'city' && (
                <g className={`city ${transitions.cities.has(id) || activeMotion.cities.has(id) ? 'is-new' : ''}`}>
                  <ellipse className="building-contact-shadow" cx={pos.x + 1.5} cy={pos.y + 11} rx="15" ry="4.5" />
                  <path
                    className="building-side"
                    d={`M${pos.x - 13} ${pos.y + 5} H${pos.x + 12} L${pos.x + 9} ${pos.y + 11} H${pos.x - 10}Z`}
                    fill={owner?.color || '#c44'}
                  />
                  <path
                    className="building-face"
                    d={`M${pos.x - 13} ${pos.y + 9} V${pos.y - 3} L${pos.x - 7} ${pos.y - 9} L${pos.x - 1} ${pos.y - 3} V${pos.y - 14} H${pos.x + 7} V${pos.y - 7} H${pos.x + 12} V${pos.y + 9}Z`}
                    fill={owner?.color || '#c44'}
                  />
                  <path className="building-highlight" d={`M${pos.x - 10} ${pos.y - 2} L${pos.x - 7} ${pos.y - 5} L${pos.x - 3} ${pos.y - 1} M${pos.x + 2} ${pos.y - 11} H${pos.x + 5} M${pos.x + 9} ${pos.y - 4} V${pos.y + 4}`} />
                  <g className="building-windows">
                    <rect x={pos.x - 9} y={pos.y + 3} width="3" height="6" rx=".5" />
                    <rect x={pos.x + 3} y={pos.y - 4} width="3" height="4" rx=".5" />
                    <rect x={pos.x + 7} y={pos.y + 3} width="3" height="4" rx=".5" />
                  </g>
                  <title>{`${owner?.name || `Player ${vertex.owner + 1}`} city`}</title>
                </g>
              )}
              
              {/* Clickable placeholder for placing settlements */}
              {settlementAction && (
                <g
                  className="vertex-placeholder"
                  role="button"
                  tabIndex={0}
                  aria-label="Place settlement here"
                  onClick={() => onPlaceSettlement(settlementAction.payload.vertexKey)}
                  onKeyDown={event => activateWithKeyboard(event, () => onPlaceSettlement(settlementAction.payload.vertexKey))}
                >
                  <circle className="vertex-placeholder-hit" cx={pos.x} cy={pos.y} r="18" />
                  <circle className="choice-aura" cx={pos.x} cy={pos.y} r="20" />
                  <circle className="vertex-placeholder-halo" cx={pos.x} cy={pos.y} r="11" />
                  <path className="vertex-placeholder-piece" d={`M${pos.x - 8} ${pos.y + 7} V${pos.y - 1} L${pos.x} ${pos.y - 9} L${pos.x + 8} ${pos.y - 1} V${pos.y + 7}Z`} />
                </g>
              )}
            </g>
          );
        })}

        {/* Ports */}
        {ports.map((port) => {
          // Get positions of the two vertices this port connects to
          const v1Key = port.vertices[0];
          const v2Key = port.vertices[1];
          
          const v1Match = v1Key.match(/v_(-?\d+)_(-?\d+)_(\d+)/);
          const v2Match = v2Key.match(/v_(-?\d+)_(-?\d+)_(\d+)/);
          
          if (!v1Match || !v2Match) return null;
          
          const v1Pos = getVertexPosition(
            parseInt(v1Match[1]), 
            parseInt(v1Match[2]), 
            parseInt(v1Match[3])
          );
          const v2Pos = getVertexPosition(
            parseInt(v2Match[1]), 
            parseInt(v2Match[2]), 
            parseInt(v2Match[3])
          );
          
          // Calculate midpoint of the edge (center of hexagon edge near port)
          const midX = (v1Pos.x + v2Pos.x) / 2;
          const midY = (v1Pos.y + v2Pos.y) / 2;
          
          // Calculate outward direction (perpendicular to edge, pointing away from board center)
          // Edge vector
          const edgeX = v2Pos.x - v1Pos.x;
          const edgeY = v2Pos.y - v1Pos.y;
          // Perpendicular vector (rotate 90 degrees)
          let perpX = -edgeY;
          let perpY = edgeX;
          // Normalize
          const perpLen = Math.sqrt(perpX * perpX + perpY * perpY);
          perpX /= perpLen;
          perpY /= perpLen;
          // Make sure it points outward (away from center 0,0)
          const dotProduct = perpX * midX + perpY * midY;
          if (dotProduct < 0) {
            perpX = -perpX;
            perpY = -perpY;
          }
          // Position port at a good distance from the edge center
          const portX = midX + perpX * 28;
          const portY = midY + perpY * 28;
          
          return (
            <g key={port.id} className="port">
              <path
                d={`M${v1Pos.x} ${v1Pos.y} L${portX} ${portY} L${v2Pos.x} ${v2Pos.y}`}
                fill="none"
                stroke="#3a2619"
                strokeWidth="4.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity=".76"
              />
              <line
                x1={portX}
                y1={portY}
                x2={v1Pos.x}
                y2={v1Pos.y}
                stroke="#e6bd74"
                strokeWidth="1.25"
                opacity=".82"
              />
              <line
                x1={portX}
                y1={portY}
                x2={v2Pos.x}
                y2={v2Pos.y}
                stroke="#e6bd74"
                strokeWidth="1.25"
                opacity=".82"
              />
              
              <g transform={`translate(${portX}, ${portY})`} filter="url(#token-shadow)">
                <rect x="-13" y="-13" width="26" height="27" rx="2" fill="#eee4c9" stroke="#b1a686" strokeWidth="1" />
                {port.resource ? <image href={CARD_ARTWORK[port.resource]} x="-10.5" y="-10.5" width="21" height="22" preserveAspectRatio="xMidYMid slice" /> : <path d="M-8 5h16L5 9H-5ZM0-9V4M-1-8-8 2h7ZM2-6l6 8H2Z" fill="#345360" stroke="#345360" strokeWidth=".7" />}
                <g className="port-ratio">
                  <rect x="-11" y="16" width="22" height="11" rx="2" />
                  <text textAnchor="middle" y="24" fontSize="8" fontWeight="800">{port.ratio}:1</text>
                </g>
              </g>
            </g>
          );
        })}
      </g>
    </svg>
    </BoardViewport>
  );
}

export default HexBoard;
