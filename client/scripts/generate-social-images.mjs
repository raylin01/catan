import {Resvg} from '@resvg/resvg-js';
import {mkdirSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const out=fileURLToPath(new URL('../public/social/',import.meta.url));
mkdirSync(out,{recursive:true});
const font=fileURLToPath(new URL('./fonts/Cinzel.ttf',import.meta.url));
const hex=(x,y,r)=>Array.from({length:6},(_,i)=>`${x+r*Math.cos(i*Math.PI/3)},${y+r*Math.sin(i*Math.PI/3)}`).join(' ');
const colors=['#637c42','#b8894c','#63766c','#a95237','#456950','#b6a05f'];
let board='',index=0;
for(let q=-2;q<=2;q++)for(let r=Math.max(-2,-q-2);r<=Math.min(2,-q+2);r++) {
  const x=920+q*78,y=302+(r+q/2)*90;
  const kind=(index*7+Math.abs(r))%6,fill=colors[kind],id=`tile${index}`;
  const hills=kind===2?`<path d="M${x-49} ${y+25}l28-56 21 30 19-40 36 66" fill="#c1c4b0" opacity=".32"/>`:
    kind===4?Array.from({length:7},(_,i)=>`<path d="M${x-34+i*11} ${y+22}l10-35 10 35z" fill="#182f27" opacity=".3"/>`).join(''):
    `<path d="M${x-55} ${y+6}Q${x-10} ${y-20} ${x+55} ${y+7}M${x-55} ${y+22}Q${x-10} ${y-3} ${x+55} ${y+24}" fill="none" stroke="#e6d3a4" stroke-width="3" opacity=".22"/>`;
  board+=`<defs><clipPath id="${id}"><polygon points="${hex(x,y,49)}"/></clipPath></defs><polygon points="${hex(x,y+7,51)}" fill="#071820"/><polygon points="${hex(x,y,50)}" fill="${fill}" stroke="#dcc79b" stroke-width="2"/><g clip-path="url(#${id})">${hills}<polygon points="${hex(x,y-5,47)}" fill="url(#tileLight)"/></g>`;
  if(index!==9)board+=`<circle cx="${x}" cy="${y}" r="17" fill="#e6d5ac" stroke="#755e3d" stroke-width="1.3"/><text x="${x}" y="${y+6}" text-anchor="middle" font-family="Cinzel" font-size="18" font-weight="600" fill="${index%5===0?'#963c2a':'#3d3a2e'}">${[5,9,6,4,10,8,3,11,4,0,6,12,8,9,3,10,11,5,2][index]}</text>`;
  index++;
}
const settlement=(x,y,c)=>`<g transform="translate(${x},${y})"><path d="M-15 4L0-12 15 4V24H-15Z" fill="#06151a" opacity=".6" transform="translate(3 6)"/><path d="M-15 4L0-12 15 4V24H-15Z" fill="${c}" stroke="#2c2119" stroke-width="2"/><path d="M-15 4L0-12 15 4" fill="none" stroke="#ffe5b5" stroke-width="3" opacity=".6"/><path d="M0 5V24H15V5Z" fill="#000" opacity=".2"/></g>`;
board+=`<path d="M815 120l-28 45M787 165l26 45M1023 438l-27 45" stroke="#07181c" stroke-width="13" stroke-linecap="round"/><path d="M815 115l-28 45M787 160l26 45" stroke="#b7533b" stroke-width="9" stroke-linecap="round"/><path d="M1023 433l-27 45" stroke="#e1cb9b" stroke-width="9" stroke-linecap="round"/>${settlement(814,108,'#ae4938')}${settlement(811,202,'#ae4938')}${settlement(997,475,'#e1cb9b')}`;
const die=(x,y,n)=>`<g transform="translate(${x},${y}) rotate(-8)"><rect x="3" y="7" width="50" height="50" rx="10" fill="#081920"/><rect width="50" height="50" rx="10" fill="#e7dac0" stroke="#aa966f" stroke-width="2"/>${(n===3?[[13,13],[25,25],[37,37]]:[[13,13],[37,13],[13,37],[37,37]]).map(([a,b])=>`<circle cx="${a}" cy="${b}" r="4" fill="#443e32"/>`).join('')}</g>`;
const variants={home:['Your next','great game.','BUILD · TRADE · COMPETE'],join:['A seat at','the table.','JOIN FRIENDS & AI PLAYERS'],watch:['Every move.','Every moment.','WATCH THE TABLE LIVE'],replay:['Replay the','whole story.','EVERY TURN · EVERY PERSPECTIVE']};
for(const [kind,[line1,line2,footer]] of Object.entries(variants)) {
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630"><defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="#1c3740"/><stop offset="1" stop-color="#0d202a"/></linearGradient><linearGradient id="tileLight" x2="0" y2="1"><stop stop-color="#fff4c7" stop-opacity=".16"/><stop offset="1" stop-color="#fff4c7" stop-opacity="0"/></linearGradient><radialGradient id="sea"><stop stop-color="#467b79" stop-opacity=".28"/><stop offset="1" stop-color="#173b48" stop-opacity="0"/></radialGradient></defs><rect width="1200" height="630" fill="url(#bg)"/><circle cx="920" cy="302" r="385" fill="url(#sea)"/><g fill="none" stroke="#6b9a94" opacity=".12">${[255,273,294,319,347].map(radius=>`<polygon points="${hex(920,302,radius)}"/>`).join('')}</g><path d="M64 50H1136M64 580H1136" stroke="#c4a775" opacity=".3"/><g font-family="Cinzel"><text x="76" y="107" font-size="24" letter-spacing="3" fill="#dcc79b">CATAN ONLINE</text><text x="78" y="139" font-size="15" letter-spacing="2" fill="#97afa8">BY RLIN</text><text x="73" y="268" font-size="58" fill="#f0e6cd">${line1}</text><text x="73" y="340" font-size="58" fill="#f0e6cd">${line2}</text><path d="M78 387H161" stroke="#c5a675" stroke-width="2"/><text x="78" y="432" font-size="14" letter-spacing="1.5" fill="#b8c7bc">${footer.replaceAll('&','&amp;')}</text><text x="78" y="539" font-size="17" letter-spacing="2" fill="#dcc79b">catan.rlin.dev</text></g>${board}${die(629,469,3)}${die(687,486,4)}</svg>`;
  const png=new Resvg(svg,{font:{fontFiles:[font],loadSystemFonts:false,defaultFontFamily:'Cinzel'}}).render().asPng();
  writeFileSync(`${out}/${kind}.png`,png);
  console.log(`Generated ${kind}.png (${png.length} bytes)`);
}
