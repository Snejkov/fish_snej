import * as THREE from "three";
import { SKIN_DATA } from "./assets/angler-skin/skinData.js?v=uploaded-skin-1";

const BODY_MAP = {
  Root: ["Hips", "Pelvis"], Pelvis: ["Hips", "Pelvis"], Spine: ["Spine", "Spine"],
  Spine1: ["Chest", "Spine1"], Neck: ["Neck", "Neck"], Head: ["Head", "Head"],
  Jaw: ["Head", "Head"], "L Brow": ["Head", "Head"], "R Brow": ["Head", "Head"],
  "L breast": ["Chest", "Spine1"], "R breast": ["Chest", "Spine1"], Belly: ["Spine", "Spine"]
};
for (const [short, side] of [["L", "Left"], ["R", "Right"]]) {
  for (const [source, target] of [["Clavicle", "Shoulder"], ["UpperArm", "UpperArm"],
    ["ForeArm", "ForeArm"], ["Hand", "Hand"], ["Thigh", "UpperLeg"], ["Calf", "LowerLeg"],
    ["Foot", "Foot"], ["Toe0", "Toe"]]) {
    const name = source === "Clavicle" ? `Bip01 ${short} Clavicle` : `${short} ${source}`;
    BODY_MAP[name] = [`${side}${target}`, name];
  }
  for (const finger of ["Finger", "Finger01"]) BODY_MAP[`${short} ${finger}`] = [`${side}Hand`, `${short} Hand`];
}
BODY_MAP["R ForeArm"] = ["SkinRightForearm", "R ForeArm"];
BODY_MAP["R Hand"] = ["SkinRightPalm", "R Hand"];
BODY_MAP["R Finger"] = ["SkinRightFinger", "R Finger"];
BODY_MAP["R Finger01"] = ["SkinRightFingertip", "R Finger01"];
const NEXT_SOURCE = { Pelvis: "Spine1", Spine: "Spine1", Spine1: "Neck", Neck: "Head" };
const NEXT_TARGET = { Hips: "Spine", Spine: "Chest", Chest: "Neck", Neck: "Head" };
for (const [short, side] of [["L", "Left"], ["R", "Right"]]) {
  for (const [parent, child, target, next] of [["Clavicle", "UpperArm", "Shoulder", "UpperArm"],
    ["UpperArm", "ForeArm", "UpperArm", "ForeArm"], ["ForeArm", "Hand", "ForeArm", "Hand"],
    ["Hand", "Finger", "Hand", "HandTip"], ["Thigh", "Calf", "UpperLeg", "LowerLeg"],
    ["Calf", "Foot", "LowerLeg", "Foot"], ["Foot", "Toe0", "Foot", "Toe"]]) {
    const name = parent === "Clavicle" ? `Bip01 ${short} Clavicle` : `${short} ${parent}`;
    NEXT_SOURCE[name] = `${short} ${child}`;
    NEXT_TARGET[`${side}${target}`] = `${side}${next}`;
  }
}
NEXT_SOURCE["R Finger"] = "R Finger01";
NEXT_TARGET.SkinRightForearm = "SkinRightPalm";
NEXT_TARGET.SkinRightPalm = "SkinRightFinger";
NEXT_TARGET.SkinRightFinger = "SkinRightFingertip";

function decode(value, Type) {
  const bytes = Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
  return new Type(bytes.buffer);
}

const decodedSources = new WeakMap();
function sourceFor(data) {
  if (!decodedSources.has(data)) decodedSources.set(data, {
    positions: decode(data.positions, Float32Array), uv: decode(data.uv, Float32Array),
    indices: decode(data.skinIndices, Uint16Array), weights: decode(data.skinWeights, Float32Array),
    binds: decode(data.bindMatrices, Float32Array), triangles: decode(data.triangles, Uint16Array)
  });
  return decodedSources.get(data);
}

