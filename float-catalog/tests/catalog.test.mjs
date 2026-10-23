import test from "node:test";
import assert from "node:assert/strict";
import {readFile,access} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {escapeHTML,filterCatalog,validateImport,ratingLabel,modelingBrief} from "../catalog-utils.js";

const root = new URL("../",import.meta.url);
const raw = await readFile(new URL("data/catalog.json",root),"utf8");
const {items} = JSON.parse(raw);

test("catalog preserves the requested set and explicitly records missing facts", () => {
  assert.equal(items.length,55);
  assert.equal(new Set(items.map((item) => item.id)).size,55);
  assert.equal(items.filter((item) => item.rating === null).length,10);
  assert.equal(items.filter((item) => !item.image).length,1);
  assert.equal(items.find((item) => item.id === "F53").imageStatus,"missing-source");
  assert.equal(ratingLabel(items.find((item) => item.id === "F20")),"4 + 4,5 g");
  assert.equal(items.find((item) => item.id === "F03").rating,"1");
  assert.equal(items.find((item) => item.id === "F06").rating,"1.6");
  assert.match(items.find((item) => item.id === "F09").dimensions,/assembly length unconfirmed/);
  assert.equal(items.find((item) => item.id === "F09").length,null);
  assert.equal(items.find((item) => item.id === "F40").length,null);
  assert.ok([...raw].every((character) => character.charCodeAt(0) < 128));
});

test("every illustrated catalog entry resolves to its own safe local image", async () => {
  for (const item of items) {
    assert.match(item.sourceUrl,/^https:\/\/ooo-badis\.ru\/catalog\//);
    if (!item.image) continue;
    assert.equal(item.image,`assets/floats/${item.id.toLowerCase()}.png`);
    await access(fileURLToPath(new URL(item.image,root)));
    assert.equal(item.imageStatus,"ready");
  }
});

test("search finds source names, variants, and saved modeling status", () => {
  const sourceTerm = items.find((item) => item.id === "F02").sourceName.split(" ")[2];
  assert.ok(filterCatalog(items,{query:sourceTerm}).some((item) => item.id === "F02"));
  assert.deepEqual(filterCatalog(items,{brand:"Wormix",status:"queued"},{F08:{status:"queued"}}).map((item) => item.id),["F08"]);
  assert.equal(filterCatalog(items,{query:"no-such-float"}).length,0);
  const sorted = filterCatalog(items,{sort:"rating"});
  assert.equal(sorted.at(-1).rating,null);
});

test("invalid backup is rejected before notes can be written", () => {
  const valid = {kind:"float-atlas-backup",schemaVersion:1,annotations:[{id:"F01",status:"modeling",notes:"Measured in Blender"}]};
  assert.equal(validateImport(valid,items)[0].notes,"Measured in Blender");
  for (const annotations of [
    [{id:"F99",status:"reference",notes:""}],
    [{id:"F01",status:"unknown",notes:""}],
    [{id:"F01",status:"reference",notes:17}],
    [{id:"F01",status:"reference",notes:"x".repeat(20001)}],
    [valid.annotations[0],valid.annotations[0]]
  ]) assert.throws(() => validateImport({...valid,annotations},items));
  assert.throws(() => validateImport({...valid,schemaVersion:2},items));
});

test("external strings are escaped and the 3D brief retains source and limitations", () => {
  assert.equal(escapeHTML('<img onerror="bad">'),"&lt;img onerror=&quot;bad&quot;&gt;");
  const brief = modelingBrief(items[0],{status:"queued",notes:"Keep the eye separate."});
  assert.ok(brief.includes(items[0].sourceName));
  assert.ok(brief.includes(items[0].sourceUrl));
  assert.match(brief,/not measured/);
  assert.match(brief,/Keep the eye separate/);
});
