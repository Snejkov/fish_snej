import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {createHash} from "node:crypto";

const root=new URL("../",import.meta.url);
const models=JSON.parse(await readFile(new URL("data/models.json",root),"utf8")).models;
const thumbnails=JSON.parse(await readFile(new URL("data/thumbnails.json",root),"utf8")).items;
const imported=JSON.parse(await readFile(new URL("data/library-import.json",root),"utf8")).models;
const sha=bytes=>createHash("sha256").update(bytes).digest("hex");

test("each thumbnail is tied to the exact GLB and ID, independently of contact-sheet positions",async()=>{
  assert.equal(thumbnails.length,54);
  assert.equal(new Set(thumbnails.map(i=>i.id)).size,54);
  for (const model of models) {
    const icon=thumbnails.find(i=>i.id===model.id);
    const slug=model.id.toLowerCase();
    assert.equal(icon.modelPath,`assets/models/${slug}/${slug}.glb`);
    assert.equal(icon.thumbnailPath,`assets/thumbnails/${slug}.webp`);
    assert.equal(sha(await readFile(new URL(icon.modelPath,root))),icon.modelSha256);
    const bytes=await readFile(new URL(icon.thumbnailPath,root));
    assert.equal(sha(bytes),icon.thumbnailSha256);
    assert.equal(bytes.subarray(8,12).toString(),"WEBP");
    assert.ok(bytes.includes(Buffer.from("VP8 ")));
    assert.equal(icon.triangles,model.triangles);
    assert.ok(Math.abs(icon.sourceLengthMm-model.lengthMm)<.001);
    assert.equal(icon.method,"Individual GLB import and orthographic front render");
    assert.equal(icon.width,600);
    assert.equal(icon.height,450);
    assert.equal(icon.quality,90);
  }
});

test("published cards reference the matching rendered icon and invalidate old crops",()=>{
  for (const model of imported) {
    const icon=thumbnails.find(i=>i.id===model.key);
    assert.equal(model.thumbnailModelSha256,icon.modelSha256);
    assert.equal(model.thumbnailSha256,icon.thumbnailSha256);
    assert.equal(model.thumbnail,`thumbnails/floats/${model.key.toLowerCase()}.webp?v=${icon.thumbnailSha256.slice(0,12)}`);
  }
});
