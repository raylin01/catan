import {createContext, useCallback, useContext, useEffect, useId, useRef, useState} from 'react';
import {createGameAudio} from './sound';
import './presentation.css';
import coastArtwork from '../assets/painted/coast.webp';

const noop = () => {};
const PresentationContext = createContext({soundEnabled:true, ambientEnabled:true, toggleSound:noop, toggleAmbient:noop, playSound:noop});
export const useGamePresentation = () => useContext(PresentationContext);

export function GamePresentation({children}) {
  const [soundEnabled,setSoundEnabled] = useState(() => {
    try { return localStorage.getItem('catanSoundEffects') !== 'off'; } catch { return true; }
  });
  const [audioUnavailable,setAudioUnavailable] = useState(false);
  const [ambientEnabled,setAmbientEnabled] = useState(() => {
    try { return localStorage.getItem('catanAmbientMotion') !== 'off'; } catch { return true; }
  });
  const audio = useRef(null), request = useRef(0), soundWanted = useRef(soundEnabled);
  const enabling = useRef(false);
  const enableSound = useCallback(async () => {
    if (!soundWanted.current || audio.current?.isRunning() || enabling.current) return;
    const ticket = ++request.current;
    enabling.current = true;
    audio.current ||= createGameAudio(() => new (window.AudioContext || window.webkitAudioContext)());
    const enabled = await audio.current.enable();
    if (ticket !== request.current) return;
    enabling.current = false;
    setAudioUnavailable(!enabled);
  }, []);
  const toggleSound = useCallback(() => {
    const wanted = !soundWanted.current;
    soundWanted.current = wanted;
    setSoundEnabled(wanted);
    setAudioUnavailable(false);
    try { localStorage.setItem('catanSoundEffects',wanted?'on':'off'); } catch { /* Storage may be unavailable. */ }
    if (wanted) { void enableSound(); return; }
    ++request.current;
    enabling.current = false;
    audio.current?.mute();
  }, [enableSound]);
  // Browsers require a gesture before audio can start. Keep listening so a
  // failed activation can retry; repeated gestures never duplicate loading.
  useEffect(() => {
    const activate = event => { if (event.isTrusted) void enableSound(); };
    document.addEventListener('pointerdown',activate);
    document.addEventListener('keydown',activate);
    return () => {
      document.removeEventListener('pointerdown',activate);
      document.removeEventListener('keydown',activate);
      ++request.current;
      enabling.current = false;
        audio.current?.close();
      audio.current = null;
    };
  }, [enableSound]);
  const toggleAmbient = useCallback(() => setAmbientEnabled(value => {
    try { localStorage.setItem('catanAmbientMotion',value?'off':'on'); } catch { /* Private browsing may deny storage. */ }
    return !value;
  }), []);
  const playSound = useCallback(kind => audio.current?.play(kind,document.visibilityState === 'visible'), []);
  return <PresentationContext.Provider value={{soundEnabled,ambientEnabled,toggleSound,toggleAmbient,playSound}}>
    <IslandAtmosphere animated={ambientEnabled}/>
    {children}
    {audioUnavailable && <div className="presentation-audio-notice" role="status">Sound is unavailable in this browser. <button onClick={()=>setAudioUnavailable(false)}>Dismiss</button></div>}
  </PresentationContext.Provider>;
}

function ControlIcon({sound,active}) {
  return <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
    {sound ? <><path d="M11 5 6 9H3v6h3l5 4Z"/>{active?<><path d="M15 8c2 2 2 6 0 8M18 5c4 4 4 10 0 14"/></>:<path d="m16 9 5 6m0-6-5 6"/>}</> : <><path d="M2 18h20M5 14a7 7 0 0 1 14 0M12 2v3M3 7l2 2m16-2-2 2"/>{!active&&<path d="m3 3 18 18"/>}</>}
  </svg>;
}

