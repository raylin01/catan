import {randomBytes,randomUUID,createHash} from 'node:crypto';
import * as G from './gameLogic.js';
import {executeAction,playerView,legalActions} from './actions.js';
import {PROVIDERS} from './providers.js';
import {appendCardEvent,projectCardEvents} from './cardEvents.js';

const secret=()=>randomBytes(32).toString('base64url');
const hash=value=>createHash('sha256').update(value).digest('hex');
const clone=value=>structuredClone(value);
const fail=(error,statusCode=400)=>({success:false,error,statusCode});
const resourceNames=['brick','lumber','wool','grain','ore'];
const cleanName=value=>typeof value==='string' && value.trim().length>0 && value.trim().length<=40 ? value.trim() : null;
const pack=value=>value && typeof value==='object' && !Array.isArray(value) && Object.keys(value).every(k=>resourceNames.includes(k)) && Object.values(value).every(n=>Number.isSafeInteger(n)&&n>=0&&n<=95) && Object.values(value).some(n=>n>0);
const affordable=(p,amounts)=>Object.entries(amounts).every(([r,n])=>p.resources[r]>=n);

export class RoomService {
  constructor({store,maxActive=1,providers=PROVIDERS}={}) {
    this.store=store;this.maxActive=maxActive;this.providers=providers;this.rooms=new Map();this.presence=new Map();this.legalCache=new Map();
    for(const room of store?.load()||[]) {
      if(room.game && ['setup','playing'].includes(room.game.phase)) room.paused=true;
      this.rooms.set(room.code,room);
    }
  }
  persist(room){this.store?.save(room);this.rooms.set(room.code,room);this.legalCache.delete(room.code);}
  authenticate(room,token){return typeof token==='string'&&token.length<=200 ? room.members[hash(token)] : undefined;}
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
    const {name,seatCount=3,seats}=options;
    if(!cleanName(name)||![3,4].includes(seatCount)) return fail('Enter a name and choose 3 or 4 seats');
    if(seats!==undefined&&!Array.isArray(seats))return fail('Seats must be an array');
    if(seats?.length>seatCount)return fail('Too many seat configurations');
    if(seats?.some(seat=>!seat||typeof seat!=='object'||Array.isArray(seat)))return fail('Invalid seat configuration');
    if(this.rooms.size>=50) return fail('Room capacity reached',429);
    let code;do {code=randomBytes(5).toString('hex').slice(0,8).toUpperCase();}while(this.rooms.has(code));
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
      slots.push({id:randomUUID(),kind,provider,model,generation:0,controller:null,ready:false,name:`Seat ${i+1}`});
    }
    const room={code,revision:0,name:cleanName(name),slots,members:{[hash(token)]:{role:'host',name:cleanName(name)}},game:null,trade:null,chat:[],receipts:{},cardEventSequence:0,cardEvents:[],paused:false};
    this.persist(room);return {success:true,code,token,role:'host'};
  }
  join(code,options={}) {
    const normalizedCode=typeof code==='string'?code.toUpperCase():code;
    const room=this.rooms.get(normalizedCode);if(!room)return fail('Room not found',404);
    if(!options||typeof options!=='object'||Array.isArray(options))return fail('Invalid join request');
    const {name,role='spectator',seatId,provider,model}=options;
    if(!cleanName(name)||!['human','ai','spectator'].includes(role))return fail('Invalid name or role');
    if(Object.keys(room.members).length>=100)return fail('Room member capacity reached',429);
    const copy=clone(room),token=secret(),key=hash(token);
    const member={role,name:cleanName(name)};
    if(role!=='spectator') {
      const slot=copy.slots.find(s=>(!seatId||s.id===seatId)&&s.kind===role&&!s.controller);
      if(!slot)return fail('No matching vacant seat',409);
      let selected=null;
      if(role==='ai') {
        selected=this.provider(provider,model,slot.provider,slot.model);
        if(!selected)return fail('This seat requires its configured provider and model');
        slot.provider=selected.provider;slot.model=selected.model;
      }
      slot.generation++;slot.controller=key;slot.ready=false;slot.name=member.name;
      Object.assign(member,{seatId:slot.id,generation:slot.generation,provider:selected?.provider||null,model:selected?.model||null});
      if(copy.game){const player=copy.game.players.find(p=>p.id===slot.id);if(!player)return fail('Seat is not part of this game',409);player.name=member.name;}
    }
    copy.members[key]=member;copy.revision++;this.persist(copy);
    return {success:true,code:normalizedCode,token,role,seatId:member.seatId,generation:member.generation};
  }
  observe(code,token) {
    code=typeof code==='string'?code.toUpperCase():code;
    const room=this.rooms.get(code);if(!room)return fail('Room not found',404);
    const member=this.authenticate(room,token);if(!member)return fail('Controller credential is invalid or revoked',401);
    const key=hash(token);this.presence.set(key,Date.now());
    const gameState=room.game?clone(playerView(room.game,member.seatId)):null;
    const choices=room.game&&!room.paused&&member.seatId?this.cachedLegalActions(room,member):[];
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
    return {success:true,code,revision:room.revision,role:member.role,host:member.role==='host',seatId:member.seatId||null,generation:member.generation||0,
      paused:room.paused,slots:room.slots.map(({controller,...s})=>({...s,occupied:!!controller,connected:!!controller&&Date.now()-(this.presence.get(controller)||0)<15000})),
      gameState,legalActions:choices,decision,trade:clone(room.trade),events:clone(room.events||[]),chat:member.role==='ai'?[]:clone(room.chat),
      rollEvent:room.lastRoll?{id:room.lastRoll.id,roll:clone(room.lastRoll.roll),gains:clone(room.lastRoll.audienceGenerations?.[member.seatId]===member.generation?room.lastRoll.gainsBySeat[member.seatId]||{}:{})}:null,
      robberPick,cardEvents:projectCardEvents(room,member),cardEventSequence:room.cardEventSequence||0};
  }
  command(code,token,command={}) {
    code=typeof code==='string'?code.toUpperCase():code;
    const room=this.rooms.get(code);if(!room)return fail('Room not found',404);
    const member=this.authenticate(room,token);if(!member)return fail('Controller credential is invalid or revoked',401);
    if(!command||typeof command!=='object'||Array.isArray(command))return fail('Invalid command envelope');
    const {requestId,revision,generation,type,payload={}}=command;
    if(typeof requestId!=='string'||requestId.length<1||requestId.length>100||typeof type!=='string'||!payload||typeof payload!=='object'||Array.isArray(payload))return fail('Invalid command envelope');
    const key=hash(token),receiptKey=`${key}:${requestId}`;
    let fingerprint;
    try {fingerprint=hash(JSON.stringify({type,payload,generation}));}
    catch {return fail('Invalid command envelope');}
    if(room.receipts[receiptKey])return room.receipts[receiptKey].fingerprint===fingerprint?clone(room.receipts[receiptKey].result):fail('Request ID already used for another command',409);
    if(revision!==room.revision)return fail('Game changed; observe before acting',409);
    if(member.seatId && generation!==member.generation)return fail('Seat controller changed',409);
    const copy=clone(room),beforeGame=room.game?clone(room.game):null;let result={success:true};
    try {
      const hostTypes=['configureSeat','start','removeController','pause','resume','endGame'];
      if(hostTypes.includes(type)&&member.role!=='host')return fail('Only the host can do that',403);
      const slot=copy.slots.find(s=>s.id===member.seatId);
      if(type==='configureSeat') {
        if(copy.game)return fail('Seats are locked after start');
        const target=copy.slots.find(s=>s.id===payload.seatId);
        if(!target||target.controller||!['human','ai'].includes(payload.kind))return fail('Choose a vacant seat and a valid controller type');
        let selected={provider:null,model:null};
        if(payload.kind==='ai') {
          selected=this.provider(payload.provider||Object.keys(this.providers)[0],payload.model);
          if(!selected)return fail('Invalid AI provider or model');
        }
        Object.assign(target,{kind:payload.kind,provider:selected.provider,model:selected.model});
      } else if(type==='start') {
        if(copy.game)return fail('Game already started');
        const invalidSeat=copy.slots.some(s=>!s.controller||!s.ready||copy.members[s.controller]?.seatId!==s.id||copy.members[s.controller]?.generation!==s.generation);
        if(invalidSeat)return fail('Every seat must be occupied and ready');
        if([...this.rooms.values()].filter(r=>r.game&&['setup','playing'].includes(r.game.phase)).length>=this.maxActive)return fail('Another game is active',409);
        copy.game=G.createGame(code,{id:copy.slots[0].id,name:copy.slots[0].name});
        for(const s of copy.slots.slice(1))G.addPlayer(copy.game,{id:s.id,name:s.name});
        result=G.startGame(copy.game);
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
          copy.trade=null;
        }
      } else if(type==='pause'||type==='resume') {
        if(!copy.game||!['setup','playing'].includes(copy.game.phase))return fail('Game is not active');
        if(copy.paused===(type==='pause'))return fail(type==='pause'?'Game is already paused':'Game is not paused');
        copy.paused=type==='pause';
      }
      else if(type==='endGame') {if(!copy.game||!['setup','playing'].includes(copy.game.phase))return fail('Game is not active');copy.game.phase='finished';copy.game.pendingRobberPick=null;copy.game.discardingPlayers=[];copy.trade=null;copy.paused=false;}
      else if(type==='chat') {
        if(member.role==='ai')return fail('AI connectors use structured trades');
        if(typeof payload.message!=='string'||!payload.message.trim()||payload.message.length>500)return fail('Message must contain 1–500 characters');
        copy.chat.push({id:randomUUID(),playerName:member.name,playerId:member.seatId||null,message:payload.message.trim(),timestamp:Date.now()});copy.chat=copy.chat.slice(-100);
      } else {
        if(!slot||!copy.game)return fail('A playing seat is required',403);
        if(slot.controller!==key||slot.generation!==member.generation)return fail('Seat controller changed',409);
        if(copy.paused)return fail('Game is paused',409);
        if(['proposeTrade','respondToTrade','cancelTrade'].includes(type))return fail('Use the structured room trade actions');
        if(type.startsWith('trade'))result=this.tradeAction(copy,slot.id,type,payload);
        else {
          result=executeAction(copy.game,slot.id,type,payload);
          if(result.success&&(['endTurn','moveRobber'].includes(type)||copy.game.phase!=='playing'||copy.game.turnPhase!=='main'||copy.game.freeRoads||copy.game.yearOfPlentyPicks))copy.trade=null;
          if(result.success&&copy.game.phase==='finished')copy.trade=null;
        }
      }
      if(!result.success)return result;
      // Keep exact production for presentation; observations expose only the
      // authenticated seat's receipt, never another player's hand or gains.
      if(type==='rollDice'&&result.roll)copy.lastRoll={id:randomUUID(),roll:clone(result.roll),
        audienceGenerations:Object.fromEntries(copy.slots.map(slot=>[slot.id,slot.generation])),
        gainsBySeat:Object.fromEntries(copy.game.players.map((player,index)=>[player.id,clone(result.resourceGains?.[index]||{})]))};
      copy.revision++;
      appendCardEvent(copy,beforeGame,type,type==='rollDice'?copy.lastRoll?.id:null);
      const labels={start:'started the game',placeSettlement:'built a settlement',placeRoad:'built a road',upgradeToCity:'built a city',rollDice:'rolled the dice',discardCards:'discarded cards',moveRobber:'moved the robber',chooseRobberCard:'stole a resource card',buyDevCard:'bought a development card',playDevCard:'played a development card',bankTrade:'traded with the bank',endTurn:'ended their turn',tradeOffer:'offered a trade',tradeCounter:'made a counteroffer',tradeAccept:'accepted a trade offer',tradeReject:'rejected a trade offer',tradeConfirm:'confirmed a trade',tradeCancel:'cancelled a trade',leave:'left their seat',removeController:'removed a seat controller',pause:'paused the game',resume:'resumed the game',endGame:'ended the game'};
      if(labels[type])copy.events=[...(copy.events||[]),{id:randomUUID(),at:Date.now(),actor:member.name,type,summary:`${member.name} ${labels[type]}`}].slice(-200);
      const response={success:true,revision:copy.revision};
      // Return private effects only to the authenticated actor, never the event stream.
      if(result.card)response.card=result.card;
      if(result.roll)response.roll=clone(result.roll);
      if(result.stolenInfo)response.stolenInfo=clone(result.stolenInfo);
      copy.receipts[receiptKey]={fingerprint,result:clone(response)};
      const keys=Object.keys(copy.receipts);for(const k of keys.slice(0,Math.max(0,keys.length-2000)))delete copy.receipts[k];
      this.persist(copy);return clone(response);
    } catch {return fail('Invalid action parameters');}
  }
  tradeAction(room,seatId,type,p) {
    const game=room.game;
    if(game.phase!=='playing'||game.turnPhase!=='main'||game.freeRoads||game.yearOfPlentyPicks)return fail('Trading is unavailable now');
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
