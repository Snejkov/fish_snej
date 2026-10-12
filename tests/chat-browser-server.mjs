import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createApp } from "../server/app.mjs";
import { GameStore } from "../server/store.mjs";
let WebSocketServer;
try { WebSocketServer = createRequire(new URL("../server/package.json", import.meta.url))("ws").WebSocketServer; }
catch (error) {
  if (!process.env.SNEJ_TEST_WS_BUNDLE) throw error;
  WebSocketServer = createRequire(import.meta.url)(process.env.SNEJ_TEST_WS_BUNDLE).wsServer;
}
// Test-only, loopback-only and memory-only: never uses the public player database.
const store = new GameStore(":memory:");
const app = createApp({ store, WebSocketServer, staticRoot: resolve("."),
  publicOrigin: "http://127.0.0.1:8012", secure: false, guestOnly: true });
const handler = app.http.listeners("request")[0];
app.http.removeListener("request", handler);
app.http.on("request", async (req, res) => {
  if (req.url === "/qa.html" || req.url === "/index.html?chatqa") {
    let contents = await readFile(req.url === "/qa.html" ? "tests/chat-browser.html" : "index.html", "utf8");
    if (req.url !== "/qa.html") contents = contents.replace("</head>", `<script>
      const nativeMatchMedia = window.matchMedia.bind(window);
      window.matchMedia = (query) => { const result = nativeMatchMedia(query);
        if (query === '(pointer: coarse)' || query === '(any-pointer: coarse)') Object.defineProperty(result, 'matches', { value: true }); return result; };
      Object.defineProperty(navigator, 'maxTouchPoints', { value: 5 });
      </script></head>`);
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    res.end(contents);
  } else handler(req, res);
});
app.http.listen(8012, "127.0.0.1", () => console.info("Isolated memory-only chat QA: http://127.0.0.1:8012/qa.html (second browser: /)"));
