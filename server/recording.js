import {playerView} from './actions.js';
import {roomGameOptions,rulesVersionFor,baseGameOptions} from './gameOptions.js';

export const RECORDING_FORMAT_VERSION=1;
export const RECORDING_RULES_VERSION='catan-rules-1';
export const RECORDING_PROJECTION_VERSION=1;
export const CHECKPOINT_INTERVAL=50;

const clone=value=>value==null?value:structuredClone(value);
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const pointer=value=>String(value).replaceAll('~','~0').replaceAll('/','~1');

/** RFC 6902-compatible changes. Arrays are replaced as units to keep application reliable. */
export function createPatch(before,after,path='') {
  if(equal(before,after))return [];
  if(Array.isArray(before)||Array.isArray(after)||before===null||after===null||typeof before!=='object'||typeof after!=='object') {
    return [{op:before===undefined?'add':after===undefined?'remove':'replace',path,value:clone(after)}];
  }
  const patch=[];
  for(const key of Object.keys(before))if(!Object.hasOwn(after,key))patch.push({op:'remove',path:`${path}/${pointer(key)}`});
  for(const key of Object.keys(after)) {
    const next=`${path}/${pointer(key)}`;
    if(!Object.hasOwn(before,key))patch.push({op:'add',path:next,value:clone(after[key])});
    else patch.push(...createPatch(before[key],after[key],next));
  }
  return patch;
}

export function applyPatch(document,patch=[]) {
  let result=clone(document);
  for(const operation of patch) {
    if(operation.path==='') {result=operation.op==='remove'?undefined:clone(operation.value);continue;}
    const parts=operation.path.slice(1).split('/').map(part=>part.replaceAll('~1','/').replaceAll('~0','~'));
    let parent=result;
    for(const part of parts.slice(0,-1))parent=parent[part];
    const key=parts.at(-1);
    if(operation.op==='remove')Array.isArray(parent)?parent.splice(Number(key),1):delete parent[key];
    else parent[key]=clone(operation.value);
  }
  return result;
}

function sanitizeSlot(slot) {
  const clean={id:slot.id,name:slot.name,kind:slot.kind,provider:slot.provider||null,model:slot.model||null,
    generation:slot.generation||0,ready:!!slot.ready};
  if(slot.kind==='ai') {
    clean.ai={paused:!!slot.aiPaused,status:slot.runnerLease?.status||'stopped',
      ...(slot.runnerLease?.error?{error:'AI runner reported an error'}:{})};
    clean.chat={enabled:slot.chatEnabled!==false,model:slot.chatModel||slot.model||null,reasoning:slot.chatReasoning||null};
  }
  return clean;
}

/** Full authoritative replay state, deliberately excluding auth and idempotency envelopes. */
export function captureState(room) {
  return {
    gameOptions:roomGameOptions(room),
    ...(room.boardPreview?{boardPreview:clone(room.boardPreview)}:{}),
    gameState:clone(room.game),slots:(room.slots||[]).map(sanitizeSlot),trade:clone(room.trade),paused:!!room.paused,
    chat:clone(room.chat||[]),cardEvents:clone(room.cardEvents||[]),lastRoll:clone(room.lastRoll||null)
  };
}

export function recordingStatus(room) {
  if(room.game?.phase==='finished')return room.game.winner?'won':'ended';
  if(!room.game)return 'lobby';
  if(room.interrupted)return 'interrupted';
  return room.paused?'paused':'ongoing';
}

function playerMetadata(room) {
  return (room.slots||[]).map((slot,index)=>({id:slot.id,name:slot.name,color:room.game?.players?.find(player=>player.id===slot.id)?.color||null,
    kind:slot.kind,provider:slot.provider||null,model:slot.model||null,seat:index+1}));
}

export function createRecording(room,{id,now,partial=false,sample=false,title}={}) {
  const state=captureState(room),status=recordingStatus(room);
  return {id,roomCode:room.code,title:title||room.name||'Catan match',formatVersion:RECORDING_FORMAT_VERSION,
    rulesVersion:rulesVersionFor(roomGameOptions(room)),gameOptions:roomGameOptions(room),projectionVersion:RECORDING_PROJECTION_VERSION,status,partial:!!partial,sample:!!sample,
    createdAt:now,startedAt:room.game?now:null,endedAt:['won','ended'].includes(status)?now:null,lastAt:now,lastSeq:0,lastElapsedMs:0,
    turn:0,winnerId:room.game?.winner||null,players:playerMetadata(room),initialState:state,latestState:state,events:[]};
}

