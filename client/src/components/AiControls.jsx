import './AiControls.css';

const labels={thinking:'Choosing a move','reading-chat':'Considering chat',speaking:'Preparing a reply',waiting:'Waiting for play',error:'Controller error',stopped:'Controller stopped'};
export function AiStatus({slot}) {
  if(slot?.kind!=='ai')return null;
  const info=slot.ai||{},offline=info.connection!=='online';
  const text=info.paused?'AI paused':info.connection==='stale'?'Connection stale':offline?'Controller offline':labels[info.status]||'Connected';
  return <div className={`ai-status ${offline?'ai-status-offline':''}`} title={info.lastActivityAt?`Last controller activity: ${new Date(info.lastActivityAt).toLocaleTimeString()}`:undefined}>
    <span className={`ai-status-dot ${!offline&&['thinking','reading-chat','speaking'].includes(info.status)?'ai-status-active':''}`}/>
    <span>{text}</span>
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
    {slot.occupied&&(!slot.ai?.runnerAttached||slot.ai?.connection!=='online')&&<p className="room-field-help">Start this seat’s bridge on its computer to reconnect. The website cannot launch a remote CLI.</p>}
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
