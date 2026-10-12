import test from "node:test";
import assert from "node:assert/strict";
import { CHAT_LIMIT, CHAT_RADIUS, cleanChatText, receivesChat, consumeChatToken } from "../src/multiplayer/chatRules.js";
import { SnejChatBuffer, SnejPlayerChat } from "../src/multiplayer/chat.js";
import { SnejMultiplayerClient } from "../src/multiplayer/client.js";

test("chat uses a strict 100-meter horizontal radius, safe text and a bounded history", () => {
  assert.equal(CHAT_RADIUS, 100);
  assert.equal(CHAT_LIMIT, 240);
  const sender = { x: 4, y: 1, z: -3 };
  assert.equal(receivesChat("local", sender, { x: 64, y: 80, z: 77 }), true);
  assert.equal(receivesChat("local", sender, { x: 104.01, z: -3 }), false);
  assert.equal(receivesChat("global", sender, { x: 500, z: 500 }), true);
  assert.equal(receivesChat("local", sender, { x: NaN, z: 0 }), false);
  assert.equal(receivesChat("team", sender, sender), false);
  assert.equal(cleanChatText("  Hi\nthere\u0000!  "), "Hi there !");
  assert.equal(cleanChatText(" "), "");
  assert.equal(cleanChatText({ text: "x" }), "");
  assert.equal(cleanChatText("x".repeat(241)), "");
  const buffer = new SnejChatBuffer(40);
  for (let i = 0; i < 55; i++) buffer.add({ text: String(i) });
  assert.equal(buffer.list().length, 40);
  assert.equal(buffer.list()[0].text, "15");
  buffer.list().pop();
  assert.equal(buffer.list().length, 40);
});

test("chat flood protection refills without disconnecting or coupling to movement", () => {
  const peer = {};
  for (let i = 0; i < 4; i++) assert.equal(consumeChatToken(peer, 10000), true);
  assert.equal(consumeChatToken(peer, 10000), false);
  assert.equal(consumeChatToken(peer, 12499), false);
  assert.equal(consumeChatToken(peer, 12500), true);
  assert.equal(consumeChatToken(peer, 12500), false);
  assert.equal(consumeChatToken(peer, 22500), true);
});

test("client includes the selected channel and reports delivery failures", () => {
  const sent = [], received = [], errors = [];
  const client = new SnejMultiplayerClient({ onChat: (v) => received.push(v), onChatError: (v) => errors.push(v) });
  client.send = (type, payload) => { sent.push({ type, ...payload }); return true; };
  assert.equal(client.sendChat(" Hi ", "local"), true);
  assert.deepEqual(sent[0], { type: "chat", text: "Hi", channel: "local" });
  assert.equal(client.sendChat("Hi", "global"), true);
  assert.equal(client.sendChat(" ", "global"), false);
  assert.equal(client.sendChat("Hi", "team"), false);
  client.send = () => false;
  assert.equal(client.sendChat("Hi"), false);
  client.handleMessage(JSON.stringify({ t: "chat", text: "Hi", channel: "global", name: "LakeFriend", id: 3 }));
  client.handleMessage(JSON.stringify({ t: "chat.error", error: "chat_rate_limited" }));
  assert.equal(received.length, 1);
  assert.deepEqual(errors, ["chat_rate_limited"]);
});

test("chat display treats names and content as plain text, never HTML", () => {
  const previous = globalThis.document;
  const make = () => ({ children: [], append(...children) { this.children.push(...children); } });
  globalThis.document = { createElement: make };
  try {
    const message = { channel: "global", name: "<img onerror=x>", id: 3, text: "<script>alert(1)</script>" };
    const row = SnejPlayerChat.prototype.row(message);
    assert.equal(row.children[1].textContent, "<img onerror=x> #3: ");
    assert.equal(row.children[2].textContent, message.text);
    assert.ok(row.children.every((child) => child.innerHTML === undefined));
  } finally { globalThis.document = previous; }
});
