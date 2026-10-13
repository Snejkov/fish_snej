import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../app.mjs";
import { GameStore } from "../store.mjs";
import { releaseRoot } from "../paths.mjs";

let WebSocketServer;
try { ({ WebSocketServer } = await import("ws")); }
catch (error) {
  if (!process.env.SNEJ_TEST_WS_BUNDLE) throw error;
  WebSocketServer = createRequire(import.meta.url)(process.env.SNEJ_TEST_WS_BUNDLE).wsServer;
}

test("real static host serves the declared Apple icon without opening sibling or private paths", { timeout: 10000 }, async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "snej-apple-static-test-"));
  await mkdir(join(fixtureRoot, "icons"));
  for (const path of ["index.html", "icons/apple-touch-icon.png", "icons/apple-touch-icon.svg"]) {
    await copyFile(join(releaseRoot, path), join(fixtureRoot, path));
  }
  // An existing sibling must stay private, not just return 404 because it is absent.
  await writeFile(join(fixtureRoot, "icons", "other.png"), "Unlisted fixture asset");
  const store = new GameStore(":memory:");
  const app = createApp({ store, WebSocketServer, staticRoot: fixtureRoot,
    publicOrigin: "http://127.0.0.1", secure: false, guestOnly: true });
  app.http.listen(0, "127.0.0.1");
  await once(app.http, "listening");
  const origin = `http://127.0.0.1:${app.http.address().port}`;
  app.config.publicOrigin = origin;
  try {
    const page = await fetch(origin + "/");
    assert.equal(page.status, 200);
    const html = await page.text();
    const href = html.match(/<link rel="apple-touch-icon"[^>]*href="([^"]+)"/)?.[1];
    assert.ok(href, "The icon check follows the actual launch metadata.");
    const iconUrl = new URL(href, origin + "/");
    assert.equal(iconUrl.pathname, "/icons/apple-touch-icon.png");
    assert.equal(iconUrl.search, "?v=apple-home-1");
    for (const [path, type] of [[iconUrl.pathname + iconUrl.search, "image/png"],
      ["/icons/apple-touch-icon.svg?v=apple-home-1", "image/svg+xml"]]) {
      const response = await fetch(origin + path);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("content-type"), type);
      assert.equal(response.headers.get("cache-control"), "no-cache");
      assert.equal(response.headers.get("x-content-type-options"), "nosniff");
      const expected = await readFile(new URL("../../" + path.split("?")[0].slice(1), import.meta.url));
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), expected);
      const head = await fetch(origin + path, { method: "HEAD" });
      assert.equal(head.status, 200);
      assert.equal(head.headers.get("content-type"), type);
      assert.equal(Number(head.headers.get("content-length")), expected.length);
      assert.equal((await head.arrayBuffer()).byteLength, 0);
    }
    for (const path of ["/icons/", "/icons/other.png", "/icons/apple-touch-icon.png/extra",
      "/icons/%2e%2e%2findex.html", "/icons/%2e%2e%2fserver/app.mjs", "/icons/%5cindex.html",
      "/.env", "/.git/config", "/server/app.mjs", "/server/APPLE_HOME_SCREEN.md"]) {
      const response = await fetch(origin + path);
      assert.equal(response.status, 404, path);
      await response.arrayBuffer();
    }
    const profile = await fetch(origin + "/api/profile");
    assert.equal(profile.status, 401);
    await profile.arrayBuffer();
  } finally { await app.close(); store.close(); await rm(fixtureRoot, { recursive: true, force: true }); }
});
