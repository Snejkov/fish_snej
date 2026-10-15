import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { readFileSync } from "node:fs";
registerHooks({resolve(s,c,n){return s==="three"?{url:new URL("../vendor/three.module.min.js",import.meta.url).href,shortCircuit:true}:n(s,c);}});
const THREE=await import("three");
const {SnejAngler}=await import("../src/angler.js");
const {createManSkin,skinFactory}=await import("../src/skins.js");
const {SKIN_DATA:data}=await import("../src/assets/man-skin/skinData.js");
test("The supplied GLB is compact, weighted, textured and the only active model",()=>{
  assert.equal(data.triangleCount,45188);assert.ok(data.triangleCount<data.sourceTriangles/5);
  const rig=new SnejAngler({modelFactory:createManSkin});
  assert.equal(rig.model.group.name,"ManAnglerModel");
  for(const id of ["man","angler","elise","zubenko",null,"../asset"])assert.equal(skinFactory(id),createManSkin);
  assert.equal(rig.skeleton.bones.length,24);assert.equal(rig.model.skeleton.bones.length,28);
  assert.equal(rig.model.meshes.reduce((n,m)=>n+m.geometry.index.count/3,0),45188);
  for(const texture of data.textures){const bytes=readFileSync(new URL(`../src/assets/man-skin/${texture.name}.png`,import.meta.url));const size=texture.name==="man_basecolor"?2048:1024;assert.equal(bytes.readUInt32BE(16),size);assert.equal(bytes.readUInt32BE(20),size);}
  const geometry=rig.model.meshes[0].geometry;
  for(let i=0;i<data.vertexCount;i++){
    let sum=0;for(let j=0;j<4;j++){const index=geometry.attributes.skinIndex.array[i*4+j];assert.ok(index<28);sum+=geometry.attributes.skinWeight.array[i*4+j];}
    assert.ok(Math.abs(sum-1)<1e-6);
  }
  rig.model.dispose();
});

test("Face UVs align with the eye sockets and never cross atlas islands",()=>{
  const unpack=(value,Type)=>{const bytes=Buffer.from(value,"base64");return new Type(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));};
  const positions=unpack(data.positions,Float32Array),uv=unpack(data.uv,Float32Array),normals=unpack(data.normals,Float32Array),triangles=unpack(data.triangles,Uint16Array);
  assert.equal(data.faceCalibration,"socket-aligned-1");
  let closest=Infinity,eye=-1;
  for(let i=0;i<data.vertexCount;i++){
    const d=(positions[i*3]+.039841)**2+(positions[i*3+1]-1.662421)**2+(positions[i*3+2]-.112285)**2;
    if(d<closest){closest=d;eye=i;}
    assert.ok(Math.abs(Math.hypot(...normals.subarray(i*3,i*3+3))-1)<1e-5);
  }
  assert.ok(closest<.00001);
  assert.ok(Math.hypot(uv[eye*2]-.547825,uv[eye*2+1]-.808512)<.003,"The eye-socket vertex samples the painted eye, not forehead skin.");
  for(let i=0;i<triangles.length;i+=4){
    const ids=[triangles[i],triangles[i+1],triangles[i+2]];
    if(!ids.every(v=>positions[v*3+1]>1.5))continue;
    for(let edge=0;edge<3;edge++){
      const a=ids[edge],b=ids[(edge+1)%3];
      assert.ok(Math.hypot(uv[a*2]-uv[b*2],uv[a*2+1]-uv[b*2+1])<.05,"Head triangles must remain inside their authored UV charts.");
    }
  }
});
test("New-model animation never alters physical joints, casting or vertical retrieval",()=>{
  for(const fps of [30,60,144]){
    const rig=new SnejAngler({modelFactory:createManSkin}),reference=new SnejAngler();
    const camera=new THREE.PerspectiveCamera(70,16/9,.05,100);camera.position.set(0,1.62,0);camera.lookAt(0,1.3,10);
    for(const pose of [{speed:4,castState:"idle"},{speed:0,castState:"charge"},{castState:"wait"},{castState:"wait",rodLiftHeld:true},{castState:"flight",castRetrieving:true}]){
      const info={state:"playing",speed:0,directionX:0,directionZ:1,camera,castCamera:camera,cameraMode:"first-person",viewBlend:0,...pose};
      for(let i=0;i<fps*2;i++){rig.update(1/fps,info);reference.update(1/fps,info);assert.ok(rig.getRodTip().distanceTo(reference.getRodTip())<1e-8);assert.ok(rig.getRetrieveHand().distanceTo(reference.getRetrieveHand())<1e-8);}
      assert.ok([...rig.model.skeleton.boneMatrices].every(Number.isFinite));
      if(pose.castRetrieving)assert.ok(rig.rodLiftAngle>Math.PI/2-.01);
    }
    rig.model.dispose();reference.model.dispose();
  }
});
