import {useEffect,useRef,useState} from 'react';
import GameBoard from '../components/GameBoard';
import {PresentationControls} from '../presentation/GamePresentation';
import {createObservationBoundary,isOlderObservation} from '../presentation/observationBoundary';
import RoomShare, {invitePath} from './RoomShare';
const noop=()=>{};
const socket={on:noop,off:noop,emit:noop};

// Never load a stored player/host credential on a public spectator link.
export default function WatchPage({code}) {
  const [snapshot,setSnapshot]=useState(null),[error,setError]=useState(''),[missing,setMissing]=useState(false),[epoch,setEpoch]=useState(0);
  const boundary=useRef(createObservationBoundary());
  useEffect(()=>{
    const abort=new AbortController();let timer,stopped=false;
    async function poll(){
      try {
        const response=await fetch(`/api/rooms/${encodeURIComponent(code)}/watch`,{signal:abort.signal});
        const next=await response.json();
        if(!response.ok){if(response.status===404){setMissing(true);stopped=true;}throw Error(next.error||'The live table is unavailable.');}
        if(['won','ended','closed'].includes(next.status)&&next.replayId){window.location.replace(`/replay/${encodeURIComponent(next.replayId)}`);stopped=true;return;}
        setSnapshot(current=>isOlderObservation(current,next)?current:next);setEpoch(boundary.current.accept());setError('');
      }catch(error){if(error.name==='AbortError')return;boundary.current.interrupt();setError(error.message);}
      if(!abort.signal.aborted&&!stopped)timer=setTimeout(poll,2000);
    }
    poll();return()=>{abort.abort();clearTimeout(timer);};
  },[code]);
  const state=snapshot?.gameState;
  return <main className="room-app watch-page">
    <header className="room-session-bar"><a className="room-link-button" href="/">Catan Online</a><div className="room-session-status"><strong>{code}</strong><span>Live spectator</span></div><RoomShare code={code}/><a className="room-link-button" href={invitePath(code)}>Join as a player</a></header>
    {error&&<div className="room-error" role="status">{error}{!missing&&' Reconnecting…'}</div>}
    {state?<GameBoard socket={socket} gameState={state} playerId={null} gameCode={code} chatMessages={snapshot.chat||[]} onLeaveGame={()=>window.location.assign('/')} addNotification={noop} events={snapshot.events} slots={snapshot.slots} rollEvent={snapshot.rollEvent} cardEvents={snapshot.cardEvents} paused={snapshot.paused} readOnlyChat presentationKey={`${code}:watch:${epoch}`}/>:<section className="watch-waiting"><PresentationControls/><h1>{missing?'Room not found':snapshot?'Waiting for the table':'Opening the table…'}</h1>{snapshot&&<><p>{snapshot.slots.filter(seat=>seat.occupied).length} of {snapshot.slots.length} seats filled. The host will start when everyone is ready.</p><ul>{snapshot.slots.map(seat=><li key={seat.id}><strong>{seat.name}</strong><span>{seat.occupied?(seat.ready?'Ready':'Getting ready'):'Open seat'}</span></li>)}</ul><p>You can leave this page open. It will show the game when it starts and the replay when it ends.</p></>}</section>}
  </main>;
}
