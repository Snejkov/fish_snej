import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const root=new URL("../data/",import.meta.url);
const {models}=JSON.parse(await readFile(new URL("library-import.json",root),"utf8"));
const source=JSON.parse(await readFile(new URL("models.json",root),"utf8")).models;
const feed=JSON.parse(await readFile(new URL("library-feed.json",root),"utf8"));

test("all reviewed float models enter the existing bobbers section with their own files",() => {
  assert.equal(models.length,54);
  assert.equal(new Set(models.map(m=>m.id)).size,54);
  for (const original of source) {
    const model=models.find(m=>m.key===original.id);
    const variant=model.variants[0];
    assert.equal(model.category,"bobbers");
    assert.ok(model.title.includes(original.sourceName));
    assert.equal(model.catalogRating,original.rating);
    assert.equal(model.scaleBasis,original.scaleBasis);
    assert.equal(variant.triangles,original.triangles);
    assert.ok(Math.abs(variant.dimensions[1]*1000-original.lengthMm)<.001);
    assert.match(variant.source,/\.fbx$/);
    assert.match(variant.url,/\.glb$/);
    assert.match(variant.texture,/\.webp$/);
    assert.match(model.archive,/\.zip$/);
  }
});

test("library upload does not claim game integration or invent the missing F53",() => {
  assert.ok(models.every(m=>m.usage.length===0));
  assert.ok(models.every(m=>m.description.includes("not connected to the game yet")));
  assert.ok(!models.some(m=>m.key==="F53"));
  assert.ok(models.filter(m=>m.scaleBasis==="estimated").every(m=>m.description.includes("no overall length is confirmed")));
});

test("server feed exposes stable model identities, runtime GLB, and verifiable downloads",() => {
  assert.equal(feed.schemaVersion,1);
  assert.equal(feed.units,"meters");
  assert.equal(feed.upAxis,"Y");
  assert.equal(feed.preferredRuntimeFormat,"glb");
  assert.equal(feed.glbTexturesEmbedded,true);
  assert.equal(feed.items.length,54);
  assert.match(feed.version,/^[a-f0-9]{64}$/);
  for (const item of feed.items) {
    assert.ok(source.some(m=>m.id===item.id && m.rating===item.rating));
    for (const kind of ["glb","fbx","texture","thumbnail","package"]) {
      const file=item.files[kind];
      assert.match(file.sha256,/^[a-f0-9]{64}$/);
      assert.ok(file.bytes>0);
      assert.ok(file.url.startsWith("http://144.31.28.132/"));
      assert.ok(file.url.endsWith("?v="+file.sha256.slice(0,12)));
    }
  }
});
