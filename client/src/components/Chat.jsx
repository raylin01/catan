import {useState, useRef, useEffect, useLayoutEffect} from 'react';
import './Chat.css';
import GameIcon from './GameIcon';
import {CHAT_LAYOUT_KEY, fitChatLayout, resizeChatLayout} from './chatLayout';
import {chatMessageKey, newChatMessages} from './chatMessages';

const viewport = () => ({width: window.innerWidth, height: window.innerHeight});
const saveLayout = layout => { try { localStorage.setItem(CHAT_LAYOUT_KEY, JSON.stringify(layout)); } catch { /* Optional preference. */ } };

function WindowIcon({kind}) {
  return <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true">
    {kind === 'resize' ? <path d="m5 15 10-10M10 15l5-5M15 15h.01"/> : kind === 'reset' ? <path d="M7 3h10v14H3V9M7 7h10M3 3v4h4M3 7l4-4"/> : <path d="M10 2v16M2 10h16M7 5l3-3 3 3M7 15l3 3 3-3M5 7l-3 3 3 3m10-6 3 3-3 3"/>}
  </svg>;
}

export default function Chat({messages, onSend, onClose, open = true, readOnly = false}) {
  const [input, setInput] = useState('');
  const [layout, setLayout] = useState(() => {
    try { return fitChatLayout(JSON.parse(localStorage.getItem(CHAT_LAYOUT_KEY)), viewport()); }
    catch { return fitChatLayout(null, viewport()); }
  });
  const [moving, setMoving] = useState(false), [unread, setUnread] = useState(0);
  const panel = useRef(null), scroller = useRef(null), gesture = useRef(null);
  const latestKey = chatMessageKey(messages.at(-1));
  const geometry = useRef(layout), pinned = useRef(true), previousKey = useRef(latestKey);
  geometry.current = layout;
  const update = (next, persist = false) => {
    const fitted = fitChatLayout(next, viewport());
    geometry.current = fitted; setLayout(fitted);
    if (persist) saveLayout(fitted);
  };
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement;
    panel.current?.querySelector('input')?.focus();
    const resize = () => update(geometry.current);
    resize();
    window.addEventListener('resize', resize);
    return () => { window.removeEventListener('resize', resize); if (previous?.isConnected) previous.focus(); };
  }, [open]);
  useLayoutEffect(() => {
    const added = newChatMessages(messages, previousKey.current).length;
    previousKey.current = latestKey;
    if (open && pinned.current && scroller.current) { scroller.current.scrollTop = scroller.current.scrollHeight; setUnread(0); }
    else if (added && !pinned.current) setUnread(count => count + added);
  }, [latestKey, open]);

  const start = (event, kind) => {
    if (event.button !== 0) return;
    event.preventDefault(); event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = {kind, pointerId: event.pointerId, x: event.clientX, y: event.clientY, layout: geometry.current};
    setMoving(true);
  };
  const move = event => {
    const drag = gesture.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    const next = {...drag.layout};
    if (drag.kind === 'move') { next.x += dx; next.y += dy; }
    else { update(resizeChatLayout(next, next.width + dx, next.height + dy, viewport())); return; }
    update(next);
  };
  const finish = () => {
    if (!gesture.current) return;
    gesture.current = null; setMoving(false); saveLayout(geometry.current);
  };
  const reset = () => update(fitChatLayout(null, viewport()), true);
  const key = (event, kind) => {
    if (event.key === 'Home') { event.preventDefault(); reset(); return; }
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    const step = event.shiftKey ? 8 : 24;
    const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
    const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
    const next = {...geometry.current};
    if (kind === 'move') { next.x += dx; next.y += dy; }
    else { update(resizeChatLayout(next, next.width + dx, next.height + dy, viewport()), true); return; }
    update(next, true);
  };
  const manipulation = kind => ({onPointerDown: event => start(event, kind), onPointerMove: move,
    onPointerUp: finish, onPointerCancel: finish, onLostPointerCapture: finish, onKeyDown: event => key(event, kind)});
  const showLatest = () => {
    pinned.current = true; setUnread(0);
    if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
  };

  return <div className={`chat-panel game-chat-window ${moving ? 'is-manipulating' : ''}`} ref={panel}
    role="region" aria-label="Game chat" hidden={!open} style={{left: layout.x, top: layout.y, width: layout.width, height: layout.height}}
    onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } }}>
    <div className="chat-header">
      <button type="button" className="chat-drag-handle" aria-label="Move chat" aria-describedby="chat-window-help" title="Drag to move · arrow keys when focused" {...manipulation('move')}>
        <GameIcon name="chat" size={17}/><span>Chat</span><WindowIcon kind="move"/>
      </button>
      <button type="button" className="chat-window-control chat-restore-layout" onClick={reset} aria-label="Restore chat layout" title="Restore default size and position"><WindowIcon kind="reset"/></button>
      <button type="button" className="chat-window-control" onClick={onClose} aria-label="Minimize chat" title="Minimize chat"><svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M4 10h12" stroke="currentColor" strokeWidth="1.5"/></svg></button>
    </div>
    <span id="chat-window-help" className="chat-sr-only">Drag to move or resize. Arrow keys adjust the focused handle; Shift makes smaller adjustments. Home restores the default layout. Escape minimizes chat.</span>
    <div className="chat-messages" ref={scroller} onScroll={() => {
      const node = scroller.current;
      pinned.current = node.scrollHeight - node.scrollTop - node.clientHeight < 28;
      if (pinned.current) setUnread(0);
    }}>
      {messages.length === 0 && <div className="no-messages">No messages yet</div>}
      {messages.map((msg, index) => <div key={msg.id || index} className="chat-message">
        <span className="message-author" style={{color: msg.playerColor}}>{msg.playerName}</span>
        <time className="message-time">{new Date(msg.timestamp).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}</time>
        <span className="message-text">{msg.message}</span>
      </div>)}
    </div>
    {unread > 0 && <button className="chat-new-messages" type="button" onClick={showLatest}>{unread} new {unread === 1 ? 'message' : 'messages'} ↓</button>}
    {!readOnly && <form className="chat-input" onSubmit={event => {
      event.preventDefault();
      if (input.trim()) { onSend(input.trim()); setInput(''); showLatest(); }
    }}>
      <input type="text" value={input} onChange={event => setInput(event.target.value)} placeholder="Message the table…" aria-label="Chat message" maxLength={200}/>
      <button type="submit" disabled={!input.trim()}>Send</button>
    </form>}
    <button type="button" className="chat-resize-handle" aria-label="Resize chat" aria-describedby="chat-window-help" title="Drag to resize · arrow keys when focused" {...manipulation('resize')}><WindowIcon kind="resize"/></button>
  </div>;
}
