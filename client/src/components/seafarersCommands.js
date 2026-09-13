// Keep the room adapter's Seafarers commands explicit and payloads narrow.
export function seafarersCommand(type, payload = {}) {
  switch (type) {
    case 'placeShip': case 'placePort': return {type,payload:{edgeKey:payload.edgeKey}};
    case 'moveShip': return {type,payload:{fromEdgeKey:payload.fromEdgeKey,toEdgeKey:payload.toEdgeKey}};
    case 'movePirate': return {type,payload:{hexKey:payload.hexKey,...(payload.stealFromPlayerId ? {stealFromPlayerId:payload.stealFromPlayerId}:{}),...(payload.stealType ? {stealType:payload.stealType}:{})}};
    case 'resolveSeafarersChoice': return {type,payload:{choiceId:payload.choiceId,optionId:payload.optionId}};
    case 'claimWonder': return {type,payload:{wonderId:payload.wonderId}};
    case 'buildWonder': case 'attackFortress': return {type,payload:{}};
    default:return null;
  }
}
