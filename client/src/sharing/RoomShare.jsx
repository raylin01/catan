import {useEffect,useRef,useState} from 'react';
import GameIcon from '../components/GameIcon';
import './sharing.css';

export const invitePath = (code,role='human') => role==='spectator'?`/watch/${encodeURIComponent(code)}`:`/?room=${encodeURIComponent(code)}&role=human`;
export function CopyLink({label,path}) {
  const [copied,setCopied]=useState(false),[error,setError]=useState(false);
  const url=new URL(path,window.location.origin).href;
  useEffect(()=>{setCopied(false);setError(false);},[url]);
  return <div className="share-link-row"><label>{label}<input readOnly value={url} onFocus={event=>event.target.select()} aria-label={`${label} URL`}/></label>
    <button type="button" className="room-secondary-button" onClick={async()=>{try{await navigator.clipboard.writeText(url);setCopied(true);setError(false);}catch{setError(true);}}}>{copied?'Copied':'Copy'}</button>
    {error&&<span role="status">Select the link to copy it manually.</span>}
  </div>;
}
export default function RoomShare({code,replayId,ended=false}) {
  const ref=useRef(null);
  useEffect(()=>{const close=event=>{if(!ref.current?.contains(event.target))ref.current?.removeAttribute('open');};document.addEventListener('pointerdown',close);return()=>document.removeEventListener('pointerdown',close);},[]);
  return <details ref={ref} className="room-share" onKeyDown={event=>{if(event.key==='Escape'){ref.current.removeAttribute('open');ref.current.querySelector('summary').focus();}}}><summary><GameIcon name="players" size={17}/>{ended?'Share replay':'Invite & share'}</summary>
    <div className="room-share-body">
      {!ended&&<CopyLink label="Player invitation" path={invitePath(code)}/>}
      <CopyLink label="Spectator link" path={invitePath(code,'spectator')}/>
      <p>This link shows the live table, then opens its replay after the game ends.</p>
      {ended&&replayId&&<CopyLink label="Replay link" path={`/replay/${encodeURIComponent(replayId)}`}/>}
    </div>
  </details>;
}
export function AgentInstructions({code,slot}) {
  const [text,setText]=useState(''),[error,setError]=useState(''),[copied,setCopied]=useState(false);
  const request=useRef(null);
  useEffect(()=>()=>request.current?.abort(),[]);
  const path=code?`/api/rooms/${encodeURIComponent(code)}/agent-guide${slot?`?seat=${encodeURIComponent(slot.id)}`:''}`:'/agent-guide.md';
  const load=async event=>{
    if(!event.currentTarget.open||text)return;
    request.current?.abort();request.current=new AbortController();setError('');
    try {const response=await fetch(path,{signal:request.current.signal});if(!response.ok)throw Error('Instructions are unavailable. Refresh the room and try again.');setText(await response.text());}
    catch(error){if(error.name!=='AbortError')setError(error.message);}
  };
  return <details className="agent-instructions" onToggle={load}><summary>Agent instructions</summary>
    <div><p>Paste these instructions into the agent on your computer. The website does not run or pay for AI models.</p>
      <div className="agent-instructions-actions"><button type="button" className="room-secondary-button" disabled={!text} onClick={async()=>{try{await navigator.clipboard.writeText(text);setCopied(true);}catch{setError('Select the instructions below to copy manually.');}}}>{copied?'Copied':'Copy instructions'}</button><a className="room-link-button" href={path} download>Download .md</a></div>
      {error&&<p role="status">{error}</p>}
      <textarea aria-label="Instructions for your AI agent" readOnly value={text||'Loading instructions…'} onFocus={event=>event.target.select()} rows={8}/>
    </div>
  </details>;
}
export function EndRoomControl({onEnd,busy=false,label='End game'}) {
  const [confirm,setConfirm]=useState(false);
  return confirm?<div className="end-room-confirm" role="group" aria-label={`Confirm ${label.toLowerCase()}`}><p>This ends the room permanently. Anyone with its replay link will be able to view all hands.</p><button type="button" className="room-danger-button" disabled={busy} onClick={async()=>{const result=await onEnd();if(result?.success)setConfirm(false);}}>{label}</button><button type="button" className="room-secondary-button" onClick={()=>setConfirm(false)}>Cancel</button></div>:<button type="button" className="room-danger-button" disabled={busy} onClick={()=>setConfirm(true)}>{label}</button>;
}
