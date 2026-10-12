import { createServer } from "node:http";
import { readFile, realpath, stat } from "node:fs/promises";
import { resolve, relative, sep, extname, isAbsolute } from "node:path";
import { hashPassword, verifyPassword, readSession, sessionCookie, validPassword } from "./auth.mjs";
import { RequestError, reject, object, playerName, position } from "./validation.mjs";

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml",
  ".glb": "model/gltf-binary", ".gltf": "model/gltf+json", ".bin": "application/octet-stream", ".woff2": "font/woff2" };
const json = (res, status, data, headers = {}) => {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers });
  res.end(JSON.stringify(data));
};
async function body(req) {
  if (!String(req.headers["content-type"]).startsWith("application/json")) reject("json_required", 415);
  let size = 0, chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 65536) reject("body_too_large", 413);
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { reject("invalid_json"); }
}

export function createApp({ store, WebSocketServer, staticRoot, publicOrigin, secure = true, guestOnly = false }) {
  if (!WebSocketServer) throw new Error("WebSocketServer dependency is required.");
  const config = { publicOrigin };
  const peers = new Map(), currentPeers = new Map(), limits = new Map();
  const persistPosition = (peer) => {
    const { x, y, z, yaw, pitch, view } = peer.presence;
    return store.updatePosition(peer.user.id, { x, y, z, yaw, pitch, view });
  };
  let authActive = 0;
  const originAllowed = (req) => req.headers.origin === config.publicOrigin;
  const session = (req) => readSession(req.headers.cookie);
  const broadcast = (message, except = null) => {
    const data = JSON.stringify(message);
    for (const peer of peers.values()) if (peer !== except && peer.socket.readyState === 1) {
      if (peer.socket.bufferedAmount > 131072) peer.socket.close(1008, "Slow consumer");
      else peer.socket.send(data);
    }
  };
  const kickSession = (token) => {
    for (const peer of peers.values()) if (peer.token === token) peer.socket.close(1008, "Session ended");
  };
  const rate = (req, kind, maximum) => {
    const now = Date.now(), key = `${kind}:${req.socket.remoteAddress}`;
    if (limits.size > 4096) for (const [entry, limit] of limits) if (limit.until < now) limits.delete(entry);
    let entry = limits.get(key);
    if (!entry || entry.until < now) { entry = { count: 0, until: now + 60000 }; limits.set(key, entry); }
    if (++entry.count > maximum) reject("rate_limited", 429);
  };
  const http = createServer({ requestTimeout: 10000, headersTimeout: 10000, maxHeaderSize: 8192 }, async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    try {
      if (req.headers.host !== new URL(config.publicOrigin).host) reject("invalid_host", 400);
      const url = new URL(req.url, config.publicOrigin);
      if (req.method === "GET" && url.pathname === "/healthz") {
        store.db.prepare("SELECT 1").get();
        return json(res, 200, { ok: true, mode: "authenticated-game", online: true,
          entry: guestOnly ? "guest" : "account",
          release: process.env.SNEJ_RELEASE || "development", peers: currentPeers.size });
      }
      if (url.pathname.startsWith("/api/")) {
        if (!["GET", "POST", "PATCH"].includes(req.method)) reject("method_not_allowed", 405);
        if (req.method !== "GET" && !originAllowed(req)) reject("origin_required", 403);
        rate(req, "api", 300);
        if (req.method === "POST" && url.pathname === "/api/guest") {
          if (!guestOnly) reject("not_found", 404);
          rate(req, "guest", 15);
          const input = object(await body(req), ["name"]);
          const user = store.createGuest(input.name);
          const old = session(req);
          store.logout(old); kickSession(old);
          const token = store.newSession(user.id);
          return json(res, 200, store.profile(user.id), { "Set-Cookie": sessionCookie(token, secure) });
        }
        if (req.method === "POST" && ["/api/register", "/api/login"].includes(url.pathname)) {
          if (guestOnly) reject("not_found", 404);
          rate(req, "auth", 15);
          const input = object(await body(req), ["name", "password"]);
          if (!validPassword(input.password)) reject("invalid_credentials", 401);
          if (url.pathname === "/api/register") playerName(input.name);
          else if (typeof input.name !== "string" || input.name.length > 20) reject("invalid_credentials", 401);
          // Body input can yield; admission and reservation must be atomic after it finishes.
          if (authActive >= 4) reject("auth_busy", 429);
          authActive += 1;
          try {
            let user;
            if (url.pathname === "/api/register") {
              user = store.createUser(input.name, await hashPassword(input.password));
            } else {
              const found = store.userByName(input.name);
              // Unknown names use the same expensive KDF to avoid a fast account-existence probe.
              const record = found?.credential_hash || `scrypt.v1.32768.8.3.${"0".repeat(32)}.${"0".repeat(128)}`;
              const valid = await verifyPassword(input.password, record);
              if (!found || !valid) reject("invalid_credentials", 401);
              user = store.user(found.id);
            }
            const old = session(req);
            store.logout(old); kickSession(old);
            const token = store.newSession(user.id);
            return json(res, 200, store.profile(user.id), { "Set-Cookie": sessionCookie(token, secure) });
          } finally { authActive -= 1; }
        }
        const token = session(req), user = store.authenticate(token);
        if (guestOnly && !store.isGuest(user.id)) reject("login_required", 401);
        if (req.method === "POST" && url.pathname === "/api/logout") {
          store.logout(token); kickSession(token);
          return json(res, 200, { ok: true }, { "Set-Cookie": sessionCookie("", secure, true) });
        }
        if (req.method === "GET" && url.pathname === "/api/profile") return json(res, 200, store.profile(user.id));
        if (req.method === "PATCH" && url.pathname === "/api/profile") {
          const input = await body(req);
          const profile = store.patch(user.id, input);
          for (const peer of currentPeers.values()) if (peer.user.id === user.id && input.patch.position !== undefined) {
            peer.presence = { ...peer.presence, ...profile.state.position };
            peer.movedAt = Date.now();
            broadcast({ t: "presence", clientId: peer.id, presence: peer.presence }, peer);
          }
          return json(res, 200, profile);
        }
        if (req.method === "POST" && url.pathname === "/api/command") return json(res, 200, store.command(user.id, await body(req)));
        reject("not_found", 404);
      }
      if (!["GET", "HEAD"].includes(req.method)) reject("method_not_allowed", 405);
      let path;
      try { path = decodeURIComponent(url.pathname); } catch { reject("invalid_path"); }
      if (path.includes("\\") || path.includes("\0") || !(path === "/" || path === "/index.html" || path === "/styles.css"
        || /^\/(src|styles|vendor)\//.test(path))) reject("not_found", 404);
      const root = await realpath(staticRoot);
      const file = await realpath(resolve(root, `.${path === "/" ? "/index.html" : path}`));
      const local = relative(root, file);
      if (isAbsolute(local) || local.startsWith(`..${sep}`) || local === ".." || !MIME[extname(file)] || !(await stat(file)).isFile()) reject("not_found", 404);
      const contents = await readFile(file);
      res.writeHead(200, { "Content-Type": MIME[extname(file)], "Cache-Control": "no-cache", "Content-Length": contents.length });
      return res.end(req.method === "HEAD" ? undefined : contents);
    } catch (error) {
      if (res.headersSent) { res.destroy(); return; }
      const busy = error.code === "ERR_SQLITE_ERROR" && /locked|busy/i.test(error.message);
      const status = error.status || (busy ? 503 : ["ENOENT", "ENOTDIR"].includes(error.code) ? 404 : 500);
      json(res, status, { error: error.code && error instanceof RequestError ? error.code : status === 503 ? "database_busy" : status === 404 ? "not_found" : "server_error" });
    }
  });
  const ws = new WebSocketServer({ noServer: true, maxPayload: 8192, perMessageDeflate: false });
  http.on("upgrade", (req, socket, head) => {
    try {
      const url = new URL(req.url, config.publicOrigin);
      if (req.headers.host !== new URL(config.publicOrigin).host || !originAllowed(req)) reject("origin_required", 403);
      if (url.pathname !== "/ws" || (url.searchParams.get("room") || "snej-1") !== "snej-1") reject("unknown_room", 404);
      rate(req, "upgrade", 30);
      if (peers.size >= 64) reject("room_full", 503);
      const token = session(req), user = store.authenticate(token);
      if (guestOnly && !store.isGuest(user.id)) reject("login_required", 401);
      ws.handleUpgrade(req, socket, head, (client) => ws.emit("connection", client, { token, user }));
    } catch (error) { socket.end(`HTTP/1.1 ${error.status || 500} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); }
  });
  ws.on("connection", (socket, { token, user }) => {
    const predecessor = currentPeers.get(user.id);
    if (predecessor) persistPosition(predecessor);
    const saved = store.profile(user.id), id = store.clientId();
    const peer = { id, token, user, socket, alive: true, count: 0, window: Date.now(), persistedAt: Date.now(),
      movedAt: Date.now(), presence: { ...saved.state.position, id: user.id, name: user.name, rank: user.role, moving: 0, seq: 0 } };
    peers.set(id, peer);
    currentPeers.set(user.id, peer);
    if (predecessor) predecessor.socket.close(1008, "New connection");
    socket.send(JSON.stringify({ t: "welcome", clientId: id, room: "snej-1", user, profile: saved }));
    socket.send(JSON.stringify({ t: "peer.id.assigned", id: user.id, reason: "authenticated" }));
    for (const other of currentPeers.values()) if (other !== peer) socket.send(JSON.stringify({ t: "presence", clientId: other.id, presence: other.presence }));
    broadcast({ t: "presence", clientId: id, presence: peer.presence }, peer);
    socket.on("pong", () => { peer.alive = true; });
    socket.on("error", () => { socket.terminate(); });
    socket.on("message", (data, binary) => {
      try {
        if (currentPeers.get(user.id) !== peer) return;
        store.authenticate(token);
        const now = Date.now();
        if (now - peer.window >= 1000) { peer.window = now; peer.count = 0; }
        if (binary || ++peer.count > 30) reject("message_rate", 429);
        const message = JSON.parse(String(data));
        if (message.t === "hello") {
          // claimedId, name, room and rank never change the authenticated identity.
          socket.send(JSON.stringify({ t: "peer.id.assigned", id: user.id, reason: "authenticated" }));
        } else if (message.t === "presence") {
          const value = message.presence;
          const next = position({ x: value.x, y: value.y, z: value.z, yaw: value.yaw, pitch: value.pitch, view: value.view });
          const travel = Math.hypot(next.x - peer.presence.x, next.y - peer.presence.y, next.z - peer.presence.z);
          if (travel > 12 * Math.max(0, now - peer.movedAt) / 1000 + 1) reject("movement_too_fast");
          peer.movedAt = now;
          peer.presence = { ...next, id: user.id, name: user.name, rank: user.role, moving: Math.min(1, Math.max(0, Number(value.moving) || 0)), seq: peer.presence.seq + 1 };
          if (now - peer.persistedAt >= 1000) {
            const revision = store.updatePosition(user.id, next);
            peer.persistedAt = now;
            socket.send(JSON.stringify({ t: "profile.revision", revision }));
          }
          broadcast({ t: "presence", clientId: id, presence: peer.presence }, peer);
        } else if (message.t === "chat") {
          if (typeof message.text !== "string" || !message.text.trim() || message.text.length > 240) reject();
          broadcast({ t: "chat", clientId: id, id: user.id, name: user.name, rank: user.role, text: message.text.trim() });
        } else reject("unsupported_message");
      } catch (error) {
        if (error.status === 401 || error.status === 429) socket.close(1008, "Session or rate rejected");
        else socket.send(JSON.stringify({ t: "error", error: error instanceof RequestError ? error.code : "invalid_message" }));
      }
    });
    socket.on("close", () => {
      peers.delete(id);
      // Superseded sockets may close after their replacement; only the current owner saves.
      if (currentPeers.get(user.id) === peer) {
        currentPeers.delete(user.id);
        try {
          persistPosition(peer);
        } catch { /* Keep the last durable snapshot on shutdown failure. */ }
      }
      broadcast({ t: "leave", clientId: id });
    });
  });
  const heartbeat = setInterval(() => {
    for (const peer of peers.values()) {
      try { store.authenticate(peer.token); } catch { peer.socket.close(1008, "Session expired"); continue; }
      if (!peer.alive) { peer.socket.terminate(); continue; }
      peer.alive = false; peer.socket.ping();
    }
  }, 15000);
  heartbeat.unref();
  return { http, ws, config, peers, async close() {
    clearInterval(heartbeat);
    for (const peer of peers.values()) peer.socket.terminate();
    await new Promise((done) => ws.close(done));
    await new Promise((done) => http.close(done));
  } };
}
