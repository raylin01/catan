// Painted wooden silhouettes share the shapes used by the board pieces.
export default function BuildingPiece({kind, color = '#c97855'}) {
  return <svg className="building-piece" viewBox="0 0 64 48" aria-hidden="true" style={{'--piece-color':color}}>
    <ellipse cx="33" cy="39" rx="23" ry="4" fill="#000" opacity=".24" />
    {kind === 'development' ? <>
      <rect x="20" y="6" width="26" height="35" rx="2" fill="#b8ad8c" transform="rotate(7 33 24)"/>
      <rect x="16" y="4" width="26" height="35" rx="2" fill="#29424d" stroke="#d6c8a0" strokeWidth="1.5" transform="rotate(-5 29 22)"/>
      <path d="M29 10v22m-7-19 7 5 7-5m-14 8 7 5 7-5m-12 7 5 4 5-4" fill="none" stroke="#c9b884" strokeWidth="1.4"/>
    </> : kind === 'road' ? <>
      <path d="m7 29 42-15 8 5-42 16Z" fill={color}/>
      <path d="m15 35 42-16v8L15 43Z" fill={color} className="piece-side"/>
      <path d="m7 29 8 6v8l-8-6Z" fill={color} className="piece-end"/>
      <path d="m9 29 40-14 6 4" fill="none" stroke="#fff" strokeOpacity=".35"/>
    </> : kind === 'city' ? <>
      <path d="M10 37V24l10-10 10 10v-9L41 5l11 10v22Z" fill={color}/>
      <path d="m52 15 5 4v21l-5-3Zm-22 9 5 4v12l-5-3Z" fill={color} className="piece-side"/>
      <path d="m10 37 5 4h42l-5-4Z" fill={color} className="piece-end"/>
      <path d="m12 24 8-8 9 9m3-10 9-8 9 9" fill="none" stroke="#fff" strokeOpacity=".4"/>
    </> : <>
      <path d="M15 37V22L31 7l16 15v15Z" fill={color}/>
      <path d="m47 22 7 4v16l-7-5Z" fill={color} className="piece-side"/>
      <path d="m31 7 7 4 16 15-7-4Z" fill={color} className="piece-end"/>
      <path d="m15 37 7 5h32l-7-5Z" fill={color} className="piece-end"/>
      <path d="m17 22 14-13 14 13" fill="none" stroke="#fff" strokeOpacity=".4"/>
    </>}
  </svg>;
}
