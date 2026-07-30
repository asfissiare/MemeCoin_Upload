import { EventEmitter } from 'events';

export const eventBus = new EventEmitter();

export function emitEvent(type, data) {
  const eventPayload = {
    type,
    data,
    detectedAt: new Date().toISOString()
  };
  eventBus.emit('bot-event', eventPayload);
  return eventPayload;
}
