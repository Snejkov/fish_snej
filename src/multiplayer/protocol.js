export const MESSAGE_TYPES = Object.freeze({
  HELLO: "hello",
  WELCOME: "welcome",
  ID_ASSIGNED: "peer.id.assigned",
  PRESENCE: "presence",
  LEAVE: "leave",
  PLACEMENTS: "placements",
  CHAT: "chat"
});

export function encodeMessage(type, payload = {}) {
  return JSON.stringify({ t: type, ...payload });
}

export function decodeMessage(data) {
  try {
    const message = JSON.parse(String(data));
    const type = message?.t || message?.type;
    if (typeof type !== "string") return null;
    message.type = type;
    return message;
  } catch {
    return null;
  }
}
