import {randomBytes,randomUUID,createHash} from 'node:crypto';
import * as G from './gameLogic.js';
import {executeAction,playerView,legalActions} from './actions.js';
import {PROVIDERS} from './providers.js';
import {appendCardEvent,projectCardEvents} from './cardEvents.js';
import {REASONING_VALUES,initializeAiSlot,leaseIsLive,fenceAiCommand,claimRunnerLease,heartbeatRunner,applyAiControl,projectAiStatus} from './aiControl.js';
import {createRecording,advanceRecording,recordingStatus,publicMetadata,projectState,projectEvent,reconstruct,metrics,createPatch,applyPatch} from './recording.js';
import {negotiationState,syncNegotiationTurn,negotiationOpportunity,prepareNegotiation,readNegotiations,recordAiTradeAction} from './negotiation.js';
import {validateGameOptions,roomGameOptions,rulesVersionFor,canTradeWithPlayers} from './gameOptions.js';

const secret=()=>randomBytes(32).toString('base64url');
const hash=value=>createHash('sha256').update(value).digest('hex');
const clone=value=>structuredClone(value);
const fail=(error,statusCode=400)=>({success:false,error,statusCode});
const resourceNames=['brick','lumber','wool','grain','ore'];
const cleanName=value=>typeof value==='string' && value.trim().length>0 && value.trim().length<=40 ? value.trim() : null;
const pack=value=>value && typeof value==='object' && !Array.isArray(value) && Object.keys(value).every(k=>resourceNames.includes(k)) && Object.values(value).every(n=>Number.isSafeInteger(n)&&n>=0&&n<=95) && Object.values(value).some(n=>n>0);
const affordable=(p,amounts)=>Object.entries(amounts).every(([r,n])=>p.resources[r]>=n);

