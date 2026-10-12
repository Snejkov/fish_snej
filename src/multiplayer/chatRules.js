export const CHAT_RADIUS = 100;
export const CHAT_LIMIT = 240;
export const CHAT_CHANNELS = Object.freeze(["local", "global"]);

export function cleanChatText(value) {
  if (typeof value !== "string" || value.length > CHAT_LIMIT) return "";
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
}

export function receivesChat(channel, sender, recipient) {
  if (channel === "global") return true;
  if (channel !== "local") return false;
  const values = [sender?.x, sender?.z, recipient?.x, recipient?.z];
  return values.every(Number.isFinite)
    && Math.hypot(sender.x - recipient.x, sender.z - recipient.z) <= CHAT_RADIUS;
}

export function consumeChatToken(peer, now) {
  peer.chatTokens = Math.min(4, (peer.chatTokens ?? 4) + Math.max(0, now - (peer.chatAt ?? now)) / 2500);
  peer.chatAt = now;
  if (peer.chatTokens < 1) return false;
  peer.chatTokens -= 1;
  return true;
}