const pick=(payload,names)=>Object.fromEntries(names.filter(name=>Object.hasOwn(payload,name)).map(name=>[name,clone(payload[name])]));
const safeEventPayload=(type,payload,room)=> {
  if(!payload||typeof payload!=='object'||Array.isArray(payload))return null;
  if(type==='aiHeartbeat')return {status:payload.status,...(payload.error?{error:'AI runner reported an error'}:{})};
  if(type==='configureGame')return {seatCount:room.slots.length,gameOptions:roomGameOptions(room)};
  if(['configureSeat','removeController'].includes(type)) {
    const slot=room.slots.find(candidate=>candidate.id===payload.seatId);
    if(!slot)return null;
    return {seatId:slot.id,kind:slot.kind,...(slot.kind==='ai'?{
      provider:slot.provider,model:slot.model,chatEnabled:slot.chatEnabled,
      chatModel:slot.chatModel,chatReasoning:slot.chatReasoning
    }:{})};
  }
  const fields={
    placePort:['edgeKey'],claimWonder:['wonderId'],placeShip:['edgeKey'],moveShip:['fromEdgeKey','toEdgeKey'],movePirate:['hexKey','stealFromPlayerId','stealType'],resolveSeafarersChoice:['choiceId','optionId'],
    join:['role','seatId','kind','provider','model'],configureSeat:['seatId','kind','provider','model','chatEnabled','chatModel','chatReasoning'],
    removeController:['seatId','kind','provider','model','chatEnabled','chatModel','chatReasoning'],chat:['message'],aiChatReply:['replyToSequence','message'],
    aiPause:['seatId'],aiResume:['seatId'],aiCancel:['seatId'],placeSettlement:['vertexKey'],placeRoad:['edgeKey'],upgradeToCity:['vertexKey'],
    discardCards:['resources'],moveRobber:['hexKey','stealFromPlayerId'],chooseRobberCard:['cardId'],playDevCard:['cardType','params'],
    yearOfPlentyPick:['resource'],bankTrade:['giveResource','giveAmount','getResource'],tradeOffer:['to','give','get'],tradeCounter:['tradeId','to','give','get'],
    tradeAccept:['tradeId'],tradeReject:['tradeId'],tradeConfirm:['tradeId'],tradeCancel:['tradeId']
  }[type];
  if(!fields)return null;
  const clean=pick(payload,fields);
  if(type==='playDevCard') {
    if(clean.cardType==='monopoly')clean.params={resource:payload.params.resource};
    else delete clean.params;
  }
  if((type==='chat'||type==='aiChatReply')&&typeof clean.message==='string')clean.message=clean.message.trim();
  return Object.keys(clean).length?clean:null;
};

export function advanceRecording(recording,room,{type,actorSeatId=null,actorGeneration=null,actorName=null,summary='',payload=null,at}={}) {
  const state=captureState(room),seq=recording.lastSeq+1;
  const elapsedMs=Math.max(recording.lastElapsedMs,Number.isFinite(at)?Math.max(0,at-recording.createdAt):recording.lastElapsedMs);
  // Count production turns, not the extra action phase within a paired turn.
  const turn=recording.turn+(['endTurn','attackFortress'].includes(type)&&room.game?.turnRole!=='paired'?1:0);
  const cleanPayload=safeEventPayload(type,payload,room);
  const event={seq,at,elapsedMs,turn,type,actorSeatId,actorGeneration,actorName,summary,
    ...(cleanPayload?{payload:cleanPayload}:{}),patch:createPatch(recording.latestState,state)};
  const status=recordingStatus(room),terminal=['won','ended'].includes(status);
  const next={...recording,status,lastAt:at,lastSeq:seq,lastElapsedMs:elapsedMs,turn,winnerId:room.game?.winner||null,
    gameOptions:roomGameOptions(room),rulesVersion:rulesVersionFor(roomGameOptions(room)),
    startedAt:recording.startedAt||(room.game?at:null),endedAt:terminal?(recording.endedAt||at):null,
    players:playerMetadata(room),latestState:state};
  if(recording.events)next.events=[...recording.events,event];
  return {recording:next,event,checkpoint:(seq%CHECKPOINT_INTERVAL===0||terminal)?{seq,state}:null};
}

function projectCardEvents(events,access) {
  if(access.full)return clone(events||[]);
  return (events||[]).map(event=>{
    const grouped=new Map(),transfers=[];
    for(const transfer of event.transfers||[]) {
      const involved=access.seatId&&(transfer.from===access.seatId||transfer.to===access.seatId);
      const owns=involved&&(access.ownsSeatHistory||event.audienceGenerations?.[access.seatId]===access.generation);
      if(owns||transfer.resource==='development')transfers.push(clone(transfer));
      else {
        const key=`${transfer.from}:${transfer.to}`,prior=grouped.get(key);
        if(prior)prior.count+=transfer.count;
        else {const publicTransfer={from:transfer.from,to:transfer.to,count:transfer.count};grouped.set(key,publicTransfer);transfers.push(publicTransfer);}
      }
    }
    return {id:event.id,sequence:event.sequence,revision:event.revision,type:event.type,...(event.rollId?{rollId:event.rollId}:{}),transfers};
  });
}

