// Wooden silhouettes use the board's bevel, contact shadow and player palette.
export function ShipShape({color = '#c97855', warship = false, pirate = false}) {
  return <g className="ship-shape">
    <ellipse cx="1" cy="12" rx="19" ry="4" fill="#071921" opacity=".42"/>
    <path d="M-19 5H19L12 13H-11Z" fill={color} stroke="#211d19" strokeWidth="1.6"/>
    <path d="M-16 8H15L12 13H-11Z" fill="#101a20" opacity=".26"/>
    <path d="M-17 5H17M-10 10H10" fill="none" stroke="#fff4d2" strokeOpacity=".45" strokeWidth="1.1"/>
    <path d="M0 5V-19" stroke="#241d17" strokeWidth="2.8"/>
    <path d="M-2-17V2H-15Q-11-8-2-17ZM3-13Q13-9 15 2H3Z" fill={pirate ? '#1d2a30' : warship ? color : '#f5e8bd'} stroke="#30281d" strokeWidth="1.2"/>
    <path d="M-4-12Q-9-5-11 0M5-10Q11-6 12 0" fill="none" stroke="#fff8df" strokeOpacity=".35" strokeWidth="1.1"/>
    {warship && <path d="m5-7 7 7m0-7L5 0" stroke="#f8e8bb" strokeWidth="1.6"/>}
    {pirate && <><circle cx="-7" cy="-4" r="2.5" fill="#ede4cb"/><path d="m-11 1 8-3m0 3-8-3" stroke="#ede4cb" strokeWidth="1.2"/></>}
  </g>;
}
export function FortressShape({color='#9c7960'}) {
  return <g><ellipse cx="1" cy="13" rx="17" ry="4" fill="#06171b" opacity=".45"/><path d="M-15 12V-13H-10V-8H-5V-13H0V-6H5V-13H10V-8H15V12Z" fill={color} stroke="#30251e" strokeWidth="1.8"/><path d="M-15 8H15V12H-15Z" fill="#1e2220" opacity=".3"/><path d="M-4 12V4a4 4 0 0 1 8 0v8" fill="#322820"/><path d="M-12-5V3M11-5V3M-2-3H3" stroke="#fff1c8" strokeOpacity=".48" strokeWidth="1.4"/></g>;
}
export default function SeafarersPiece({kind='ship',color,warship=false}) {
  return <svg className="building-piece seafarers-piece" viewBox="-24 -23 48 42" aria-hidden="true">
    {kind === 'fortress' ? <FortressShape color={color}/> : <ShipShape color={color} warship={warship} pirate={kind==='pirate'}/>}
  </svg>;
}
