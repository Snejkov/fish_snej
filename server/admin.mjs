import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { GameStore } from "./store.mjs";
import { hashPassword } from "./auth.mjs";
import { privateDataDirectory } from "./paths.mjs";

const [command, file] = process.argv.slice(2);
const dataDir = process.env.SNEJ_DATA_DIR;
if (!dataDir || !["provision-owner", "grant-owner", "show-owner"].includes(command)) {
  console.error("Set SNEJ_DATA_DIR outside the release. Commands: provision-owner <trusted-profile.json>, grant-owner, show-owner.");
  process.exitCode = 1;
} else {
  const store = new GameStore(resolve(privateDataDirectory(dataDir), "game.sqlite"));
  try {
    let result;
    if (command === "provision-owner") {
      if (!file) throw new Error("A verified trusted baseline is required.");
      const password = readFileSync(0, "utf8").replace(/\r?\n$/, "");
      const trusted = JSON.parse(readFileSync(file, "utf8"));
      result = store.provisionOwner(await hashPassword(password), trusted);
      result = { created: result.created, id: result.profile.user.id, coins: result.profile.coins, revision: result.profile.revision };
    } else if (command === "grant-owner") result = store.grantOwner();
    else {
      const profile = store.profile(1);
      result = { id: profile.user.id, coins: profile.coins, revision: profile.revision };
    }
    console.info(JSON.stringify(result));
  } catch (error) { console.error(error.code || error.message); process.exitCode = 1; }
  finally { store.close(); }
}
