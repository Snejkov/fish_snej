import * as THREE from "three";
import { createCarryProps } from "./carryProps.js?v=0.0.3-hf2.13";

const TAU = Math.PI * 2;
const HIP_HEIGHT = 0.91;
const GAITS = {
  idle: { swing: 0, knee: 0, arm: 0, bob: 0, lean: 0, stride: 1 },
  walk: { swing: 0.48, knee: 0.82, arm: 0.38, bob: 0.018, lean: 0.035, stride: 3.0 },
  run: { swing: 0.78, knee: 1.40, arm: 0.67, bob: 0.045, lean: 0.14, stride: 4.0 },
  wade: { swing: 0.38, knee: 1.0, arm: 0.24, bob: 0.012, lean: 0.055, stride: 2.4 }
};

export class SnejAngler {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = "SnejCharacter";
    this.rig = new THREE.Group();
    this.rig.name = "SnejCharacterRig";
    this.visuals = new THREE.Group();
    this.visuals.name = "SkeletonPreview";
    this.group.add(this.rig);
    this.rig.add(this.visuals);
    this.bones = Object.create(null);
    this.links = [];
    this.weights = { idle: 1, walk: 0, run: 0, wade: 0 };
    this.locomotionState = "idle";
    this.heading = 0;
    this.inverseWorld = new THREE.Matrix4();
    this.linkMatrix = new THREE.Matrix4();
    this.chestOffset = new THREE.Matrix4().makeTranslation(0, -0.03, 0);
    this.startPoint = new THREE.Vector3();
    this.endPoint = new THREE.Vector3();
    this.linkDirection = new THREE.Vector3();
    this.linkScale = new THREE.Vector3();
    this.linkRotation = new THREE.Quaternion();
    this.up = new THREE.Vector3(0, 1, 0);
    this.build();
  }

  addBone(name, parent, x, y, z) {
    const bone = new THREE.Bone();
    bone.name = name;
    bone.position.set(x, y, z);
    parent.add(bone);
    this.bones[name] = bone;
    if (parent.isBone) this.links.push({ parent, bone });
    return bone;
  }

  build() {
    const hips = this.addBone("Hips", this.rig, 0, HIP_HEIGHT, 0);
    const spine = this.addBone("Spine", hips, 0, 0.18, 0);
    const chest = this.addBone("Chest", spine, 0, 0.18, 0);
    const neck = this.addBone("Neck", chest, 0, 0.23, 0);
    const head = this.addBone("Head", neck, 0, 0.12, 0);
    this.addBone("HeadTip", head, 0, 0.12, 0);

    for (const [side, sign] of [["Left", 1], ["Right", -1]]) {
      const shoulder = this.addBone(`${side}Shoulder`, chest, sign * 0.12, 0.12, 0);
      const arm = this.addBone(`${side}UpperArm`, shoulder, sign * 0.07, 0, 0);
      const forearm = this.addBone(`${side}ForeArm`, arm, sign * 0.28, 0, 0);
      const hand = this.addBone(`${side}Hand`, forearm, sign * 0.25, 0, 0);
      this.addBone(`${side}HandTip`, hand, sign * 0.07, 0, 0);
      const thigh = this.addBone(`${side}UpperLeg`, hips, sign * 0.11, -0.015, 0);
      const shin = this.addBone(`${side}LowerLeg`, thigh, 0, -0.42, 0);
      const foot = this.addBone(`${side}Foot`, shin, 0, -0.40, 0);
      this.addBone(`${side}Toe`, foot, 0, -0.04, 0.18);
    }

    // Capture the neutral T-pose before the preview animation bends the rig.
    this.rig.updateMatrixWorld(true);
    this.skeleton = new THREE.Skeleton(Object.values(this.bones));
    this.skeleton.calculateInverses();
    this.buildPreview();
    this.carry = createCarryProps(this.bones);
    this.mixer = new THREE.AnimationMixer(this.rig);
    this.actions = Object.create(null);
    for (const [name, gait] of Object.entries(GAITS)) {
      const action = this.mixer.clipAction(this.makeClip(name, gait));
      action.setEffectiveWeight(this.weights[name]).play();
      this.actions[name] = action;
    }
    this.update(0, { cameraMode: "third-person" });
  }

  buildPreview() {
    const material = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    this.segments = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 8), material, this.links.length);
    this.joints = new THREE.InstancedMesh(new THREE.SphereGeometry(0.034, 10, 8), material, this.skeleton.bones.length);
    this.segments.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.joints.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.segments.frustumCulled = false;
    this.joints.frustumCulled = false;
    const colorFor = (name) => new THREE.Color(
      name.startsWith("Left") ? 0x62e6dc : name.startsWith("Right") ? 0xff9e81 : 0xe5eff4
    );
    this.links.forEach(({ bone }, index) => this.segments.setColorAt(index, colorFor(bone.name)));
    this.skeleton.bones.forEach((bone, index) => this.joints.setColorAt(index, colorFor(bone.name)));
    this.visuals.add(this.segments, this.joints);

    const cageMaterial = new THREE.MeshBasicMaterial({ color: 0xf5cf6b, wireframe: true, toneMapped: false });
    this.headCage = new THREE.Mesh(new THREE.SphereGeometry(0.105, 8, 6), cageMaterial);
    this.chestCage = new THREE.Mesh(
      new THREE.BoxGeometry(0.29, 0.26, 0.14),
      new THREE.MeshBasicMaterial({ color: 0xd6e7ed, wireframe: true, toneMapped: false })
    );
    this.headCage.matrixAutoUpdate = false;
    this.chestCage.matrixAutoUpdate = false;
    this.visuals.add(this.headCage, this.chestCage);
  }

  makeClip(name, gait) {
    const duration = name === "idle" ? 3.6 : 1;
    const times = [];
    const positions = [];
    const rotations = Object.create(null);
    const rotationNames = ["Hips", "Spine", "Chest", "Head"];
    for (const side of ["Left", "Right"]) {
      rotationNames.push(`${side}UpperArm`, `${side}ForeArm`, `${side}UpperLeg`, `${side}LowerLeg`, `${side}Foot`);
    }
    rotationNames.forEach((bone) => { rotations[bone] = []; });
    const euler = new THREE.Euler();
    const quaternion = new THREE.Quaternion();
    const pose = (bone, x = 0, y = 0, z = 0) => {
      quaternion.setFromEuler(euler.set(x, y, z));
      rotations[bone].push(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
    };
    for (let frame = 0; frame <= 40; frame += 1) {
      const phase = (frame / 40) * TAU;
      const breath = Math.sin(phase) * 0.008;
      times.push((frame / 40) * duration);
      positions.push(0, HIP_HEIGHT + (name === "idle" ? breath * 0.35 : Math.abs(Math.sin(phase * 2)) * gait.bob), 0);
      pose("Hips", 0, Math.sin(phase) * gait.swing * 0.045, Math.sin(phase) * gait.swing * 0.03);
      pose("Spine", gait.lean + (name === "idle" ? breath : 0));
      pose("Chest", 0, -Math.sin(phase) * gait.arm * 0.1);
      pose("Head", -gait.lean * 0.45, 0, name === "idle" ? breath * 0.2 : 0);
      for (const [side, sign] of [["Left", 1], ["Right", -1]]) {
        const swing = Math.sin(phase + (sign < 0 ? Math.PI : 0));
        const hip = swing * gait.swing;
        const knee = Math.max(0, -swing) * gait.knee;
        pose(`${side}UpperLeg`, hip);
        pose(`${side}LowerLeg`, knee);
        pose(`${side}Foot`, -hip - knee * 0.85);
        const sway = swing * gait.arm;
        if (side === "Left") {
          pose(`${side}UpperArm`, -sway * 0.22, 0, -Math.PI / 2 + 0.18 + Math.abs(sway) * 0.03);
          pose(`${side}ForeArm`, 0, -0.12 - Math.abs(sway) * 0.06 - (name === "wade" ? 0.05 : 0));
        } else {
          pose(`${side}UpperArm`, -sway * 0.08 + breath * 0.25, 0, Math.PI / 2 - 0.24);
          pose(`${side}ForeArm`, 0, 0.88 + sway * 0.035 + (name === "wade" ? 0.06 : 0));
        }
      }
    }
    const tracks = [new THREE.VectorKeyframeTrack("Hips.position", times, positions)];
    for (const [bone, values] of Object.entries(rotations)) {
      tracks.push(new THREE.QuaternionKeyframeTrack(`${bone}.quaternion`, times, values));
    }
    return new THREE.AnimationClip(name, duration, tracks);
  }

  update(dt, info = {}) {
    const speed = Math.max(0, Number(info.speed) || 0);
    const moving = speed > 0.035 && info.state !== "paused" && info.state !== "title";
    const state = moving ? (info.depth > 0.08 ? "wade" : speed > 5 ? "run" : "walk") : "idle";
    this.locomotionState = state;
    const blend = 1 - Math.exp(-12 * Math.max(0, dt));
    const cadence = moving ? speed / GAITS[state].stride : 0;
    for (const [name, action] of Object.entries(this.actions)) {
      this.weights[name] += ((name === state ? 1 : 0) - this.weights[name]) * blend;
      action.setEffectiveWeight(this.weights[name]);
      action.setEffectiveTimeScale(name === "idle" ? 1 : cadence);
    }

    const directionX = Number(info.directionX) || 0;
    const directionZ = Number(info.directionZ) || 0;
    if (moving && Math.hypot(directionX, directionZ) > 0.001) {
      const target = Math.atan2(directionX, directionZ) - this.group.rotation.y;
      const delta = Math.atan2(Math.sin(target - this.heading), Math.cos(target - this.heading));
      this.heading += delta * blend;
    }
    this.rig.rotation.y = this.heading;
    this.mixer.update(Math.max(0, dt));
    this.updatePreview();
    this.skeleton.update();
    this.group.visible = info.cameraMode !== "first-person";
  }

  updatePreview() {
    this.group.updateWorldMatrix(true, true);
    this.inverseWorld.copy(this.rig.matrixWorld).invert();
    for (let index = 0; index < this.links.length; index += 1) {
      const { parent, bone } = this.links[index];
      this.startPoint.setFromMatrixPosition(parent.matrixWorld).applyMatrix4(this.inverseWorld);
      this.endPoint.setFromMatrixPosition(bone.matrixWorld).applyMatrix4(this.inverseWorld);
      this.linkDirection.subVectors(this.endPoint, this.startPoint);
      const length = this.linkDirection.length();
      this.linkRotation.setFromUnitVectors(this.up, this.linkDirection.normalize());
      this.startPoint.lerp(this.endPoint, 0.5);
      const radius = bone.name.startsWith("Left") || bone.name.startsWith("Right") ? 0.018 : 0.023;
      this.linkScale.set(radius, length, radius);
      this.linkMatrix.compose(this.startPoint, this.linkRotation, this.linkScale);
      this.segments.setMatrixAt(index, this.linkMatrix);
    }
    this.skeleton.bones.forEach((bone, index) => {
      this.linkMatrix.copy(this.inverseWorld).multiply(bone.matrixWorld);
      this.joints.setMatrixAt(index, this.linkMatrix);
    });
    this.headCage.matrix.copy(this.inverseWorld).multiply(this.bones.Head.matrixWorld);
    this.chestCage.matrix.copy(this.inverseWorld).multiply(this.bones.Chest.matrixWorld).multiply(this.chestOffset);
    this.segments.instanceMatrix.needsUpdate = true;
    this.joints.instanceMatrix.needsUpdate = true;
  }
}