export function PresentationControls() {
  const {soundEnabled,ambientEnabled,toggleSound,toggleAmbient} = useGamePresentation();
  return <div className="presentation-controls" role="group" aria-label="Sound and background animation">
    <button type="button" aria-label="Sound effects" aria-pressed={soundEnabled} onClick={toggleSound} title={soundEnabled?'Mute sound effects':'Enable sound effects'}><ControlIcon sound active={soundEnabled}/><span>Sound {soundEnabled?'on':'off'}</span></button>
    <button type="button" aria-label="Background animation" aria-pressed={ambientEnabled} onClick={toggleAmbient} title={ambientEnabled?'Pause background animation':'Animate background'}><ControlIcon active={ambientEnabled}/><span>Scenery {ambientEnabled?'on':'off'}</span></button>
  </div>;
}

function IslandAtmosphere({animated}) {
  const id=useId().replace(/:/g,'');
  const [visible,setVisible]=useState(()=>document.visibilityState==='visible');
  useEffect(()=>{
    const update=()=>setVisible(document.visibilityState==='visible');
    document.addEventListener('visibilitychange',update);
    return()=>document.removeEventListener('visibilitychange',update);
  },[]);
  return <div className={`island-atmosphere ${animated&&visible?'is-animated':''}`} aria-hidden="true">
    <svg className="island-landscape" viewBox="0 0 1672 941" preserveAspectRatio="xMidYMid slice">
      <defs>
        <filter id={`${id}-soft-edge`}><feGaussianBlur stdDeviation="7"/></filter>
        <mask id={`${id}-water`}><path fill="white" filter={`url(#${id}-soft-edge)`} d="M0 463H880L1050 483 1320 506 1672 510V690L1470 720 1390 763 1260 810 1120 805 1000 780 870 792 810 765 710 775 670 736 555 720 470 704 340 687 220 661 155 595 85 555 0 534Z"/></mask>
        <mask id={`${id}-sky`}><path fill="white" filter={`url(#${id}-soft-edge)`} d="M0 0H1672V150L1500 140 1330 190 1150 235 950 310 780 345 540 362 250 360 0 347Z"/></mask>
        <filter id={`${id}-water-grain`} x="-2%" y="-2%" width="104%" height="104%"><feTurbulence type="fractalNoise" baseFrequency=".012 .075" numOctaves="1" seed="9"/><feDisplacementMap in="SourceGraphic" scale="5" xChannelSelector="R" yChannelSelector="G"/></filter>
        <radialGradient id={`${id}-sun-glow`}><stop stopColor="#ffdf9a" stopOpacity=".30"/><stop offset="1" stopColor="#e0ba69" stopOpacity="0"/></radialGradient>
      </defs>
      <image href={coastArtwork} width="1672" height="941"/>
      <g mask={`url(#${id}-sky)`}><image className="island-cloud-drift" href={coastArtwork} width="1672" height="941"/></g>
      <ellipse className="island-sun-glow" cx="240" cy="300" rx="620" ry="320" fill={`url(#${id}-sun-glow)`}/>
      <g mask={`url(#${id}-water)`}>
        <image className="island-water-surface" href={coastArtwork} width="1672" height="941" filter={`url(#${id}-water-grain)`}/>
        <g className="island-water-glints" fill="none" stroke="#f0d9ad" strokeLinecap="round">
          {Array.from({length:24},(_,index)=>{
            const y=475+index*12, x=40+(index*137)%1060, width=75+index*6;
            return <path key={index} className="island-ripple" style={{'--ripple-delay':`${-index*.61}s`,'--ripple-time':`${5+index%4}s`}} d={`M${x} ${y}q${width*.25} -2 ${width*.5} 0t${width*.5} 0`} strokeWidth={.65+index*.035} strokeDasharray="9 16 30 13"/>;
          })}
        </g>
      </g>
    </svg>
    <div className="island-dawn" />
  </div>;
}
