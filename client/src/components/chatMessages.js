export const chatMessageKey = message => message ? message.id || `${message.sequence ?? ''}:${message.timestamp}:${message.playerId}:${message.message}` : null;

// The server keeps a rolling window of 100 messages, so length is not a cursor.
export function newChatMessages(messages, previousKey) {
  if (!previousKey) return messages;
  const index = messages.findIndex(message => chatMessageKey(message) === previousKey);
  return index < 0 ? messages : messages.slice(index + 1);
}
