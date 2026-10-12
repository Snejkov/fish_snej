import { resolve, relative, isAbsolute, sep } from "node:path";
import { mkdirSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const releaseRoot = realpathSync(fileURLToPath(new URL("../", import.meta.url)));
const inside = (root, target) => {
  const path = relative(root, target);
  return !isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`);
};
export function privateDataDirectory(value) {
  if (!value || !isAbsolute(value)) throw new Error("Set an absolute SNEJ_DATA_DIR outside the release root.");
  const path = resolve(value);
  if (inside(releaseRoot, path)) throw new Error("Data must be outside the public release root.");
  mkdirSync(path, { recursive: true, mode: 0o700 });
  const actual = realpathSync(path);
  if (inside(releaseRoot, actual)) throw new Error("Data symlink points inside the public release root.");
  return actual;
}
