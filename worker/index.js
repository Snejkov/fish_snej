const rooms = new Map();
const socketState = new WeakMap();
const RESERVED_IDS = new Set([1]);
const claimedIds = new Set(RESERVED_IDS);
let nextGlobalId = Math.max(...RESERVED_IDS) + 1;
let warnedAboutMemoryFallback = false;

const RANKS = new Set(["player", "premium", "tester", "administrator", "developer"]);

function messageType(message) {
  return message?.t || message?.type || "";
}

function send(socket, type, payload = {}) {
  if (socket.readyState === 1) socket.send(JSON.stringify({ t: type, ...payload }));
}

function broadcast(room, sender, type, payload = {}) {
  const clients = rooms.get(room);
  if (!clients) return;
  for (const client of clients) {
    if (client !== sender) send(client, type, payload);
  }
}

async function kvHasId(env, id) {
  if (!env.SNEJFISHING_GLOBAL) return false;
  return Boolean(await env.SNEJFISHING_GLOBAL.get(`claimed:${id}`));
}

async function reserveId(env, id) {
  claimedIds.add(id);
  nextGlobalId = Math.max(nextGlobalId, id + 1);
  if (env.SNEJFISHING_GLOBAL) {
    await env.SNEJFISHING_GLOBAL.put(`claimed:${id}`, "1");
    await env.SNEJFISHING_GLOBAL.put("nextGlobalId", String(nextGlobalId));
  }
}

async function allocateId(env) {
  if (env.SNEJFISHING_GLOBAL) {
    const stored = Number(await env.SNEJFISHING_GLOBAL.get("nextGlobalId"));
    if (stored > nextGlobalId) nextGlobalId = Math.floor(stored);
  } else if (!warnedAboutMemoryFallback) {
    warnedAboutMemoryFallback = true;
    console.warn("SNEJFISHING_GLOBAL KV is unavailable; global IDs use in-memory fallback storage.");
  }
  while (claimedIds.has(nextGlobalId) || await kvHasId(env, nextGlobalId)) nextGlobalId += 1;
  const id = nextGlobalId;
  await reserveId(env, id);
  return id;
}

async function assignId(env, requestedId, currentId) {
  const requested = Math.floor(Number(requestedId));
  if (requested > 0 && requested === currentId) return { id: requested, claimedId: requested, reason: "accepted" };
  if (requested > 0 && !claimedIds.has(requested) && !await kvHasId(env, requested)) {
    await reserveId(env, requested);
    return { id: requested, claimedId: requested, reason: "accepted" };
  }
  if (requested > 0) return { id: await allocateId(env), claimedId: requested, reason: "duplicate" };
  return { id: await allocateId(env), claimedId: 0, reason: "assigned" };
}

function closeClient(room, socket, clientId) {
  const clients = rooms.get(room);
  if (!clients || !clients.has(socket)) return;
  clients.delete(socket);
  const state = socketState.get(socket) || {};
  broadcast(room, socket, "leave", {
    clientId,
    id: state.assignedId || 0,
    name: state.name || "Player",
    rank: state.rank || "player"
  });
  if (clients.size === 0) rooms.delete(room);
}

async function handleMessage(env, room, server, clientId, data) {
  let message;
  try {
    message = JSON.parse(String(data));
  } catch {
    return;
  }
  const type = messageType(message);
  const state = socketState.get(server);
  if (type === "hello") {
    const assignment = await assignId(env, message.claimedId, state.assignedId);
    state.assignedId = assignment.id;
    state.name = String(message.name || "Player").slice(0, 20);
    state.rank = RANKS.has(message.rank) ? message.rank : "player";
    send(server, "peer.id.assigned", assignment);
    return;
  }
  if (!state.assignedId || !["presence", "placements", "chat"].includes(type)) return;
  if (type === "presence") {
    const presence = message.presence && typeof message.presence === "object" ? message.presence : {};
    broadcast(room, server, type, {
      clientId,
      presence: {
        ...presence,
        id: state.assignedId,
        name: state.name,
        rank: state.rank
      }
    });
    return;
  }
  if (type === "placements") {
    broadcast(room, server, type, { clientId, placements: Array.isArray(message.placements) ? message.placements : [] });
    return;
  }
  broadcast(room, server, type, { clientId, text: String(message.text || "").slice(0, 240) });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== "/ws") return new Response("SnejFishing multiplayer worker", { status: 200 });
    if (request.headers.get("Upgrade") !== "websocket") return new Response("WebSocket required", { status: 426 });

    const room = (url.searchParams.get("room") || "snej-1").slice(0, 32);
    const clientId = crypto.randomUUID();
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.accept();

    if (!rooms.has(room)) rooms.set(room, new Set());
    rooms.get(room).add(server);
    socketState.set(server, { assignedId: 0, name: "Player", rank: "player" });
    send(server, "welcome", { clientId, room });

    server.addEventListener("message", (event) => {
      handleMessage(env, room, server, clientId, event.data).catch((error) => console.error("Message handling failed", error));
    });
    server.addEventListener("close", () => closeClient(room, server, clientId));
    server.addEventListener("error", () => closeClient(room, server, clientId));
    return new Response(null, { status: 101, webSocket: client });
  }
};
