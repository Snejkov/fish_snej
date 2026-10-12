import { WebSocketServer } from "ws";
import { GameStore } from "./store.mjs";
import { createApp } from "./app.mjs";
import { resolve } from "node:path";
import { privateDataDirectory, releaseRoot } from "./paths.mjs";

const staticRoot = releaseRoot;
const publicOrigin = new URL(process.env.PUBLIC_ORIGIN || "http://127.0.0.1:8080");
const host = process.env.HOST || "127.0.0.1", port = Number(process.env.PORT || 8080);
const guestOnly = process.env.SNEJ_GUEST_ONLY === "1";
if (publicOrigin.origin !== String(process.env.PUBLIC_ORIGIN || publicOrigin.origin)
  || !["https:", "http:"].includes(publicOrigin.protocol)
  || (publicOrigin.protocol === "http:" && !guestOnly && !["127.0.0.1", "localhost", "[::1]"].includes(publicOrigin.hostname))
  || !["127.0.0.1", "::1", ...(guestOnly ? ["0.0.0.0"] : [])].includes(host) || !Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("Use HTTPS and loopback for accounts; public HTTP/listening requires explicit guest-only mode.");
}
const actualData = privateDataDirectory(process.env.SNEJ_DATA_DIR);
const store = new GameStore(resolve(actualData, "game.sqlite"));
const app = createApp({ store, WebSocketServer, staticRoot, publicOrigin: publicOrigin.origin, secure: publicOrigin.protocol === "https:", guestOnly });
app.http.listen(port, host, () => console.info(`SnejFishing backend listening on ${host}:${port}`));
let closing = false;
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, async () => {
  if (closing) return;
  closing = true;
  await app.close(); store.close();
});