export function createUploadedSkin(skeleton, options = {}) {
  const data = options.data || SKIN_DATA;
  const SOURCE = sourceFor(data);
  const group = new THREE.Group();
  group.name = options.name || "UploadedAnglerModel";
  const meshes = [], materials = {}, textures = new Set();
  let disposed = false;
  const driverBones = Object.fromEntries(skeleton.bones.map((bone) => [bone.name, bone]));
  const extra = {};
  function skinBone(name, parent, x = 0) {
    const bone = new THREE.Bone();
    bone.name = name;
    bone.position.x = x;
    parent.add(bone);
    extra[name] = bone;
    return bone;
  }
  skinBone("SkinRightForearm", driverBones.RightForeArm);
  const palm = skinBone("SkinRightPalm", driverBones.RightHand);
  const finger = skinBone("SkinRightFinger", palm, -0.07);
  skinBone("SkinRightFingertip", finger, -0.039);
  driverBones.RightHand.updateWorldMatrix(true, true);
  driverBones.RightForeArm.updateWorldMatrix(true, true);
  // Appearance-only bones share the original drivers but never alter gameplay joints or sockets.
  const skinSkeleton = new THREE.Skeleton([...skeleton.bones, ...Object.values(extra)],
    [...skeleton.boneInverses.map((matrix) => matrix.clone()), ...Object.values(extra).map((bone) => bone.matrixWorld.clone().invert())]);
  const targetIndex = Object.fromEntries(skinSkeleton.bones.map((bone, index) => [bone.name, index]));
  const sourceIndex = Object.fromEntries(data.sourceBones.map((name, index) => [name, index]));
  const targets = skinSkeleton.boneInverses.map((inverse) => inverse.clone().invert());
  const sources = data.sourceBones.map((_, index) => new THREE.Matrix4().fromArray(SOURCE.binds, index * 16));
  const positionOf = (matrix) => new THREE.Vector3().setFromMatrixPosition(matrix);
  const transforms = data.sourceBones.map((name) => {
    const mapping = BODY_MAP[name];
    if (!mapping || targetIndex[mapping[0]] === undefined) throw new Error(`Unsupported skin bone: ${name}`);
    const [target, primary] = mapping;
    const sourcePosition = positionOf(sources[sourceIndex[primary]]);
    const targetPosition = positionOf(targets[targetIndex[target]]);
    const rotation = new THREE.Quaternion();
    let scale = 0.92;
    if (NEXT_SOURCE[primary] && NEXT_TARGET[target]) {
      const sourceDirection = positionOf(sources[sourceIndex[NEXT_SOURCE[primary]]]).sub(sourcePosition);
      const targetDirection = positionOf(targets[targetIndex[NEXT_TARGET[target]]]).sub(targetPosition);
      if (sourceDirection.lengthSq() > 1e-8 && targetDirection.lengthSq() > 1e-8) {
        if (/UpperArm|ForeArm|Hand|UpperLeg|LowerLeg|Foot|SkinRight/.test(target)) {
          scale = THREE.MathUtils.clamp(targetDirection.length() / sourceDirection.length(), 0.75, 1.25);
        }
        rotation.setFromUnitVectors(sourceDirection.normalize(), targetDirection.normalize());
      }
    }
    return new THREE.Matrix4().compose(targetPosition, rotation, new THREE.Vector3(scale, scale, scale))
      .multiply(new THREE.Matrix4().makeTranslation(-sourcePosition.x, -sourcePosition.y, -sourcePosition.z));
  });
  const handTransform = transforms[sourceIndex["R Hand"]];
  const handRotation = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().extractRotation(handTransform));
  const handScale = new THREE.Vector3().setFromMatrixScale(handTransform).x;
  for (const name of ["R Finger", "R Finger01"]) {
    const target = BODY_MAP[name][0];
    transforms[sourceIndex[name]] = new THREE.Matrix4().compose(positionOf(targets[targetIndex[target]]), handRotation,
      new THREE.Vector3(handScale, handScale, handScale)).multiply(new THREE.Matrix4().makeTranslation(...positionOf(sources[sourceIndex[name]]).negate().toArray()));
  }
  const handAxis = positionOf(targets[targetIndex.SkinRightFinger]).sub(positionOf(targets[targetIndex.SkinRightPalm])).normalize();
  const thumbDirection = new THREE.Vector3(0, 1, 1).transformDirection(sources[sourceIndex["R Hand"]])
    .applyQuaternion(handRotation).projectOnPlane(handAxis).normalize();
  let calibration;
  function updatePose(info, carry) {
    if (disposed || !carry) return;
    if (!calibration) {
      const shaft = new THREE.Vector3(0, 1, 0).applyQuaternion(carry.rod.quaternion).applyQuaternion(carry.rightSocket.quaternion).normalize();
      const thumbTarget = shaft.clone().projectOnPlane(handAxis).normalize();
      const roll = Math.atan2(handAxis.dot(thumbDirection.clone().cross(thumbTarget)), thumbDirection.dot(thumbTarget));
      const palmRotation = new THREE.Quaternion().setFromAxisAngle(handAxis, roll);
      const curlAxis = shaft.clone().applyQuaternion(palmRotation.clone().invert()).normalize();
      calibration = { roll, palmRotation, curlAxis };
    }
    extra.SkinRightPalm.quaternion.copy(calibration.palmRotation);
    extra.SkinRightForearm.quaternion.setFromAxisAngle(handAxis, calibration.roll * 0.5);
    extra.SkinRightFinger.quaternion.setFromAxisAngle(calibration.curlAxis, 95 * Math.PI / 180);
    extra.SkinRightFingertip.quaternion.setFromAxisAngle(calibration.curlAxis, 60 * Math.PI / 180);
  }

  const positions = new Float32Array(SOURCE.positions.length);
  const indices = new Uint16Array(SOURCE.indices.length), weights = new Float32Array(SOURCE.weights.length);
  const armWeights = new Float32Array(data.vertexCount);
  const point = new THREE.Vector3(), transformed = new THREE.Vector3(), output = new THREE.Vector3();
  for (let vertex = 0; vertex < data.vertexCount; vertex += 1) {
    point.fromArray(SOURCE.positions, vertex * 3);
    output.set(0, 0, 0);
    let sum = 0;
    for (let influence = 0; influence < 4; influence += 1) sum += SOURCE.weights[vertex * 4 + influence];
    if (!Number.isFinite(sum) || sum <= 0) throw new Error("Invalid uploaded skin weights");
    for (let influence = 0; influence < 4; influence += 1) {
      const offset = vertex * 4 + influence, sourceBone = SOURCE.indices[offset];
      const target = BODY_MAP[data.sourceBones[sourceBone]][0];
      const weight = SOURCE.weights[offset] / sum;
      indices[offset] = targetIndex[target];
      weights[offset] = weight;
      output.addScaledVector(transformed.copy(point).applyMatrix4(transforms[sourceBone]), weight);
      if (target === "RightForeArm" || target === "RightHand" || target.startsWith("SkinRight")) armWeights[vertex] += weight;
    }
    output.toArray(positions, vertex * 3);
  }

  if (options.fingertipWeights) {
    const palmInverse = targets[targetIndex.SkinRightPalm].clone().invert();
    const fingerIndex = targetIndex.SkinRightFinger, tipIndex = targetIndex.SkinRightFingertip;
    // The Elise source has no distal finger weights; blend its existing finger vertices onto the appearance-only tip joint.
    for (let vertex = 0; vertex < data.vertexCount; vertex += 1) {
      const offset = vertex * 4;
      const fingerSlot = [0, 1, 2, 3].find((slot) => indices[offset + slot] === fingerIndex && weights[offset + slot] > 0);
      const emptySlot = [0, 1, 2, 3].find((slot) => weights[offset + slot] === 0);
      if (fingerSlot === undefined || emptySlot === undefined) continue;
      point.fromArray(positions, vertex * 3).applyMatrix4(palmInverse);
      const blend = THREE.MathUtils.clamp((-point.x - 0.109) / 0.025, 0, 1);
      const tipWeight = weights[offset + fingerSlot] * blend;
      indices[offset + emptySlot] = tipIndex;
      weights[offset + emptySlot] = tipWeight;
      weights[offset + fingerSlot] -= tipWeight;
    }
  }

  const full = new THREE.BufferGeometry();
  full.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  full.setIndex(Array.from(SOURCE.triangles).filter((_, index) => index % 4 !== 3));
  full.computeVertexNormals();
  const normals = full.attributes.normal.array.slice();
  full.dispose();
  const placeholder = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat);
  placeholder.colorSpace = THREE.SRGBColorSpace;
  placeholder.wrapS = placeholder.wrapT = THREE.RepeatWrapping;
  placeholder.needsUpdate = true;
  textures.add(placeholder);
  const ready = [];
  for (const source of data.materials) {
    if (materials[source.texture]) continue;
    const material = new THREE.MeshStandardMaterial({ map: placeholder, roughness: 0.9, metalness: 0 });
    if (options.cutouts) {
      material.side = THREE.DoubleSide;
      const textureInfo = data.textures.find((texture) => texture.name === source.texture);
      if (textureInfo?.alpha[0] < 255) material.alphaTest = 0.35;
      if (source.texture === "face_eyeshadow_base") {
        material.alphaTest = 0;
        material.transparent = true;
        material.depthWrite = false;
      }
    }
    material.name = source.texture;
    materials[source.texture] = material;
    if (typeof document !== "undefined") {
      ready.push(new Promise((resolve) => {
        const texture = new THREE.TextureLoader().load(new URL(`./assets/${options.assetFolder || "angler-skin"}/${source.texture}.png?v=skin-assets-1`, import.meta.url).href,
          (loaded) => {
            if (!disposed) { material.map = loaded; material.needsUpdate = true; }
            resolve(!disposed);
          }, undefined, () => resolve(false));
        texture.colorSpace = THREE.SRGBColorSpace;
        // The original GTA UV islands extend beyond 0..1 and use repeat addressing.
        texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
        textures.add(texture);
      }));
    }
  }
  const parts = new Map();
  for (let offset = 0; offset < SOURCE.triangles.length; offset += 4) {
    const triangle = SOURCE.triangles.subarray(offset, offset + 3), material = SOURCE.triangles[offset + 3];
    const firstPerson = [...triangle].every((index) => armWeights[index] >= 0.5);
    const key = `${material}:${firstPerson}`;
    if (!parts.has(key)) parts.set(key, { material, firstPerson, triangles: [] });
    parts.get(key).triangles.push(...triangle);
  }
  const attributes = {
    position: new THREE.BufferAttribute(positions, 3), normal: new THREE.BufferAttribute(normals, 3),
    uv: new THREE.BufferAttribute(SOURCE.uv.slice(), 2), skinIndex: new THREE.BufferAttribute(indices, 4),
    skinWeight: new THREE.BufferAttribute(weights, 4)
  };
  for (const part of parts.values()) {
    const geometry = new THREE.BufferGeometry();
    for (const [name, attribute] of Object.entries(attributes)) geometry.setAttribute(name, attribute);
    geometry.setIndex(part.triangles);
    const mesh = new THREE.SkinnedMesh(geometry, materials[data.materials[part.material].texture]);
    mesh.name = `${part.firstPerson ? "UploadedRightArm" : "UploadedBody"}${part.material}`;
    mesh.userData.firstPerson = part.firstPerson;
    mesh.bind(skinSkeleton, new THREE.Matrix4());
    mesh.frustumCulled = false;
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
    meshes.push(mesh);
  }
  return {
    group, meshes, materials, ready: Promise.all(ready), skeleton: skinSkeleton, driverSkeleton: skeleton, extraBones: extra, updatePose,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const mesh of meshes) mesh.geometry.dispose();
      for (const material of Object.values(materials)) material.dispose();
      for (const texture of textures) texture.dispose();
      skinSkeleton.dispose();
      extra.SkinRightForearm.removeFromParent();
      extra.SkinRightPalm.removeFromParent();
      group.clear();
    }
  };
}