export class RoomService {
  constructor({store,maxActive=1,providers=PROVIDERS,now=Date.now}={}) {
    this.store=store;this.durableJournal=store?.durableRecordingJournal===true;this.maxActive=maxActive;this.providers=providers;this.now=now;this.rooms=new Map();this.recordings=new Map();this.presence=new Map();this.aiToolActivity=new Map();this.legalCache=new Map();
    for(const room of store?.load()||[]) {
      const recovered=room.game&&['setup','playing'].includes(room.game.phase);
      if(recovered){room.paused=true;room.interrupted=true;}
      for(const slot of room.slots)if(slot.kind==='ai')initializeAiSlot(slot);
      let chatSequence=0;
      for(const message of room.chat||[]) {
        message.sequence=Number.isSafeInteger(message.sequence)&&message.sequence>chatSequence?message.sequence:chatSequence+1;
        message.authorRole=message.authorRole||'human';chatSequence=message.sequence;
      }
      room.chatSequence=Math.max(room.chatSequence||0,chatSequence);
      room.negotiationState=negotiationState(room);
      if(!room.recordingId)room.recordingId=secret();
      this.rooms.set(room.code,room);
      const existing=this.recordingFor(room.recordingId);
      if(!existing) {
        const recording=createRecording(room,{id:room.recordingId,now:this.now(),partial:true,title:room.name});
        this.persistRecording(room,recording,{type:'partialBaseline',summary:'Recording began from a saved room'});
      } else if(recovered)this.persist(room,{type:'crashgap',summary:'Server recovery paused the active match'});
    }
  }
  roomFor(code){return this.rooms.get(code)||this.store?.loadRoom?.(code)||null;}
  retainRoom(room) {
    if(this.durableJournal&&['won','ended'].includes(recordingStatus(room))) {
      this.rooms.delete(room.code);this.recordings.delete(room.recordingId);this.legalCache.delete(room.code);
      for(const key of Object.keys(room.members))this.presence.delete(key);
      for(const key of this.aiToolActivity.keys())if(key.startsWith(`${room.code}:`))this.aiToolActivity.delete(key);
    } else this.rooms.set(room.code,room);
  }
  recordingFor(id){return this.recordings.get(id)||this.store?.getRecording?.(id)||null;}
  eventsFor(id,options={}){
    if(this.durableJournal)return this.store.getRecordingEvents(id,options);
    const recording=this.recordings.get(id);
    return recording?.events?recording.events.filter(event=>event.seq>(options.after||0)).slice(0,options.limit??Infinity):this.store?.getRecordingEvents?.(id,options)||[];
  }
  persistRecording(room,recording,eventSpec) {
    // Durable event/checkpoint history stays in SQLite; only active snapshots are cached.
    const baseline=this.durableJournal?{...recording,events:undefined,checkpoints:undefined}:recording;
    const mutation=advanceRecording(baseline,room,{...eventSpec,at:this.now()});
    this.store?.save(room,mutation);
    if(!this.durableJournal&&recording.events&&mutation.checkpoint)mutation.recording.checkpoints=[...(recording.checkpoints||[]),mutation.checkpoint];
    this.recordings.set(recording.id,mutation.recording);this.retainRoom(room);this.legalCache.delete(room.code);
    return mutation.recording;
  }
  persist(room,eventSpec=null){
    if(eventSpec) {
      const recording=this.recordingFor(room.recordingId);
      if(!recording)throw Error('Recording is unavailable');
      this.persistRecording(room,recording,eventSpec);return;
    }
    this.store?.save(room);this.retainRoom(room);this.legalCache.delete(room.code);
  }
  persistRuntime(room,eventSpec=null){
    if(eventSpec)return this.persist(room,eventSpec);
    this.store?.save(room);this.retainRoom(room);
  }
  authenticate(room,token){return typeof token==='string'&&token.length<=200 ? room.members[hash(token)] : undefined;}
  aiConfiguration(input,existing={},providerId) {
    const chatEnabled=input.chatEnabled??existing.chatEnabled??true;
    const rawModel=Object.hasOwn(input,'chatModel')?input.chatModel:(existing.chatModel??null);
    const rawReasoning=Object.hasOwn(input,'chatReasoning')?input.chatReasoning:(existing.chatReasoning??null);
    if(typeof chatEnabled!=='boolean')return null;
    const chatModel=rawModel==null||rawModel===''?null:cleanName(rawModel);
    const chatReasoning=rawReasoning==null||rawReasoning===''?null:rawReasoning;
    if((rawModel!=null&&rawModel!==''&&!chatModel)||(chatReasoning!==null&&!REASONING_VALUES.has(chatReasoning)))return null;
    if(chatModel&&!this.provider(providerId,chatModel,providerId))return null;
    return {chatEnabled,chatModel,chatReasoning};
  }
  aiActor(room,token) {
    const member=this.authenticate(room,token),key=typeof token==='string'?hash(token):null;
    const slot=member?.role==='ai'?room.slots.find(candidate=>candidate.id===member.seatId&&candidate.controller===key&&candidate.generation===member.generation):null;
    return slot?{member,slot,key}:null;
  }
  markAiTool(room,member) {
    const slot=room.slots.find(candidate=>candidate.id===member.seatId);
    if(slot&&(!this.durableJournal||!['won','ended'].includes(recordingStatus(room)))&&!leaseIsLive(slot,this.now()))this.aiToolActivity.set(`${room.code}:${slot.id}:${slot.generation}`,{lastActivityAt:this.now()});
  }
  toolActivity(room,slot){return this.aiToolActivity.get(`${room.code}:${slot.id}:${slot.generation}`)||null;}
  cachedLegalActions(room,member) {
    let roomCache=this.legalCache.get(room.code);
    if(!roomCache){roomCache=new Map();this.legalCache.set(room.code,roomCache);}
    const cacheKey=`${room.revision}:${member.seatId}:${member.generation}`;
    if(!roomCache.has(cacheKey)) {
      roomCache.set(cacheKey,legalActions(room.game,member.seatId));
      if(roomCache.size>16)roomCache.delete(roomCache.keys().next().value);
    }
    return clone(roomCache.get(cacheKey));
  }
  provider(provider,model,requiredProvider=null,requiredModel=null) {
    const definition=typeof provider==='string'?Object.entries(this.providers).find(([key,value])=>key===provider||value.id===provider)?.[1]:null;
    const selectedModel=model==null||model===''?null:cleanName(model);
    if(!definition||((model!=null&&model!=='')&&!selectedModel))return null;
    if(requiredProvider&&definition.id!==requiredProvider)return null;
    if(requiredModel&&selectedModel!==requiredModel)return null;
    if(Array.isArray(definition.models)&&selectedModel&&!definition.models.includes(selectedModel))return null;
    if(definition.modelSelection===false&&selectedModel)return null;
    return {provider:definition.id,model:selectedModel};
  }
  create(options={}) {
    if(!options||typeof options!=='object'||Array.isArray(options))return fail('Invalid room configuration');
    const {name,seatCount=3,seats,sample=false,title}=options;
    if(!cleanName(name)) return fail('Enter a room name');
    const configuration=validateGameOptions(options.gameOptions,seatCount);
    if(!configuration.success)return fail(configuration.error);
    if(seats!==undefined&&!Array.isArray(seats))return fail('Seats must be an array');
    if(seats?.length>seatCount)return fail('Too many seat configurations');
    if(seats?.some(seat=>!seat||typeof seat!=='object'||Array.isArray(seat)))return fail('Invalid seat configuration');
    if([...this.rooms.values()].filter(room=>!['won','ended'].includes(recordingStatus(room))).length>=50) return fail('Room capacity reached',429);
    let code;do {code=randomBytes(5).toString('hex').slice(0,8).toUpperCase();}while(this.rooms.has(code)||this.store?.hasRoom?.(code));
    const token=secret();
    const slots=[];
    for(let i=0;i<seatCount;i++) {
      const configured=seats?.[i]||{},kind=configured.kind||'human';
      if(!['human','ai'].includes(kind))return fail('Invalid seat controller type');
      let provider=null,model=null;
      if(kind==='ai') {
        const selected=this.provider(configured.provider||Object.keys(this.providers)[0],configured.model);
        if(!selected)return fail('Invalid AI provider or model');
        ({provider,model}=selected);
      }
      const slot={id:randomUUID(),kind,provider,model,generation:0,controller:null,ready:false,name:`Seat ${i+1}`};
      if(kind==='ai') {
        const configuration=this.aiConfiguration(configured,{},provider);
        if(!configuration)return fail('Invalid AI chat configuration');
        initializeAiSlot(slot,configuration);
      }
      slots.push(slot);
    }
    const room={code,recordingId:secret(),revision:0,name:cleanName(name),gameOptions:configuration.gameOptions,slots,members:{[hash(token)]:{role:'host',name:cleanName(name)}},game:null,trade:null,chat:[],chatSequence:0,receipts:{},cardEventSequence:0,cardEvents:[],paused:false,interrupted:false};
    const recording=createRecording(room,{id:room.recordingId,now:this.now(),sample:sample===true,title:cleanName(title)||room.name});
    this.persistRecording(room,recording,{type:'lobbyCreated',actorName:room.name,summary:`${room.name} created the lobby`});
    return {success:true,code,token,role:'host',replayId:room.recordingId};
  }
  join(code,options={}) {
    const normalizedCode=typeof code==='string'?code.toUpperCase():code;
    const room=this.roomFor(normalizedCode);if(!room)return fail('Room not found',404);
    if(!options||typeof options!=='object'||Array.isArray(options))return fail('Invalid join request');
    const {name,role='spectator',seatId,provider,model}=options;
    if(!cleanName(name)||!['human','ai','spectator'].includes(role))return fail('Invalid name or role');
    if(Object.keys(room.members).length>=100)return fail('Room member capacity reached',429);
    const copy=clone(room),token=secret(),key=hash(token);
    const member={role,name:cleanName(name)};let joinedSlot=null;
    if(role!=='spectator') {
      const slot=copy.slots.find(s=>(!seatId||s.id===seatId)&&s.kind===role&&!s.controller);
      if(!slot)return fail('No matching vacant seat',409);
      joinedSlot=slot;
      let selected=null;
      if(role==='ai') {
        selected=this.provider(provider,model,slot.provider,slot.model);
        if(!selected)return fail('This seat requires its configured provider and model');
        slot.provider=selected.provider;slot.model=selected.model;
        initializeAiSlot(slot);
      }
      slot.generation++;slot.controller=key;slot.ready=false;slot.name=member.name;
      Object.assign(member,{seatId:slot.id,generation:slot.generation,provider:selected?.provider||null,model:selected?.model||null});
      if(copy.game){const player=copy.game.players.find(p=>p.id===slot.id);if(!player)return fail('Seat is not part of this game',409);player.name=member.name;}
    }
    copy.members[key]=member;copy.revision++;this.persist(copy,{type:'join',actorSeatId:member.seatId||null,actorGeneration:member.generation||null,
      actorName:member.name,summary:member.seatId?`${member.name} joined a playing seat`:`${member.name} joined as a spectator`,
      payload:{role,seatId:member.seatId||null,kind:role,provider:member.provider||null,model:member.model||null}});
    return {success:true,code:normalizedCode,token,role,seatId:member.seatId,generation:member.generation,
      replayId:copy.recordingId,...(role==='ai'?{controlEpoch:joinedSlot.controlEpoch}:{})};
  }
  observe(code,token) {
    code=typeof code==='string'?code.toUpperCase():code;
    const room=this.roomFor(code);if(!room)return fail('Room not found',404);
    const member=this.authenticate(room,token);if(!member)return fail('Controller credential is invalid or revoked',401);
    const key=hash(token),now=this.now();
    if(!this.durableJournal||!['won','ended'].includes(recordingStatus(room)))this.presence.set(key,now);
    if(member.role==='ai')this.markAiTool(room,member);
    const ownSlot=member.seatId?room.slots.find(slot=>slot.id===member.seatId):null;
    const gameState=room.game?clone(playerView(room.game,member.seatId)):null;
    const choices=room.game&&room.game.phase!=='finished'&&!room.paused&&member.seatId?this.cachedLegalActions(room,member):[];
    let decision=null;
    if(room.game&&!room.paused&&member.seatId){
      const index=room.game.players.findIndex(p=>p.id===member.seatId);
      const discard=room.game.discardingPlayers?.find(d=>d.playerIndex===index);
      if(discard)decision={type:'discardCards',count:discard.cardsToDiscard,resources:clone(room.game.players[index].resources)};
      else if(choices.length)decision={type:'chooseAction'};
    }
    const pending=room.game?.pendingRobberPick;
    const robberPick=pending?{id:pending.id,thiefId:pending.thiefId,victimId:pending.victimId,count:pending.cards.length,
      ...(member.seatId===pending.thiefId?{cardIds:pending.cards.map(card=>card.id)}:{})}:null;
    const slots=room.slots.map(slot=>{
      const {controller,runnerLease,lastAiReplyAt,lastAiReplyToSequence,...publicSlot}=slot;
      return {...publicSlot,occupied:!!controller,connected:!!controller&&now-(this.presence.get(controller)||0)<15000,
        ...(slot.kind==='ai'?{ai:projectAiStatus(slot,now,this.toolActivity(room,slot))}:{})};
    });
    const ownAi=member.role==='ai'&&ownSlot?{...projectAiStatus(ownSlot,now,this.toolActivity(room,ownSlot)),
      ...(ownSlot.runnerLease?.runId?{runnerRunId:ownSlot.runnerLease.runId}:{})}:null;
    const publicChat=(room.chat||[]).map((message,index)=>({...message,sequence:message.sequence??index+1,authorRole:message.authorRole||'human'}));
    return {success:true,code,replayId:room.recordingId,revision:room.revision,role:member.role,host:member.role==='host',seatId:member.seatId||null,generation:member.generation||0,
      paused:room.paused,gameOptions:roomGameOptions(room),slots,ai:ownAi,controlEpoch:ownAi?.controlEpoch,
      negotiation:member.role==='ai'&&ownSlot?negotiationOpportunity(room,ownSlot,now):null,
      gameState,legalActions:choices,decision,trade:clone(room.trade),events:clone(room.events||[]),chat:member.role==='ai'?[]:clone(publicChat),
      rollEvent:room.lastRoll?{id:room.lastRoll.id,roll:clone(room.lastRoll.roll),gains:clone(room.lastRoll.audienceGenerations?.[member.seatId]===member.generation?room.lastRoll.gainsBySeat[member.seatId]||{}:{})}:null,
      robberPick,cardEvents:projectCardEvents(room,member),cardEventSequence:room.cardEventSequence||0};
  }
  command(code,token,command={}) {
    code=typeof code==='string'?code.toUpperCase():code;
    const room=this.roomFor(code);if(!room)return fail('Room not found',404);
    const member=this.authenticate(room,token);if(!member)return fail('Controller credential is invalid or revoked',401);
    if(!command||typeof command!=='object'||Array.isArray(command))return fail('Invalid command envelope');
    const {requestId,revision,generation,controlEpoch,runId,type,payload={}}=command;
    if(typeof requestId!=='string'||requestId.length<1||requestId.length>100||typeof type!=='string'||!payload||typeof payload!=='object'||Array.isArray(payload))return fail('Invalid command envelope');
    const key=hash(token),receiptKey=`${key}:${requestId}`;
    let fingerprint;
    try {fingerprint=hash(JSON.stringify({type,payload,generation,controlEpoch,runId}));}
    catch {return fail('Invalid command envelope');}
    if(room.receipts[receiptKey])return room.receipts[receiptKey].fingerprint===fingerprint?clone(room.receipts[receiptKey].result):fail('Request ID already used for another command',409);
    if(revision!==room.revision)return fail('Game changed; observe before acting',409);
    if(member.seatId && generation!==member.generation)return fail('Seat controller changed',409);
    const copy=clone(room),beforeGame=room.game?clone(room.game):null;let result={success:true};
    try {
      const hostTypes=['configureGame','configureSeat','start','removeController','pause','resume','endGame'];
      if(hostTypes.includes(type)&&member.role!=='host')return fail('Only the host can do that',403);
      const slot=copy.slots.find(s=>s.id===member.seatId);
      const aiControlType=['aiPause','aiResume','aiCancel'].includes(type);
      if(member.role==='ai'&&aiControlType) {
        if(payload.seatId!==member.seatId||!slot||slot.controller!==key||slot.generation!==member.generation)return fail('You cannot control that AI seat',403);
        if(!Number.isSafeInteger(controlEpoch)||controlEpoch!==slot.controlEpoch)return fail('AI control changed; observe before acting',409);
      } else if(member.role==='ai') {
        const fenced=fenceAiCommand(slot,{controlEpoch,runId},this.now());
        if(!fenced.success)return fenced;
      }
      if(['aiPause','aiResume','aiCancel'].includes(type)) {
        const target=copy.slots.find(candidate=>candidate.id===payload.seatId&&candidate.kind==='ai');
        if(!target)return fail('Choose an AI seat');
        if(!target.controller)return fail('AI seat has no attached controller');
        if(member.role!=='host'&&member.seatId!==target.id)return fail('You cannot control that AI seat',403);
        result=applyAiControl(target,{aiPause:'pause',aiResume:'resume',aiCancel:'cancel'}[type],this.now());
      } else if(type==='configureGame') {
        if(copy.game)return fail('Game options are locked after start');
        if(Object.keys(payload).some(key=>!['seatCount','gameOptions'].includes(key)))return fail('Invalid game configuration');
        const seatCount=payload.seatCount??copy.slots.length;
        const configuration=validateGameOptions(Object.hasOwn(payload,'gameOptions')?payload.gameOptions:roomGameOptions(copy),seatCount);
        if(!configuration.success)return fail(configuration.error);
        if(copy.slots.slice(seatCount).some(seat=>seat.controller))return fail('Release occupied seats before reducing the player count',409);
        const changed=seatCount!==copy.slots.length||JSON.stringify(configuration.gameOptions)!==JSON.stringify(roomGameOptions(copy));
        copy.slots=copy.slots.slice(0,seatCount);
        while(copy.slots.length<seatCount)copy.slots.push({id:randomUUID(),kind:'human',provider:null,model:null,generation:0,controller:null,ready:false,name:`Seat ${copy.slots.length+1}`});
        copy.gameOptions=configuration.gameOptions;
        if(changed)for(const seat of copy.slots)seat.ready=false;
      } else if(type==='configureSeat') {
        if(copy.game)return fail('Seats are locked after start');
        const target=copy.slots.find(s=>s.id===payload.seatId);
        if(!target||target.controller||!['human','ai'].includes(payload.kind))return fail('Choose a vacant seat and a valid controller type');
        let selected={provider:null,model:null};
        if(payload.kind==='ai') {
          selected=this.provider(payload.provider||Object.keys(this.providers)[0],payload.model);
          if(!selected)return fail('Invalid AI provider or model');
        }
        Object.assign(target,{kind:payload.kind,provider:selected.provider,model:selected.model});
        if(payload.kind==='ai') {
          const configuration=this.aiConfiguration(payload,target,selected.provider);
          if(!configuration)return fail('Invalid AI chat configuration');
          initializeAiSlot(target,configuration);
        } else {
          delete target.controlEpoch;delete target.aiPaused;delete target.chatEnabled;delete target.chatModel;delete target.chatReasoning;delete target.runnerLease;
        }
      } else if(type==='start') {
        if(copy.game)return fail('Game already started');
        const invalidSeat=copy.slots.some(s=>!s.controller||!s.ready||copy.members[s.controller]?.seatId!==s.id||copy.members[s.controller]?.generation!==s.generation);
        if(invalidSeat)return fail('Every seat must be occupied and ready');
        if([...this.rooms.values()].filter(r=>r.game&&['setup','playing'].includes(r.game.phase)).length>=this.maxActive)return fail('Another game is active',409);
        const configuration=validateGameOptions(roomGameOptions(copy),copy.slots.length);
        if(!configuration.success)return fail(configuration.error);
        copy.gameOptions=configuration.gameOptions;
        copy.game=G.createGame(code,{id:copy.slots[0].id,name:copy.slots[0].name},copy.gameOptions.extension56);
        copy.game.gameOptions=clone(copy.gameOptions);
        copy.game.rulesVersion=rulesVersionFor(copy.gameOptions);
        for(const s of copy.slots.slice(1)){
          const added=G.addPlayer(copy.game,{id:s.id,name:s.name});
          if(!added.success)return added;
        }
        result=G.startGame(copy.game);
        copy.interrupted=false;
      } else if(type==='ready') {
        if(copy.game)return fail('Ready state is locked after start');
        if(!slot||slot.controller!==key)return fail('Claim a playing seat first');
        if(slot.ready)return fail('Seat is already ready');
        slot.ready=true;
      } else if(type==='leave'||type==='removeController') {
        const target=type==='leave'?slot:copy.slots.find(s=>s.id===payload.seatId);
        if(!target){if(type==='leave'&&member.role!=='host')delete copy.members[key];else return fail('No seat selected');}
        else {
          if(type==='leave'&&(target.controller!==key||target.generation!==member.generation))return fail('Seat controller changed',409);
          let nextKind=target.kind,nextProvider=target.provider,nextModel=target.model;
          if(type==='removeController'&&payload.kind!==undefined) {
            if(!['human','ai'].includes(payload.kind))return fail('Invalid seat controller type');
            nextKind=payload.kind;
            if(nextKind==='ai') {
              const selected=this.provider(payload.provider||target.provider||Object.keys(this.providers)[0],payload.model??(target.kind==='ai'?target.model:null));
              if(!selected)return fail('Invalid AI provider or model');
              nextProvider=selected.provider;nextModel=selected.model;
            } else {nextProvider=null;nextModel=null;}
          }
          if(target.controller)delete copy.members[target.controller];
          target.controller=null;target.ready=false;target.generation++;
          target.kind=nextKind;target.provider=nextProvider;target.model=nextModel;
          delete target.lastAiReplyAt;delete target.lastAiReplyToSequence;
          if(nextKind==='ai') {
            const configuration=this.aiConfiguration(payload,target,nextProvider);
            if(!configuration)return fail('Invalid AI chat configuration');
            initializeAiSlot(target,configuration);target.controlEpoch++;target.runnerLease=null;
          } else {
            delete target.controlEpoch;delete target.aiPaused;delete target.chatEnabled;delete target.chatModel;delete target.chatReasoning;delete target.runnerLease;
          }
          copy.trade=null;
        }
      } else if(type==='pause'||type==='resume') {
        if(!copy.game||!['setup','playing'].includes(copy.game.phase))return fail('Game is not active');
        if(copy.paused===(type==='pause'))return fail(type==='pause'?'Game is already paused':'Game is not paused');
        copy.paused=type==='pause';
        if(type==='resume')copy.interrupted=false;
        // Fence work across even a pause/resume cycle missed by a runner poll.
        for(const aiSlot of copy.slots.filter(candidate=>candidate.kind==='ai')) {
          initializeAiSlot(aiSlot);aiSlot.controlEpoch++;
          if(aiSlot.runnerLease)aiSlot.runnerLease.controlEpoch=aiSlot.controlEpoch;
        }
      }
      else if(type==='endGame') {if(!copy.game||!['setup','playing'].includes(copy.game.phase))return fail('Game is not active');copy.game.phase='finished';copy.game.pendingRobberPick=null;copy.game.discardingPlayers=[];copy.trade=null;copy.paused=false;copy.interrupted=false;}
      else if(type==='chat') {
        if(member.role==='ai')return fail('AI connectors use structured trades');
        if(typeof payload.message!=='string'||!payload.message.trim()||payload.message.length>500)return fail('Message must contain 1–500 characters');
        copy.chatSequence=(copy.chatSequence||0)+1;
        copy.chat.push({id:randomUUID(),sequence:copy.chatSequence,authorRole:'human',playerName:member.name,playerId:member.seatId||null,message:payload.message.trim(),timestamp:this.now()});copy.chat=copy.chat.slice(-100);
      } else {
        if(!slot||!copy.game)return fail('A playing seat is required',403);
        if(slot.controller!==key||slot.generation!==member.generation)return fail('Seat controller changed',409);
        if(copy.paused)return fail('Game is paused',409);
        if(['proposeTrade','respondToTrade','cancelTrade'].includes(type))return fail('Use the structured room trade actions');
        if(type.startsWith('trade')) {
          result=this.tradeAction(copy,slot.id,type,payload);
          if(result.success&&member.role==='ai'&&['tradeOffer','tradeCounter'].includes(type))result=recordAiTradeAction(copy,slot.id);
        }
        else {
          result=executeAction(copy.game,slot.id,type,payload);
          if(result.success&&(['endTurn','moveRobber'].includes(type)||copy.game.phase!=='playing'||copy.game.turnPhase!=='main'||copy.game.freeRoads||copy.game.yearOfPlentyPicks))copy.trade=null;
          if(result.success&&copy.game.phase==='finished')copy.trade=null;
        }
      }
      if(!result.success)return result;
      syncNegotiationTurn(copy);
      // Keep exact production for presentation; observations expose only the
      // authenticated seat's receipt, never another player's hand or gains.
      if(type==='rollDice'&&result.roll)copy.lastRoll={id:randomUUID(),roll:clone(result.roll),
        audienceGenerations:Object.fromEntries(copy.slots.map(slot=>[slot.id,slot.generation])),
        gainsBySeat:Object.fromEntries(copy.game.players.map((player,index)=>[player.id,clone(result.resourceGains?.[index]||{})]))};
      copy.revision++;
      appendCardEvent(copy,beforeGame,type,type==='rollDice'?copy.lastRoll?.id:null);
      const labels={configureGame:'changed the lobby rules',ready:'readied their seat',advanceSetup:'advanced setup',chat:'sent a message',configureSeat:'configured a seat',finishFreeRoads:'finished placing free roads',yearOfPlentyPick:'chose a Year of Plenty resource',start:'started the game',placeSettlement:'built a settlement',placeRoad:'built a road',upgradeToCity:'built a city',rollDice:'rolled the dice',discardCards:'discarded cards',moveRobber:'moved the robber',chooseRobberCard:'stole a resource card',buyDevCard:'bought a development card',playDevCard:'played a development card',bankTrade:'traded with the bank',endTurn:'ended their turn',tradeOffer:'offered a trade',tradeCounter:'made a counteroffer',tradeAccept:'accepted a trade offer',tradeReject:'rejected a trade offer',tradeConfirm:'confirmed a trade',tradeCancel:'cancelled a trade',leave:'left their seat',removeController:'removed a seat controller',pause:'paused the game',resume:'resumed the game',aiPause:'paused an AI seat',aiResume:'resumed an AI seat',aiCancel:'cancelled an AI decision',endGame:'ended the game'};
      if(labels[type])copy.events=[...(copy.events||[]),{id:randomUUID(),at:this.now(),actor:member.name,type,summary:`${member.name} ${labels[type]}`}].slice(-200);
      const response={success:true,revision:copy.revision};
      // Return private effects only to the authenticated actor, never the event stream.
      if(result.card)response.card=result.card;
      if(result.roll)response.roll=clone(result.roll);
      if(result.stolenInfo)response.stolenInfo=clone(result.stolenInfo);
      copy.receipts[receiptKey]={fingerprint,result:clone(response)};
      const keys=Object.keys(copy.receipts);for(const k of keys.slice(0,Math.max(0,keys.length-2000)))delete copy.receipts[k];
      this.persist(copy,{type,actorSeatId:member.seatId||null,actorGeneration:member.generation||null,actorName:member.name,
        summary:labels[type]?`${member.name} ${labels[type]}`:`${member.name} performed ${type}`,payload});
      if(member.role==='ai')this.markAiTool(copy,member);return clone(response);
    } catch(error) {
      const storage=error?.message==='Recording is unavailable'||error?.code?.startsWith?.('SQLITE_')||error?.code?.startsWith?.('ERR_SQLITE_');
      return fail(storage?'Unable to save the accepted action':'Invalid action parameters',storage?500:400);
    }
  }
  recordedAiStatus(slot){return {status:slot.runnerLease?.status||'stopped',error:slot.runnerLease?.error?'AI runner reported an error':null};}
  aiLease(code,token,payload={}) {
    code=typeof code==='string'?code.toUpperCase():code;
    const room=this.roomFor(code);if(!room)return fail('Room not found',404);
    const member=this.authenticate(room,token);if(!member)return fail('Controller credential is invalid or revoked',401);
    if(member.role!=='ai')return fail('An AI playing seat is required',403);
    const copy=clone(room),actor=this.aiActor(copy,token);if(!actor)return fail('Seat controller changed',409);
    const wasAttached=!!actor.slot.runnerLease,previous=this.recordedAiStatus(actor.slot);
    const result=claimRunnerLease(actor.slot,payload,this.now());if(!result.success)return result;
    const changed=JSON.stringify(previous)!==JSON.stringify(this.recordedAiStatus(actor.slot));
    this.persistRuntime(copy,!wasAttached||changed?{type:'aiLease',actorSeatId:actor.slot.id,actorGeneration:actor.slot.generation,actorName:member.name,
      summary:wasAttached?`${member.name} AI status changed to ${actor.slot.runnerLease.status}`:`${member.name} attached an AI runner`}:null);return {...result,controlEpoch:actor.slot.controlEpoch};
  }
  aiHeartbeat(code,token,payload={}) {
    code=typeof code==='string'?code.toUpperCase():code;
    const room=this.roomFor(code);if(!room)return fail('Room not found',404);
    const member=this.authenticate(room,token);if(!member)return fail('Controller credential is invalid or revoked',401);
    if(member.role!=='ai')return fail('An AI playing seat is required',403);
    const copy=clone(room),actor=this.aiActor(copy,token);if(!actor)return fail('Seat controller changed',409);
    const previous=this.recordedAiStatus(actor.slot);
    const result=heartbeatRunner(actor.slot,payload,this.now());if(!result.success)return result;
    const changed=JSON.stringify(previous)!==JSON.stringify(this.recordedAiStatus(actor.slot));
    this.persistRuntime(copy,changed?{type:'aiHeartbeat',actorSeatId:actor.slot.id,actorGeneration:actor.slot.generation,actorName:member.name,
      summary:`${member.name} AI status changed to ${actor.slot.runnerLease?.status}`,payload:{status:actor.slot.runnerLease?.status,error:actor.slot.runnerLease?.error}}:null);
    return {...result,controlEpoch:actor.slot.controlEpoch};
  }
  aiChatRead(code,token,payload={}) {
    code=typeof code==='string'?code.toUpperCase():code;
    const room=this.roomFor(code);if(!room)return fail('Room not found',404);
    const member=this.authenticate(room,token);if(!member)return fail('Controller credential is invalid or revoked',401);
    if(member.role!=='ai')return fail('An AI playing seat is required',403);
    const actor=this.aiActor(room,token);if(!actor)return fail('Seat controller changed',409);
    const afterSequence=payload.afterSequence??0;
    if(!Number.isSafeInteger(afterSequence)||afterSequence<0)return fail('Invalid chat sequence');
    const afterNegotiationSequence=payload.afterNegotiationSequence??0;
    if(!Number.isSafeInteger(afterNegotiationSequence)||afterNegotiationSequence<0)return fail('Invalid negotiation sequence');
    const fenced=fenceAiCommand(actor.slot,payload,this.now());if(!fenced.success)return fenced;
    const messages=(room.chat||[]).filter(message=>(message.authorRole||'human')==='human'&&(message.sequence||0)>afterSequence);
    const page=messages.slice(0,50);
    const negotiationPage=actor.slot.chatEnabled
      ?readNegotiations(room,actor.slot.id,afterNegotiationSequence,this.now())
      :{negotiations:[],negotiationSequence:negotiationState(room).sequence,negotiationHasMore:false};
    return {success:true,messages:clone(page),chatSequence:room.chatSequence||0,hasMore:messages.length>page.length,
      ...negotiationPage,chatEnabled:actor.slot.chatEnabled,chatModel:actor.slot.chatModel||actor.slot.model,chatReasoning:actor.slot.chatReasoning};
  }
  aiNegotiate(code,token,payload={}) {
    code=typeof code==='string'?code.toUpperCase():code;
    const room=this.roomFor(code);if(!room)return fail('Room not found',404);
    const member=this.authenticate(room,token);if(!member)return fail('Controller credential is invalid or revoked',401);
    if(member.role!=='ai')return fail('An AI playing seat is required',403);
    if(!payload||typeof payload!=='object'||Array.isArray(payload)||!Object.keys(payload).every(key=>['requestId','controlEpoch','runId','revision','generation','intent'].includes(key)))return fail('Invalid AI negotiation request');
    const {requestId,controlEpoch,runId,revision,generation,intent}=payload;
    if(typeof requestId!=='string'||requestId.length<1||requestId.length>100||typeof runId!=='string'||runId.length<8||runId.length>100||!Number.isSafeInteger(revision)||!Number.isSafeInteger(generation))return fail('Invalid AI negotiation request');
    const key=hash(token),receiptKey=`${key}:${requestId}`;
    let fingerprint;try{fingerprint=hash(JSON.stringify({kind:'aiNegotiation',controlEpoch,runId,revision,generation,intent}));}catch{return fail('Invalid AI negotiation request');}
    if(room.receipts[receiptKey])return room.receipts[receiptKey].fingerprint===fingerprint?clone(room.receipts[receiptKey].result):fail('Request ID already used for another command',409);
    if(revision!==room.revision)return fail('Game changed; observe before acting',409);
    if(generation!==member.generation)return fail('Seat controller changed',409);
    const copy=clone(room),actor=this.aiActor(copy,token);if(!actor)return fail('Seat controller changed',409);
    const now=this.now(),fenced=fenceAiCommand(actor.slot,payload,now);if(!fenced.success)return fenced;
    if(!leaseIsLive(actor.slot,now)||actor.slot.runnerLease?.runId!==runId)return fail('AI runner lease is not active',409);
    if(copy.paused||copy.game?.phase==='finished')return fail('AI negotiation is paused',409);
    if(!actor.slot.chatEnabled)return fail('AI chat is disabled',409);
    const prepared=prepareNegotiation(copy,actor.slot.id,intent,{id:randomUUID(),now});if(!prepared.success)return prepared;
    copy.negotiationState=prepared.state;
    copy.chatSequence=(copy.chatSequence||0)+1;
    copy.chat.push({id:prepared.metadata.id,sequence:copy.chatSequence,authorRole:'ai',playerName:member.name,playerId:actor.slot.id,
      message:prepared.message,timestamp:now,negotiation:clone(prepared.metadata)});
    copy.chat=copy.chat.slice(-100);copy.revision++;
    const negotiation={...clone(prepared.metadata),sequence:prepared.sequence};
    const response={success:true,revision:copy.revision,negotiation};
    copy.receipts[receiptKey]={fingerprint,result:clone(response)};
    const keys=Object.keys(copy.receipts);for(const receipt of keys.slice(0,Math.max(0,keys.length-2000)))delete copy.receipts[receipt];
    try {
      this.persist(copy,{type:'aiNegotiation',actorSeatId:actor.slot.id,actorGeneration:actor.slot.generation,actorName:member.name,
        summary:prepared.message,payload:null});
    } catch(error) {
      const storage=error?.message==='Recording is unavailable'||error?.code?.startsWith?.('SQLITE_')||error?.code?.startsWith?.('ERR_SQLITE_');
      return fail(storage?'Unable to save the accepted negotiation':'Invalid negotiation parameters',storage?500:400);
    }
    this.markAiTool(copy,member);return clone(response);
  }
  aiChatReply(code,token,payload={}) {
    code=typeof code==='string'?code.toUpperCase():code;
    const room=this.roomFor(code);if(!room)return fail('Room not found',404);
    const member=this.authenticate(room,token);if(!member)return fail('Controller credential is invalid or revoked',401);
    if(member.role!=='ai')return fail('An AI playing seat is required',403);
    const {requestId,replyToSequence,message}=payload;
    if(typeof requestId!=='string'||requestId.length<1||requestId.length>100||!Number.isSafeInteger(replyToSequence)||replyToSequence<1||typeof message!=='string'||!message.trim()||message.length>500)return fail('Invalid AI chat reply');
    const key=hash(token),receiptKey=`${key}:${requestId}`;
    let fingerprint;try{fingerprint=hash(JSON.stringify({kind:'aiChatReply',payload}));}catch{return fail('Invalid AI chat reply');}
    if(room.receipts[receiptKey])return room.receipts[receiptKey].fingerprint===fingerprint?clone(room.receipts[receiptKey].result):fail('Request ID already used for another command',409);
    const copy=clone(room),actor=this.aiActor(copy,token);if(!actor)return fail('Seat controller changed',409);
    const fenced=fenceAiCommand(actor.slot,payload,this.now());if(!fenced.success)return fenced;
    if(copy.paused||copy.game?.phase==='finished')return fail('AI chat replies are paused',409);
    if(!actor.slot.chatEnabled)return fail('AI chat is disabled',409);
    const target=(copy.chat||[]).find(candidate=>(candidate.authorRole||'human')==='human'&&candidate.sequence===replyToSequence);
    if(!target||replyToSequence<=(actor.slot.lastAiReplyToSequence||0))return fail('Chat message is no longer available',409);
    const now=this.now();if(now-(actor.slot.lastAiReplyAt||0)<5000)return fail('AI chat reply cooldown is active',429);
    copy.chatSequence=(copy.chatSequence||0)+1;
    copy.chat.push({id:randomUUID(),sequence:copy.chatSequence,authorRole:'ai',replyToSequence,playerName:member.name,playerId:actor.slot.id,message:message.trim(),timestamp:now});
    copy.chat=copy.chat.slice(-100);actor.slot.lastAiReplyAt=now;actor.slot.lastAiReplyToSequence=replyToSequence;copy.revision++;
    const response={success:true,revision:copy.revision,sequence:copy.chatSequence};
    copy.receipts[receiptKey]={fingerprint,result:clone(response)};
    const keys=Object.keys(copy.receipts);for(const receipt of keys.slice(0,Math.max(0,keys.length-2000)))delete copy.receipts[receipt];
    this.persist(copy,{type:'aiChatReply',actorSeatId:actor.slot.id,actorGeneration:actor.slot.generation,actorName:member.name,
      summary:`${member.name} replied in chat`,payload:{replyToSequence,message:message.trim()}});
    this.markAiTool(copy,member);return clone(response);
  }
  recordingAccess(id,{perspective='public',token}={}) {
    const recording=this.recordingFor(id);if(!recording)return fail('Replay not found',404);
    const terminal=['won','ended'].includes(recording.status);
    const requested=typeof perspective==='string'?perspective:'public';
    if(requested==='public')return {success:true,recording,access:{full:false,perspective:'public'}};
    if(requested==='omniscient')return terminal?{success:true,recording,access:{full:true,perspective:'omniscient'}}:fail('Omniscient replay is unavailable while the match can resume',403);
    const seatId=requested==='seat'?null:requested.startsWith('seat:')?requested.slice(5):requested;
    const knownSeat=recording.players.some(player=>player.id===seatId);
    if(terminal) {
      if(!knownSeat)return fail('Replay perspective not found',404);
      return {success:true,recording,access:{full:false,perspective:seatId,seatId,ownsSeatHistory:true}};
    }
    const room=this.roomFor(recording.roomCode);
    const member=room?this.authenticate(room,token):null;
    const ownSeat=member?.seatId||null,target=seatId||ownSeat;
    const slot=target?room?.slots.find(candidate=>candidate.id===target):null;
    if(!member||!target||ownSeat!==target||member.generation!==slot?.generation)return fail('This replay perspective requires the current seat controller',403);
    return {success:true,recording,access:{full:false,perspective:target,seatId:target,generation:member.generation}};
  }
  replayPerspectives(recording,token) {
    const result=[{id:'public',label:'Public'}];
    if(['won','ended'].includes(recording.status))return [...result,{id:'omniscient',label:'Omniscient'},
      ...recording.players.map(player=>({id:player.id,label:player.name}))];
    const room=this.roomFor(recording.roomCode),member=room?this.authenticate(room,token):null;
    if(member?.seatId&&room.slots.find(slot=>slot.id===member.seatId)?.generation===member.generation)result.push({id:member.seatId,label:member.name});
    return result;
  }
  listReplays({limit=50,offset=0}={}) {
    if(!Number.isSafeInteger(limit)||limit<1||limit>200||!Number.isSafeInteger(offset)||offset<0)return fail('Invalid replay page');
    const rows=this.store?.listRecordings?.({limit,offset})||[...this.recordings.values()].sort((a,b)=>b.lastAt-a.lastAt).slice(offset,offset+limit);
    const total=this.store?.countRecordings?.()??this.recordings.size;
    return {success:true,recordings:rows.map(publicMetadata),total,limit,offset};
  }
  replay(id,{at,perspective='public',token}={}) {
    if(at!=null&&(!Number.isSafeInteger(Number(at))||Number(at)<0))return fail('Invalid replay position');
    const resolved=this.recordingAccess(id,{perspective,token});if(!resolved.success)return resolved;
    const target=Math.min(resolved.recording.lastSeq,at==null?resolved.recording.lastSeq:Number(at));
    const checkpoint=this.store?.getRecordingCheckpoint?.(id,target)||resolved.recording.checkpoints?.filter(item=>item.seq<=target).at(-1)||null;
    const after=checkpoint?Math.max(0,checkpoint.seq-1):0;
    const events=target===0?[]:this.eventsFor(id,{after,limit:target-after}),snapshot=reconstruct(resolved.recording,events,target,checkpoint);
    const selectedEvent=snapshot.seq?events.find(event=>event.seq===snapshot.seq):null;
    return {success:true,recording:publicMetadata(resolved.recording),seq:snapshot.seq,
      elapsedMs:selectedEvent?.elapsedMs||0,turn:selectedEvent?.turn||0,perspectives:this.replayPerspectives(resolved.recording,token),
      state:projectState(snapshot.state,resolved.access)};
  }
  replayEvents(id,{after=0,limit=200,perspective='public',token}={}) {
    if(!Number.isSafeInteger(Number(after))||Number(after)<0||!Number.isSafeInteger(Number(limit))||Number(limit)<1||Number(limit)>1000)return fail('Invalid replay event page');
    const resolved=this.recordingAccess(id,{perspective,token});if(!resolved.success)return resolved;
    const events=this.eventsFor(id,{after:Number(after),limit:Number(limit)}).map(event=>projectEvent(event,resolved.access));
    return {success:true,events,lastSeq:resolved.recording.lastSeq};
  }
  replayMetrics(id,{perspective='public',token}={}) {
    const resolved=this.recordingAccess(id,{perspective,token});if(!resolved.success)return resolved;
    return {success:true,recording:publicMetadata(resolved.recording),points:metrics(resolved.recording,this.eventsFor(id),resolved.access)};
  }
  replayExport(id,{perspective='public',token}={}) {
    const resolved=this.recordingAccess(id,{perspective,token});if(!resolved.success)return resolved;
    const rawEvents=this.eventsFor(id),initial=projectState(resolved.recording.initialState,resolved.access);
    const lines=[JSON.stringify({kind:'metadata',recording:publicMetadata(resolved.recording),perspective:resolved.access.perspective})+'\n',
      JSON.stringify({kind:'initial',seq:0,state:initial})+'\n'];
    let raw=clone(resolved.recording.initialState),projected=initial;
    for(const event of rawEvents) {
      raw=applyPatch(raw,event.patch);const next=projectState(raw,resolved.access);
      lines.push(JSON.stringify({kind:'event',...projectEvent(event,resolved.access),patch:createPatch(projected,next)})+'\n');
      if(event.seq%50===0||event.seq===resolved.recording.lastSeq)lines.push(JSON.stringify({kind:'checkpoint',seq:event.seq,state:next})+'\n');
      projected=next;
    }
    return {success:true,recording:publicMetadata(resolved.recording),lines};
  }
  deleteReplay(id) {
    const recording=this.recordingFor(id);if(!recording)return fail('Replay not found',404);
    if(!['won','ended'].includes(recording.status))return fail('An unfinished recording cannot be deleted',409);
    if(this.store?.deleteRecording&&!this.store.deleteRecording(id))return fail('Replay not found',404);
    this.recordings.delete(id);this.rooms.delete(recording.roomCode);this.legalCache.delete(recording.roomCode);
    return {success:true};
  }
  tradeAction(room,seatId,type,p) {
    const game=room.game;
    if(!canTradeWithPlayers(game))return fail('Player trading is unavailable now');
    const active=game.players[game.currentPlayerIndex].id,player=game.players.find(x=>x.id===seatId);
    if(type==='tradeOffer'||type==='tradeCounter') {
      const previous=room.trade;
      if(type==='tradeCounter'&&(!previous||previous.id!==p.tradeId||previous.status!=='offered'||seatId!==previous.to||p.to!==previous.from))return fail('Trade is no longer available');
      const targetSlot=room.slots.find(s=>s.id===p.to);
      const targetMember=targetSlot?.controller?room.members[targetSlot.controller]:null;
      if(!player||!pack(p.give)||!pack(p.get)||!game.players.some(x=>x.id===p.to)||targetMember?.seatId!==p.to||targetMember?.generation!==targetSlot.generation||p.to===seatId)return fail('Specify an occupied partner and positive resource quantities');
      if(seatId!==active&&p.to!==active)return fail('Trades must involve the active player');
      if(resourceNames.some(r=>p.give[r]>0&&p.get[r]>0))return fail('Do not offer and request the same resource');
      if(!affordable(player,p.give))return fail('You do not have the offered resources');
      if(type==='tradeOffer'&&room.trade)return fail('Resolve or cancel the current offer first');
      room.trade={id:randomUUID(),from:seatId,to:p.to,give:clone(p.give),get:clone(p.get),status:'offered',counterOf:previous?.id||null};
    } else {
      const t=room.trade;if(!t||t.id!==p.tradeId)return fail('Trade is no longer available',409);
      if(type==='tradeAccept'&&seatId===t.to&&t.status==='offered') {
        const offerer=game.players.find(x=>x.id===t.from);
        if(!offerer||!affordable(offerer,t.give)||!affordable(player,t.get))return fail('The trade is no longer affordable');t.status='accepted';
      } else if((type==='tradeReject'&&seatId===t.to)||(type==='tradeCancel'&&seatId===t.from))room.trade=null;
      else if(type==='tradeConfirm'&&seatId===t.from&&t.status==='accepted') {
        const from=game.players.find(x=>x.id===t.from),to=game.players.find(x=>x.id===t.to);
        if(!affordable(from,t.give)||!affordable(to,t.get))return fail('The trade is no longer affordable');
        for(const r of resourceNames){const delta=(t.give[r]||0)-(t.get[r]||0);from.resources[r]-=delta;to.resources[r]+=delta;}
        room.trade=null;
      } else return fail('You cannot perform that trade action');
    }
    return {success:true};
  }
}
