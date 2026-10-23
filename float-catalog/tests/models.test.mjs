import test from "node:test";
import assert from "node:assert/strict";
import {readFile,stat} from "node:fs/promises";

const root=new URL("../",import.meta.url);
const catalog=JSON.parse(await readFile(new URL("data/catalog.json",root),"utf8"));
const manifest=JSON.parse(await readFile(new URL("data/models.json",root),"utf8"));

test("every usable reference has its own model with unchanged source identity",() => {
  assert.equal(manifest.models.length,54);
  assert.deepEqual(manifest.models.map(m=>m.id),catalog.items.filter(i=>i.image).map(i=>i.id));
  for (const model of manifest.models) {
    const item=catalog.items.find(i=>i.id===model.id);
    assert.equal(model.sourceName,item.sourceName);
    assert.equal(model.rating,item.rating);
    assert.equal(item.model.lengthMm,model.lengthMm);
    assert.equal(model.exportUpAxis,"Y");
    assert.equal(model.units,"meters");
    assert.equal(model.meshes,1);
    assert.equal(model.materials,1);
    assert.equal(model.uvLayers,1);
    assert.ok(model.triangles<=1000);
  }
  assert.equal(manifest.missing[0].id,"F53");
});

test("source lengths are distinct from estimates and all dimensions survive FBX reimport",() => {
  assert.equal(manifest.models.filter(m=>m.scaleBasis==="catalog-length").length,14);
  assert.equal(manifest.models.filter(m=>m.scaleBasis==="estimated").length,39);
  const midpoint=manifest.models.filter(m=>m.scaleBasis==="catalog-range-midpoint");
  assert.equal(midpoint.length,1);
  assert.equal(midpoint[0].id,"F47");
  assert.equal(midpoint[0].lengthMm,195);
  for (const m of manifest.models) {
    assert.ok(m.dimensionNote.includes("approximate"));
    assert.equal(m.validation.fbxReimport,"passed");
    assert.equal(m.validation.embeddedBytesMatch,true);
    for (let axis=0;axis<3;axis++) assert.ok(Math.abs(m.dimensionsMm[axis]-m.validation.reimportedDimensionsMm[axis])<.001);
    assert.ok(Math.abs(m.dimensionsMm[2]-m.lengthMm)<.001);
  }
});

test("FBX embeds the actual lossy WebP and each GLB is self-contained",async () => {
  for (const model of manifest.models) {
    const slug=model.id.toLowerCase();
    const folder=new URL(`assets/models/${slug}/`,root);
    const [fbx,webp,glb]=await Promise.all([readFile(new URL(model.files.fbx,folder)),readFile(new URL("basecolor.webp",folder)),readFile(new URL(model.files.glb,folder))]);
    assert.equal(fbx.subarray(0,18).toString(),"Kaydara FBX Binary");
    assert.ok(fbx.indexOf(webp)>0);
    assert.equal(webp.subarray(0,4).toString(),"RIFF");
    assert.equal(webp.subarray(8,12).toString(),"WEBP");
    assert.ok(webp.indexOf(Buffer.from("VP8 "))>=0);
    const size=glb.readUInt32LE(12);
    const json=JSON.parse(glb.subarray(20,20+size).toString());
    assert.ok(json.extensionsRequired.includes("EXT_texture_webp"));
    assert.ok(json.buffers.every(b=>!b.uri));
    assert.ok(json.images.every(i=>i.mimeType==="image/webp" && i.bufferView!==undefined));
    assert.ok(json.meshes.every(mesh=>mesh.primitives.every(p=>p.attributes.TEXCOORD_0!==undefined && p.attributes.TEXCOORD_1===undefined)));
    if (slug==="f11") assert.equal(json.materials[0].alphaMode,"BLEND");
    assert.ok((await stat(new URL(`downloads/${slug}.zip`,root))).size>1000);
  }
  assert.ok((await stat(new URL("downloads/float-models-all.zip",root))).size>1000000);
});
