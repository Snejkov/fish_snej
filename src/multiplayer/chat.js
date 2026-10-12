import { t, applyTranslations } from "../i18n.js";
import { CHAT_CHANNELS, CHAT_LIMIT, cleanChatText } from "./chatRules.js?v=chat-1";

export class SnejChatBuffer {
  constructor(limit = 40) {
    this.limit = limit;
    this.messages = [];
  }

  add(message) {
    this.messages.push(message);
    if (this.messages.length > this.limit) this.messages.splice(0, this.messages.length - this.limit);
  }

  list() {
    return this.messages.slice();
  }
}


export class SnejPlayerChat {
  constructor(game, parent) {
    this.game = game;
    this.open = false;
    this.unread = 0;
    this.buffer = new SnejChatBuffer();
    this.root = document.createElement("aside");
    this.root.id = "player-chat";
    this.root.className = "player-chat";
    this.root.hidden = true;
    this.root.innerHTML = `
      <div class="chat-preview" aria-live="polite" data-i18n-skip></div>
      <button type="button" class="chat-launcher secondary" aria-expanded="false" aria-controls="chat-panel"><span data-i18n="Chat">Chat</span> <span class="chat-unread" data-i18n-skip></span></button>
      <section id="chat-panel" class="chat-panel" aria-label="Player chat" hidden>
        <header><h2 data-i18n="Chat">Chat</h2><button type="button" class="chat-close secondary" aria-label="Close chat">X</button></header>
        <div class="chat-log" role="log" aria-live="polite" aria-relevant="additions" aria-label="Chat messages" tabindex="0" data-i18n-skip></div>
        <form class="chat-form">
          <label><span data-i18n="Channel">Channel</span><select aria-label="Chat channel"><option value="local">Local (100 m)</option><option value="global">Global</option></select></label>
          <div class="chat-compose"><input type="text" maxlength="${CHAT_LIMIT}" autocomplete="off" autocapitalize="sentences" placeholder="Message" aria-label="Chat message"><button type="submit" data-i18n="Send">Send</button></div>
        </form>
        <p class="chat-status" role="status"></p>
      </section>`;
    parent.appendChild(this.root);
    this.launcher = this.root.querySelector(".chat-launcher");
    this.panel = this.root.querySelector(".chat-panel");
    this.preview = this.root.querySelector(".chat-preview");
    this.log = this.root.querySelector(".chat-log");
    this.input = this.root.querySelector("input");
    this.channel = this.root.querySelector("select");
    this.status = this.root.querySelector(".chat-status");
    this.launcher.addEventListener("click", () => this.toggle(true));
    this.root.querySelector(".chat-close").addEventListener("click", () => this.toggle(false));
    this.root.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.code === "Escape") { event.preventDefault(); this.toggle(false); }
    });
    this.root.querySelector("form").addEventListener("submit", (event) => {
      event.preventDefault();
      const text = cleanChatText(this.input.value);
      if (!text) return;
      if (!this.game.multiplayer?.sendChat(text, this.channel.value)) {
        this.error("offline");
        return;
      }
      this.status.textContent = "";
      this.statusKey = "";
      this.input.value = "";
      this.input.focus();
    });
    this.channel.addEventListener("change", () => { this.status.textContent = ""; this.statusKey = ""; });
    const viewport = window.visualViewport;
    this.resize = () => {
      const height = viewport?.height || window.innerHeight;
      this.root.style.setProperty("--chat-height", `${height}px`);
      this.root.style.setProperty("--chat-keyboard-gap", `${Math.max(0, window.innerHeight - height - (viewport?.offsetTop || 0))}px`);
    };
    window.addEventListener("resize", this.resize);
    viewport?.addEventListener("resize", this.resize);
    viewport?.addEventListener("scroll", this.resize);
    this.resize();
    this.translate();
  }

  available() {
    const ui = this.game.ui;
    return this.game.mode === "playing" && this.game.multiplayer?.connected
      && !ui.buildOpen && !ui.profileOpen && !ui.inventoryOpen && !ui.modalOpen && !ui.rosterOpen;
  }

  update() {
    const available = this.available();
    if (!available && this.open) this.toggle(false);
    this.root.hidden = !available;
  }

  toggle(show = !this.open) {
    if (show && !this.available()) return;
    this.open = Boolean(show);
    this.root.classList.toggle("chat-open", this.open);
    this.panel.hidden = !this.open;
    this.launcher.hidden = this.open;
    this.preview.hidden = this.open;
    this.launcher.setAttribute("aria-expanded", String(this.open));
    this.game.keys.clear();
    this.game.mouse.dx = this.game.mouse.dy = 0;
    this.game.mobileInput?.reset();
    if (this.open) {
      this.game.cancelCastAction();
      if (document.pointerLockElement) document.exitPointerLock();
      this.unread = 0;
      this.updateUnread();
      this.input.focus();
      this.log.scrollTop = this.log.scrollHeight;
    } else {
      this.input.blur();
    }
  }

  receive(message) {
    const text = cleanChatText(message?.text), channel = message?.channel ?? "global";
    if (!text || !CHAT_CHANNELS.includes(channel) || typeof message.name !== "string") return;
    const value = { channel, text, name: message.name.slice(0, 20), id: Number(message.id) || 0 };
    this.buffer.add(value);
    const nearBottom = this.log.scrollHeight - this.log.scrollTop - this.log.clientHeight < 48;
    this.log.appendChild(this.row(value));
    while (this.log.children.length > this.buffer.limit) this.log.firstChild.remove();
    this.renderPreview();
    if (nearBottom) this.log.scrollTop = this.log.scrollHeight;
    if (!this.open) this.unread = Math.min(99, this.unread + 1);
    this.updateUnread();
  }

  row(message) {
    const row = document.createElement("p");
    row.className = `chat-message chat-${message.channel}`;
    const label = document.createElement("span"), author = document.createElement("strong"), text = document.createElement("span");
    label.className = "chat-channel-label";
    label.textContent = `[${t(message.channel === "local" ? "Local" : "Global")}] `;
    author.textContent = `${message.name} #${message.id}: `;
    text.textContent = message.text;
    row.append(label, author, text);
    return row;
  }

  renderPreview() {
    this.preview.replaceChildren(...this.buffer.list().slice(-3).map((message) => this.row(message)));
  }

  updateUnread() {
    this.root.querySelector(".chat-unread").textContent = this.unread ? `(${this.unread})` : "";
  }

  error(code) {
    this.statusKey = code === "chat_rate_limited" ? "Please wait before sending another message."
      : code === "offline" ? "Chat is unavailable while offline." : "Message was rejected.";
    this.status.textContent = t(this.statusKey);
  }

  translate() {
    applyTranslations(this.root);
    this.log.setAttribute("aria-label", t("Chat messages"));
    const top = this.log.scrollTop;
    this.log.replaceChildren(...this.buffer.list().map((message) => this.row(message)));
    this.log.scrollTop = top;
    this.renderPreview();
    if (this.statusKey && this.status.textContent) this.status.textContent = t(this.statusKey);
  }
}
