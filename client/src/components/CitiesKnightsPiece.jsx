export function KnightShape({color='#be5452',strength=1,active=false}) {
  return <g className={`ck-knight-shape ${active?'is-active':''}`}>
    <ellipse cx="1.5" cy="13" rx="15" ry="4" fill="#061217" opacity=".45"/>
    <path d="M-13 8H13L11 14H-11Z" fill={color} stroke="#243238" strokeWidth="1.2"/>
    <path d="M-11 10V5L-7-2V-9Q-4-17 3-16L8-10 7-3 11 5V10Z" fill={color} stroke="#263339" strokeWidth="1.2"/>
    <path d="M-6-8Q-3-13 3-12L6-8M-8 6H7" fill="none" stroke="#fff7d6" strokeOpacity=".6" strokeWidth="1.5"/>
    <path d="M-5-7H7V-2H-5Z" fill={active?'#e5d6ad':'#3c4141'} stroke="#23343b" strokeWidth=".8"/>
    <path d="M-1-7V-2M3-7V-2" stroke="#334447" strokeWidth=".9"/>
    {active&&<path d="M-13 4V-18M-16-13H-10M-13-18l-2 3h4Z" fill="#e7d7b4" stroke="#756046"/>}
    {Array.from({length:strength},(_,i)=><circle key={i} cx={(i-(strength-1)/2)*6} cy="7" r="2" fill="#f3de99" stroke="#785c34" strokeWidth=".5"/>)}
  </g>;
}
export function WallShape({color='#be5452'}) {return <g className="ck-wall-shape"><path d="M-20 7V-3H-15V1H-10V-3H-5V1H0V-3H5V1H10V-3H15V1H20V7L16 14H-16Z" fill={color} stroke="#34434a" strokeWidth="1.4"/><path d="M-18 8H18M-12 9v4M-4 9v4M4 9v4M12 9v4" stroke="#fff0cd" opacity=".5"/></g>;}
export function MetropolisShape({color='#d3ab59'}) {return <g className="ck-metropolis-shape"><path d="M-17-8V-20H-11V-13L0-23 11-13V-20H17V-8Z" fill={color} stroke="#6f542f" strokeWidth="1.3"/><path d="M-14-17V-10M14-17V-10M-8-12L0-19 8-12" stroke="#fff1bf" strokeWidth="1.4" fill="none"/><circle cy="-14" r="2" fill="#fff3c6"/></g>;}
export function MerchantShape({color='#ad794d'}) {return <g><ellipse cy="14" rx="11" ry="3" fill="#061217" opacity=".4"/><path d="M-9 12-6 0Q-10-11 0-14 10-11 6 0L9 12Z" fill={color} stroke="#34434a" strokeWidth="1.2"/><path d="M-6-6H6M-3 3v6" stroke="#f9e4b7" opacity=".6"/><path d="M4 1 11 4 9 11H3Z" fill="#8b643d" stroke="#3f3c32"/></g>;}
