import {useEffect,useState} from 'react';
import './AiControls.css';

const labels={thinking:'Choosing a move','reading-chat':'Considering chat',speaking:'Preparing a reply',waiting:'Waiting for other players',error:'Controller error',stopped:'Controller stopped',
  'compaction-scheduled':'Compaction scheduled',compacting:'Compacting','needs-attention':'Needs attention'};
export function AiStatus({slot}) {
  const [now,setNow]=useState(Date.now);
  useEffect(()=>{if(slot?.kind!=='ai')return;const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[slot?.kind]);
  if(slot?.kind!=='ai'||!['online','stale','offline'].includes(slot.ai?.connection))return null;
  const info=slot.ai,offline=info.connection!=='online';
  const activity=info.activity??info.status;
  const waiting=['unknown','waiting'].includes(activity);
  const text=info.paused?'AI paused':info.status==='error'?'Controller error':info.connection==='stale'?'Connection stale':offline?(info.source==='none'?'Awaiting agent':'Controller offline')
    :waiting?(info.decisionRequired?'Waiting for agent':'Waiting for other players'):labels[activity]||'Connected';
  const elapsed=info.statusSince&&['thinking','reading-chat','speaking','compacting','needs-attention'].includes(activity)&&!offline&&!info.paused
    ?Math.max(0,Math.floor((now-info.statusSince)/1000)):null;
  const details=[info.lastActivityAt?`Last contact: ${new Date(info.lastActivityAt).toLocaleTimeString()}`:'No controller contact',
    Number.isFinite(info.runtime?.contextPercent)?`Context approximately ${info.runtime.contextPercent}%`:null,
    info.runtime?.compaction==='scheduled'?'Compaction scheduled after this game turn':null,
    info.decisionRequired&&activity==='compacting'?'Game is waiting for this player':null].filter(Boolean).join(' · ');
  return <div className={`ai-status ${offline?'ai-status-offline':''}`} title={details}>
    <span aria-hidden="true" className={`ai-status-dot ${!offline&&!info.paused&&['thinking','reading-chat','speaking','compacting'].includes(activity)?'ai-status-active':''}`}/>
    <span>{text}{elapsed!==null&&<small className="ai-status-time">{elapsed<60?`${elapsed}s`:`${Math.floor(elapsed/60)}m ${elapsed%60}s`}</small>}
      {info.runtime?.compaction==='scheduled'&&activity!=='compaction-scheduled'&&!offline&&!info.paused&&<small className="ai-status-detail">Compaction queued</small>}
      {activity==='compacting'&&info.decisionRequired&&!offline&&<small className="ai-status-detail">Move pending</small>}
    </span>
  </div>;
}
export function AiControls({slot,onCommand,busy,showStatus=true}) {
  if(slot.kind!=='ai')return null;
  const paused=slot.ai?.paused;
  return <div className="ai-control-block">
    {showStatus&&<AiStatus slot={slot}/>}
    <div className="ai-control-buttons">
      <button type="button" className="room-secondary-button" disabled={busy||!slot.occupied} onClick={()=>onCommand(paused?'aiResume':'aiPause',{seatId:slot.id})}>{paused?'Resume AI':'Pause AI'}</button>
      <button type="button" className="room-secondary-button" disabled={busy||!slot.occupied||paused} onClick={()=>onCommand('aiCancel',{seatId:slot.id})}>Cancel decision</button>
    </div>
    {slot.occupied&&<label className="ai-chat-toggle ai-live-chat-toggle">
      <input type="checkbox" checked={slot.chatEnabled!==false} disabled={busy} aria-label={`Allow chat for ${slot.name}`} onChange={event=>onCommand('aiSetChat',{seatId:slot.id,enabled:event.target.checked})}/>
      Allow AI to read and reply to chat
    </label>}
    {slot.occupied&&slot.provider==='mcp'&&<p className="room-field-help">Your agent must support the chat API. Replies are optional.</p>}
    {slot.occupied&&slot.ai?.connection!=='online'&&<p className="room-field-help">Start this seat’s bridge on its computer to reconnect. The website cannot launch a remote CLI.</p>}
    <p className="room-field-help">Cancel stops the current decision and pauses this AI. Its seat and cards stay in place.</p>
  </div>;
}
export function ChatModelFields({draft,onChange}) {
  return <fieldset className="ai-chat-settings">
    <legend>AI chat</legend>
    <label className="ai-chat-toggle"><input type="checkbox" checked={draft.chatEnabled!==false} onChange={event=>onChange('chatEnabled',event.target.checked)}/>Consider player chat</label>
    {draft.chatEnabled!==false&&<>
      <label>Chat model<input value={draft.chatModel||''} onChange={event=>onChange('chatModel',event.target.value)} maxLength={40} placeholder="Same as playing model"/></label>
      <label>Chat reasoning<select value={draft.chatReasoning||''} onChange={event=>onChange('chatReasoning',event.target.value)}><option value="">Controller default</option>{['minimal','low','medium','high','xhigh','max'].map(value=><option key={value} value={value}>{value}</option>)}</select></label>
      <p className="room-field-help">Chat uses separate contexts. Suggestions can influence play; replies are optional.</p>
    </>}
  </fieldset>;
}
