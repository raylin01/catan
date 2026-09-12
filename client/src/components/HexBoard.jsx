import { useMemo } from 'react';
import './HexBoard.css';
import { GameIconSymbol } from './GameIcon';

// Hex geometry constants - POINTY-TOP orientation
const HEX_SIZE = 50;

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

// Get the local SVG icon name for a terrain type.
function getTerrainIcon(terrain) {
  return terrain || 'unknown';
}

function getPortIcon(port) {
  return port.resource || 'port';
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

function TerrainArtwork({ terrain }) {
  if (terrain === 'forest') {
    return (
      <g className="terrain-art terrain-art--forest">
        <path d="M-48 21 Q-25 -2 -2 18 T48 13 V52 H-48Z" fill="#184f3d" opacity=".72" />
        <path d="M-48 31 Q-19 8 8 31 T48 22 V52 H-48Z" fill="#123d33" opacity=".82" />
        {[-35, -25, -13, 18, 30, 39].map((x, index) => {
          const y = index % 2 ? 11 : 21;
          const scale = index % 3 === 0 ? 1.08 : .82;
          return (
            <g key={x} transform={`translate(${x} ${y}) scale(${scale})`}>
              <path d="M0 -22 L-9 -5 H-5 L-13 9 H13 L5 -5 H9Z" fill="#0d342b" />
              <path d="M0 -19 L-6 -6 H-2 L-9 6 H1Z" fill="#2d7551" opacity=".72" />
              <path d="M-1 8 H3 V18 H-1Z" fill="#60402a" />
            </g>
          );
        })}
      </g>
    );
  }

  if (terrain === 'hills') {
    return (
      <g className="terrain-art terrain-art--hills">
        <path d="M-52 16 Q-31 -14 -6 15 Q17 -20 51 15 V52 H-52Z" fill="#bb5031" opacity=".82" />
        <path d="M-52 28 Q-26 3 3 25 Q29 5 52 24 V52 H-52Z" fill="#883826" opacity=".65" />
        <path d="M-39 26 Q-25 15 -12 25 M12 19 Q28 8 43 21" fill="none" stroke="#f7b171" strokeWidth="2" opacity=".42" />
        <g fill="#71301f" opacity=".8">
          <rect x="-42" y="32" width="14" height="6" rx="1" />
          <rect x="-25" y="32" width="14" height="6" rx="1" />
          <rect x="-34" y="40" width="14" height="6" rx="1" />
          <rect x="22" y="34" width="14" height="6" rx="1" />
        </g>
      </g>
    );
  }

  if (terrain === 'pasture') {
    return (
      <g className="terrain-art terrain-art--pasture">
        <path d="M-52 14 Q-25 -9 3 15 T52 10 V52 H-52Z" fill="#72a94e" opacity=".6" />
        <path d="M-52 30 Q-19 11 9 31 T52 25 V52 H-52Z" fill="#4e8a45" opacity=".48" />
        <path d="M-42 34 Q-38 27 -35 34 M-35 36 Q-31 27 -28 36 M27 32 Q31 23 34 32 M35 35 Q39 27 42 35" fill="none" stroke="#326f3c" strokeWidth="1.5" strokeLinecap="round" />
        <g transform="translate(-28 17)" fill="#fff9e7" stroke="#665947" strokeWidth=".8">
          <ellipse rx="7" ry="4.4" />
          <circle cx="6.5" cy="-1" r="2.6" />
          <path d="M-3 3 V8 M3 3 V8" fill="none" />
        </g>
        <g transform="translate(31 11) scale(.78)" fill="#fff9e7" stroke="#665947" strokeWidth=".9">
          <ellipse rx="7" ry="4.4" />
          <circle cx="6.5" cy="-1" r="2.6" />
          <path d="M-3 3 V8 M3 3 V8" fill="none" />
        </g>
      </g>
    );
  }

  if (terrain === 'fields') {
    return (
      <g className="terrain-art terrain-art--fields">
        <path d="M-52 9 Q-18 -6 12 12 T52 8 V52 H-52Z" fill="#d79d27" opacity=".55" />
        <path d="M-52 26 Q-17 6 18 27 T52 20 V52 H-52Z" fill="#b97c1e" opacity=".5" />
        {[-39, -30, -21, 22, 31, 40].map((x, index) => (
          <g key={x} transform={`translate(${x} ${index % 2 ? 18 : 12})`} stroke="#fff0a3" strokeWidth="1.25" strokeLinecap="round" opacity=".82">
            <path d="M0 25 V-5 M0 3 L-5 -1 M0 8 L5 3 M0 13 L-5 8 M0 18 L5 13" fill="none" />
          </g>
        ))}
        <path d="M-49 38 Q-17 19 9 39 T50 33" fill="none" stroke="#f4cd58" strokeWidth="2" opacity=".5" />
      </g>
    );
  }

  if (terrain === 'mountains') {
    return (
      <g className="terrain-art terrain-art--mountains">
        <path d="M-53 33 L-31 -3 L-15 17 L5 -24 L28 12 L40 -6 L55 31 V52 H-53Z" fill="#596c72" />
        <path d="M-15 17 L5 -24 L11 -2 L28 12 L9 3 Z" fill="#354b54" opacity=".88" />
        <path d="M-4 -9 L5 -24 L14 -9 L8 -12 L4 -7 L1 -13Z" fill="#eef3ec" />
        <path d="M-37 8 L-31 -3 L-23 9 L-29 6 L-32 11Z" fill="#e7eee9" opacity=".9" />
        <path d="M31 8 L40 -6 L48 10 L41 6 L38 12Z" fill="#eef3ec" opacity=".85" />
        <path d="M-50 37 L-22 20 L-10 36 L17 14 L52 38 V52 H-52Z" fill="#2e4148" opacity=".64" />
      </g>
    );
  }

  return (
    <g className="terrain-art terrain-art--desert">
      <path d="M-54 19 Q-29 -5 -4 20 Q19 40 54 10 V52 H-54Z" fill="#d6ad63" opacity=".62" />
      <path d="M-54 34 Q-25 13 4 35 Q27 48 54 28 V52 H-54Z" fill="#bc8c49" opacity=".42" />
      <path d="M-42 24 Q-18 7 2 24 M10 37 Q30 22 48 31" fill="none" stroke="#f5d58c" strokeWidth="2" opacity=".64" />
      <g transform="translate(31 14)" fill="none" stroke="#3e7655" strokeWidth="3" strokeLinecap="round">
        <path d="M0 21 V-5 M0 5 C8 5 8 0 8 -4 M0 11 C-7 11 -7 7 -7 3" />
      </g>
      <ellipse cx="-29" cy="34" rx="11" ry="3.5" fill="#5d9674" opacity=".72" />
    </g>
  );
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
  legalActions = []
}) {
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

  const width = bounds.maxX - bounds.minX + 60;
  const height = bounds.maxY - bounds.minY + 60;
  const offsetX = -bounds.minX + 30;
  const offsetY = -bounds.minY + 30;

  // Check if vertex can be placed
  // Use canBuildNow which includes special building phase
  const canPlaceAtVertex = (vKey) => {
    if (gamePhase === 'setup') {
      if (!isMyTurn) return false;
      if (selectedAction === 'settlement') return true;
    }
    if (gamePhase === 'playing') {
      if (!canBuildNow) return false;
      if ((turnPhase === 'main' || turnPhase === 'specialBuild') && selectedAction === 'settlement') return true;
    }
    return false;
  };

  // Check if vertex can be upgraded
  const canUpgradeVertex = (vKey, vertex) => {
    if (!canBuildNow) return false;
    if (gamePhase !== 'playing') return false;
    if (turnPhase !== 'main' && turnPhase !== 'specialBuild') return false;
    if (selectedAction !== 'city') return false;
    if (vertex.building !== 'settlement' || vertex.owner !== myIndex) return false;
    return true;
  };

  // Check if edge can be placed
  const canPlaceAtEdge = () => {
    if (gamePhase === 'setup') {
      if (!isMyTurn) return false;
      if (selectedAction === 'road') return true;
    }
    if (gamePhase === 'playing') {
      if (!canBuildNow) return false;
      if ((turnPhase === 'main' || turnPhase === 'specialBuild') && selectedAction === 'road') return true;
      if (freeRoads > 0 && selectedAction === 'road') return true;
    }
    return false;
  };

  // Can click on hex (for robber)
  const canClickHex = gamePhase === 'playing' && !paused && turnPhase === 'robber' && isMyTurn;

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

  // SIMPLE APPROACH: Get all roads directly from edges that have road: true
  // No deduplication - if same road appears twice, it just overlaps (no visual issue)
  const roads = useMemo(() => {
    const roadList = [];
    
    Object.entries(edges).forEach(([key, edge]) => {
      if (!edge.road) return;
      
      const parsed = parseEdgeKey(key);
      if (!parsed) return;
      
      // Calculate the two vertex positions for this edge
      const { v1, v2 } = getEdgeEndpoints(parsed.q, parsed.r, parsed.dir);
      
      roadList.push({
        key,
        owner: edge.owner,
        v1,
        v2
      });
    });
    
    return roadList;
  }, [edges]);

  // Get unique edge positions for clickable areas (edges without roads)
  const clickableEdges = useMemo(() => {
    const edgeList = [];
    const seenPositions = new Set();
    
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
      
      // Skip if we've already added this position
      if (seenPositions.has(pk)) return;
      
      seenPositions.add(pk);
      edgeList.push({
        key,
        v1,
        v2
      });
    });
    
    return edgeList;
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
        seen.set(pk, { key, vertex, pos, parsed });
        result.push({ key, vertex, pos, parsed });
      } else {
        // If we already have this vertex, update if this one has a building
        const existing = seen.get(pk);
        if (vertex.building && !existing.vertex.building) {
          const idx = result.findIndex(r => r.key === existing.key);
          if (idx !== -1) {
            result[idx] = { key, vertex, pos, parsed };
            seen.set(pk, { key, vertex, pos, parsed });
          }
        }
      }
    });
    
    return result;
  }, [vertices, hexes]);

  const showEdgePlaceholders = canPlaceAtEdge();

  return (
    <svg 
      className="hex-board"
      viewBox={`0 0 ${width} ${height}`}
      style={{ maxWidth: '100%', maxHeight: '100%' }}
    >
      <defs>
        <linearGradient id="ocean-gradient" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#123f56" />
          <stop offset=".48" stopColor="#17637a" />
          <stop offset="1" stopColor="#0d3449" />
        </linearGradient>
        <radialGradient id="ocean-glow" cx="50%" cy="42%" r="66%">
          <stop offset="0" stopColor="#62b5bd" stopOpacity=".34" />
          <stop offset=".7" stopColor="#1b6678" stopOpacity=".08" />
          <stop offset="1" stopColor="#062838" stopOpacity=".54" />
        </radialGradient>
        <pattern id="water-lines" patternUnits="userSpaceOnUse" width="34" height="18">
          <path d="M-9 9 Q0 2 9 9 T27 9 T45 9" fill="none" stroke="#a9e0dc" strokeWidth="1.1" opacity=".16" />
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
          <feDropShadow dx="0" dy="3" stdDeviation="2.2" floodColor="#102a25" floodOpacity=".62" />
        </filter>
        <filter id="token-shadow" x="-45%" y="-45%" width="190%" height="200%">
          <feDropShadow dx="0" dy="2.5" stdDeviation="2" floodColor="#28170d" floodOpacity=".58" />
        </filter>
        <filter id="building-shadow" x="-70%" y="-70%" width="240%" height="250%">
          <feDropShadow dx="1" dy="2.4" stdDeviation="1.4" floodColor="#07141a" floodOpacity=".72" />
        </filter>
        {Object.keys(hexes).map((key) => (
          <clipPath id={`tile-clip-${key.replace(',', '-')}`} key={`clip-${key}`}>
            <path d={hexPath(0, 0, HEX_SIZE - 2)} />
          </clipPath>
        ))}
      </defs>
      
      <g transform={`translate(${offsetX}, ${offsetY})`}>
        {/* Framed ocean and the shallow shelf beneath the island. */}
        <rect
          className="ocean-frame"
          x={bounds.minX - 29}
          y={bounds.minY - 29}
          width={width - 2}
          height={height - 2}
          rx="44"
          fill="url(#ocean-gradient)"
          filter="url(#board-shadow)"
        />
        <rect
          className="ocean-light"
          x={bounds.minX - 25}
          y={bounds.minY - 25}
          width={width - 10}
          height={height - 10}
          rx="40"
          fill="url(#ocean-glow)"
          stroke="#6db4b6"
          strokeWidth="1.5"
          strokeOpacity=".38"
        />
        <rect
          x={bounds.minX - 24}
          y={bounds.minY - 24}
          width={width - 12}
          height={height - 12}
          rx="39"
          fill="url(#water-lines)"
        />
        <g className="island-shelf">
          {Object.values(hexes).map((hex) => {
            const pos = axialToPixel(hex.q, hex.r);
            return <path key={`shelf-${hex.q}-${hex.r}`} d={hexPath(pos.x, pos.y, HEX_SIZE + 4)} />;
          })}
        </g>
        
        {/* Hexes */}
        {Object.entries(hexes).map(([key, hex]) => {
          const pos = axialToPixel(hex.q, hex.r);
          const isRobberHere = robber === key;
          const clipId = `tile-clip-${key.replace(',', '-')}`;
          const dots = probabilityDots(hex.number);
          
          return (
            <g 
              key={key} 
              className={`hex ${canClickHex ? 'clickable' : ''} ${isRobberHere ? 'has-robber' : ''}`}
              role={canClickHex ? 'button' : undefined}
              tabIndex={canClickHex ? 0 : undefined}
              aria-label={canClickHex ? `Move robber to ${hex.terrain} ${hex.number || 'desert'} at ${key}` : undefined}
              onKeyDown={event => {
                if (canClickHex && (event.key === 'Enter' || event.key === ' ')) {
                  event.preventDefault(); onHexClick(key);
                }
              }}
              onClick={() => canClickHex && onHexClick(key)}
              onContextMenu={(e) => onHexRightClick && onHexRightClick(e, hex)}
              style={{ cursor: 'context-menu' }}
            >
              <path
                className="terrain-tile"
                d={hexPath(pos.x, pos.y, HEX_SIZE)}
                fill={terrainFill(hex.terrain, hex.color)}
                stroke="#553c27"
                strokeWidth="3.2"
                filter="url(#hex-shadow)"
              />
              <g clipPath={`url(#${clipId})`} transform={`translate(${pos.x} ${pos.y})`}>
                <TerrainArtwork terrain={hex.terrain} />
                <path className="tile-sunwash" d="M-48 -48 H48 V-7 Q2 -25 -48 5Z" />
              </g>
              <path
                d={hexPath(pos.x, pos.y, HEX_SIZE - 4)}
                fill="none"
                stroke="rgba(255,255,255,0.38)"
                strokeWidth="1.25"
                className="tile-bevel"
              />
              
              {/* Number token */}
              {hex.number && (
                <g className={`number-token ${hex.number === 6 || hex.number === 8 ? 'number-token--hot' : ''}`} filter="url(#token-shadow)">
                  <circle cx={pos.x} cy={pos.y} r="18" fill="url(#token-rim)" />
                  <circle cx={pos.x} cy={pos.y} r="15.5" fill="url(#token-face)" stroke="#6f4d2d" strokeWidth=".7" />
                  <circle cx={pos.x - 5} cy={pos.y - 6} r="7" fill="#fff" opacity=".2" />
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
              
              {/* Resource icon at bottom of hex */}
              <g className="terrain-badge">
                <circle cx={pos.x} cy={pos.y + 34} r="10" />
                <GameIconSymbol
                  name={getTerrainIcon(hex.terrain)}
                  x={pos.x}
                  y={pos.y + 34}
                  size={14}
                  opacity="0.96"
                />
              </g>
              
              {/* Robber */}
              {isRobberHere && (
                <g className="robber" transform={`translate(${pos.x} ${pos.y - 2})`} filter="url(#building-shadow)">
                  <title>Robber</title>
                  <ellipse cx="0" cy="18" rx="12" ry="4" fill="#061217" opacity=".5" />
                  <path d="M-10 15 Q-9 3 -5 -3 Q-9 -8 -7 -14 Q-5 -21 0 -21 Q5 -21 7 -14 Q9 -8 5 -3 Q9 3 10 15Z" fill="#152329" stroke="#080e11" strokeWidth="2" />
                  <path d="M-3 -17 Q0 -20 3 -17 M-5 0 Q-1 -3 2 -1" fill="none" stroke="#516068" strokeWidth="1.3" strokeLinecap="round" opacity=".75" />
                </g>
              )}
            </g>
          );
        })}

        {/* Clickable edge areas (only shown when placing roads and no road exists) */}
        {showEdgePlaceholders && clickableEdges.filter(({key}) => legalActions.some(action => action.type === 'placeRoad' && action.payload.edgeKey === key)).map(({ key, v1, v2 }) => (
          <line
            key={`click-${key}`}
            x1={v1.x}
            y1={v1.y}
            x2={v2.x}
            y2={v2.y}
            stroke="rgba(255, 255, 255, 0.3)"
            strokeWidth="10"
            strokeLinecap="round"
            className="edge-placeholder"
            onClick={() => onPlaceRoad(key)}
          />
        ))}

        {/* Roads - rendered separately from clickable areas */}
        {roads.map(({ key, owner, v1, v2 }) => (
          <g key={`road-${key}`} className="road" filter="url(#building-shadow)">
            <line
              x1={v1.x}
              y1={v1.y}
              x2={v2.x}
              y2={v2.y}
              stroke="#241b18"
              strokeWidth="10.5"
              strokeLinecap="round"
            />
            <line
              x1={v1.x}
              y1={v1.y}
              x2={v2.x}
              y2={v2.y}
              stroke={players[owner]?.color || '#ff0000'}
              strokeWidth="7.2"
              strokeLinecap="round"
            />
            <line
              x1={v1.x}
              y1={v1.y - .8}
              x2={v2.x}
              y2={v2.y - .8}
              stroke="#fff"
              strokeOpacity=".34"
              strokeWidth="1.35"
              strokeLinecap="round"
            />
          </g>
        ))}

        {/* Vertices (settlements/cities) */}
        {uniqueVertices.map(({ key, vertex, pos }) => {
          const canPlace = canPlaceAtVertex(key) && !vertex.building;
          const canUpgrade = canUpgradeVertex(key, vertex);
          
          return (
            <g key={key} className="vertex-group">
              {/* Settlement */}
              {vertex.building === 'settlement' && (
                <g 
                  className={`settlement ${canUpgrade ? 'upgradeable' : ''}`}
                  onClick={() => canUpgrade && onUpgradeToCity(key)}
                >
                  <path
                    d={`M${pos.x - 10} ${pos.y - 2} L${pos.x} ${pos.y - 12} L${pos.x + 10} ${pos.y - 2} L${pos.x + 8} ${pos.y - 2} L${pos.x + 8} ${pos.y + 8} L${pos.x - 8} ${pos.y + 8} L${pos.x - 8} ${pos.y - 2} Z`}
                    fill={players[vertex.owner].color}
                    stroke="#2b211d"
                    strokeWidth="1.8"
                    filter="url(#building-shadow)"
                  />
                  <path d={`M${pos.x - 7} ${pos.y - 1} L${pos.x} ${pos.y - 8} L${pos.x + 7} ${pos.y - 1}`} fill="none" stroke="#fff" strokeOpacity=".38" strokeWidth="1.2" strokeLinecap="round" />
                  <rect x={pos.x - 2} y={pos.y + 2} width="4" height="6" rx=".7" fill="#2b211d" opacity=".58" />
                </g>
              )}
              
              {/* City */}
              {vertex.building === 'city' && (
                <g className="city">
                  <path
                    d={`M${pos.x - 13} ${pos.y + 9} V${pos.y - 3} L${pos.x - 7} ${pos.y - 9} L${pos.x - 1} ${pos.y - 3} V${pos.y - 14} H${pos.x + 7} V${pos.y - 7} H${pos.x + 12} V${pos.y + 9}Z`}
                    fill={players[vertex.owner].color}
                    stroke="#2b211d"
                    strokeWidth="1.8"
                    filter="url(#building-shadow)"
                  />
                  <path d={`M${pos.x - 10} ${pos.y - 2} L${pos.x - 7} ${pos.y - 5} L${pos.x - 3} ${pos.y - 1} M${pos.x + 2} ${pos.y - 11} H${pos.x + 5}`} fill="none" stroke="#fff" strokeOpacity=".4" strokeWidth="1.2" strokeLinecap="round" />
                  <g fill="#2b211d" opacity=".55">
                    <rect x={pos.x - 9} y={pos.y + 3} width="3" height="6" rx=".5" />
                    <rect x={pos.x + 3} y={pos.y - 4} width="3" height="4" rx=".5" />
                    <rect x={pos.x + 7} y={pos.y + 3} width="3" height="4" rx=".5" />
                  </g>
                </g>
              )}
              
              {/* Clickable placeholder for placing settlements */}
              {canPlace && legalActions.some(action => action.type === 'placeSettlement' && action.payload.vertexKey === key) && (
                <circle
                  cx={pos.x}
                  cy={pos.y}
                  r="10"
                  className="vertex-placeholder"
                  onClick={() => onPlaceSettlement(key)}
                />
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
                <circle r="15" fill="url(#wood-gradient)" stroke="#e0b46d" strokeWidth="1.3" />
                <circle r="11.8" fill="#f3dfb1" stroke="#5a3720" strokeWidth=".8" />
                <GameIconSymbol name={getPortIcon(port)} x={0} y={0} size={15} />
                <g className="port-ratio">
                  <rect x="-11" y="16" width="22" height="11" rx="5.5" />
                  <text textAnchor="middle" y="24" fontSize="8" fontWeight="800">{port.ratio}:1</text>
                </g>
              </g>
            </g>
          );
        })}
      </g>
    </svg>
  );
}

export default HexBoard;
