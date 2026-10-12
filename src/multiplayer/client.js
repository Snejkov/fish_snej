import { decodeMessage, encodeMessage, MESSAGE_TYPES } from "./protocol.js";

export class SnejMultiplayerClient {
  constructor(options = {}) {
    this.socket = null;
    this.connected = false;
    this.clientId = null;
    this.room = "";
    this.identity = { id: 0, name: "Player" };
    this.rank = "player";
    this.authenticated = Boolean(options.authenticated);
    this.onWelcome = options.onWelcome || (() => {});
    this.onRevision = options.onRevision || (() => {});
    this.onSessionEnded = options.onSessionEnded || (() => {});
    this.onStatus = options.onStatus || (() => {});
    this.onPresence = options.onPresence || (() => {});
    this.onLeave = options.onLeave || (() => {});
    this.onPlacements = options.onPlacements || (() => {});
    this.onIdentityAssigned = options.onIdentityAssigned || (() => {});
    this.onChat = options.onChat || (() => {});
  }

  connect(room, identity, rank) {
    this.disconnect(false);
    this.room = String(room || "snej-1").slice(0, 32);
    this.identity = { id: Number(identity?.id) || 0, name: String(identity?.name || "Player").slice(0, 20) };
    this.rank = String(rank || "player");
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${protocol}//${location.host}/ws?room=${encodeURIComponent(this.room)}&name=${encodeURIComponent(this.identity.name)}`;
    const local = location.hostname === "localhost" || location.hostname === "127.0.0.1";
    if (!this.authenticated && local && !new URLSearchParams(location.search).has("mpconnect")) {
      console.info(`Multiplayer scaffold would connect to ${url}`);
      this.onStatus("Offline scaffold");
      return false;
    }
    this.onStatus("Connecting");
    try {
      this.socket = new WebSocket(url);
    } catch {
      this.onStatus("Connection failed");
      return false;
    }
    const socket = this.socket;
    socket.addEventListener("open", () => {
      if (this.socket !== socket) return;
      if (!this.authenticated) {
        this.connected = true;
        this.sendHello();
        this.onStatus(`Online: ${this.room}`);
      }
    });
    socket.addEventListener("message", (event) => {
      if (this.socket === socket) this.handleMessage(event.data);
    });
    socket.addEventListener("close", (event) => {
      if (this.socket !== socket) return;
      this.connected = false;
      this.socket = null;
      this.onStatus("Offline");
      if (this.authenticated && event.code === 1008) this.onSessionEnded();
    });
    socket.addEventListener("error", () => {
      if (this.socket === socket) this.onStatus("Connection failed");
    });
    return true;
  }

  sendHello() {
    return this.send(MESSAGE_TYPES.HELLO, {
      room: this.room,
      name: this.identity.name,
      claimedId: this.identity.id,
      rank: this.rank
    });
  }

  updateIdentity(identity, rank) {
    this.identity = { id: Number(identity?.id) || 0, name: String(identity?.name || "Player").slice(0, 20) };
    this.rank = String(rank || "player");
    if (this.connected) this.sendHello();
  }

  reconnect(identity, rank) {
    const room = this.room;
    this.disconnect(false);
    return this.connect(room, identity, rank);
  }

  handleMessage(data) {
    const message = decodeMessage(data);
    if (!message) return;
    if (message.type === MESSAGE_TYPES.WELCOME) {
      this.clientId = message.clientId || null;
      this.connected = true;
      this.onWelcome(message);
      this.onStatus(`Online: ${this.room}`);
    }
    if (message.type === "profile.revision") this.onRevision(message.revision);
    if (message.type === MESSAGE_TYPES.ID_ASSIGNED) this.onIdentityAssigned({
      id: Number(message.id) || 0,
      reason: String(message.reason || "accepted")
    });
    if (message.type === MESSAGE_TYPES.PRESENCE && message.clientId !== this.clientId) this.onPresence(message);
    if (message.type === MESSAGE_TYPES.LEAVE) this.onLeave(message.clientId);
    if (message.type === MESSAGE_TYPES.PLACEMENTS && message.clientId !== this.clientId) this.onPlacements(message.placements || []);
    if (message.type === MESSAGE_TYPES.CHAT) this.onChat(message);
  }

  send(type, payload = {}) {
    if (!this.connected || !this.socket || this.socket.readyState !== WebSocket.OPEN) return false;
    this.socket.send(encodeMessage(type, payload));
    return true;
  }

  sendPresence(presence) {
    return this.send(MESSAGE_TYPES.PRESENCE, { presence });
  }

  sendPlacements(placements) {
    if (this.authenticated) return false;
    return this.send(MESSAGE_TYPES.PLACEMENTS, { placements });
  }

  sendChat(text) {
    const clean = String(text || "").trim().slice(0, 240);
    if (clean) this.send(MESSAGE_TYPES.CHAT, { text: clean });
  }

  disconnect(notify = true) {
    if (this.socket) this.socket.close(1000, "Client disconnected");
    this.socket = null;
    this.connected = false;
    this.clientId = null;
    if (notify) this.onStatus("Offline");
  }
}