export function projectState(state,access={}) {
  const copy=clone(state),historicalSlot=copy.slots?.find(slot=>slot.id===access.seatId);
  copy.gameOptions=copy.gameOptions??copy.gameState?.gameOptions??baseGameOptions();
  const ownsGeneration=access.seatId&&(access.ownsSeatHistory||historicalSlot?.generation===access.generation);
  if(copy.gameState&&!access.full)copy.gameState=playerView(copy.gameState,ownsGeneration?access.seatId:undefined);
  copy.cardEvents=projectCardEvents(copy.cardEvents,{...access,seatId:ownsGeneration?access.seatId:null});
  if(copy.lastRoll&&!access.full)copy.lastRoll={id:copy.lastRoll.id,roll:copy.lastRoll.roll,
    gains:ownsGeneration&&(access.ownsSeatHistory||copy.lastRoll.audienceGenerations?.[access.seatId]===access.generation)?clone(copy.lastRoll.gainsBySeat?.[access.seatId]||{}):{}};
  return copy;
}

export function projectEvent(event,access={}) {
  const projected={seq:event.seq,at:event.at,elapsedMs:event.elapsedMs,turn:event.turn,type:event.type,
    actorSeatId:event.actorSeatId,actorName:event.actorName,summary:event.summary};
  if(!event.payload)return projected;
  if(access.full||(access.seatId===event.actorSeatId&&(access.ownsSeatHistory||access.generation===event.actorGeneration)))projected.payload=clone(event.payload);
  else if(event.type==='discardCards')projected.payload={count:Object.values(event.payload.resources||{}).reduce((sum,count)=>sum+count,0)};
  else if(!['chooseRobberCard','yearOfPlentyPick','resolveSeafarersChoice'].includes(event.type))projected.payload=clone(event.payload);
  return projected;
}

export function reconstruct(recording,events,at,checkpoint=null) {
  const target=at==null?recording.lastSeq:Math.max(0,Math.min(recording.lastSeq,Number(at)||0));
  let state=clone(checkpoint?.state||recording.initialState),seq=checkpoint?.seq||0;
  for(const event of events||[]) {
    if(event.seq<=seq)continue;
    if(event.seq>target)break;
    state=applyPatch(state,event.patch);seq=event.seq;
  }
  return {state,seq};
}

function counts(player) {
  return {...(typeof player.ships==='number'?{ships:15-player.ships}:{}),roads:15-(player.roads||0),longestRoad:player.roadLength||0,settlements:5-(player.settlements||0),cities:4-(player.cities||0)};
}

export function metrics(recording,events,access) {
  let state=clone(recording.initialState);
  const points=[];
  const append=(seq,elapsedMs,turn)=>{
    if(!state.gameState)return;
    const historicalSlots=new Map((state.slots||[]).map(slot=>[slot.id,slot]));
    const game=state.gameState,playerId=index=>game.players?.[index]?.id||null;
    points.push({seq,elapsedMs,turn,phase:game.phase,turnPhase:game.turnPhase,
      turnRole:game.turnRole||'primary',productionPlayerId:playerId(game.pairedTurnRules?game.productionPlayerIndex:game.currentPlayerIndex),
      currentPlayerId:playerId(game.currentPlayerIndex),longestRoadPlayerId:playerId(game.longestRoadPlayer),
      largestArmyPlayerId:playerId(game.largestArmyPlayer),winnerId:game.winner||null,
      players:(game.players||[]).map(player=>{
      const visible=access.full||(access.seatId===player.id&&(access.ownsSeatHistory||historicalSlots.get(player.id)?.generation===access.generation));
      return {id:player.id,publicVP:player.victoryPoints||0,...(visible?{totalVP:(player.victoryPoints||0)+(player.hiddenVictoryPoints||0)}:{}),...counts(player)};
    })});
  };
  append(0,0,0);
  for(const event of events||[]){state=applyPatch(state,event.patch);append(event.seq,event.elapsedMs,event.turn);}
  return points;
}

export function publicMetadata(recording) {
  return {id:recording.id,title:recording.title,roomCode:recording.roomCode,status:recording.status,partial:!!recording.partial,
    sample:!!recording.sample,createdAt:recording.createdAt,startedAt:recording.startedAt,endedAt:recording.endedAt,lastSeq:recording.lastSeq,
    elapsedMs:recording.lastElapsedMs,turn:recording.turn,winnerId:recording.winnerId,players:clone(recording.players),
    gameOptions:clone(recording.gameOptions??baseGameOptions()),
    formatVersion:recording.formatVersion,rulesVersion:recording.rulesVersion,projectionVersion:recording.projectionVersion};
}
