import * as THREE from "three";

export function createCharacterModel(skeleton) {
  const group = new THREE.Group();
  group.name = "AnglerModel";
  const meshes = [];
  const boneIndices = Object.fromEntries(skeleton.bones.map((bone, index) => [bone.name, index]));
  const bones = Object.fromEntries(skeleton.bones.map((bone) => [bone.name, bone]));
  const materials = {
    jacket: new THREE.MeshStandardMaterial({ color: 0x39796d, roughness: 0.94 }),
    trim: new THREE.MeshStandardMaterial({ color: 0xabc7bb, roughness: 0.93 }),
    pants: new THREE.MeshStandardMaterial({ color: 0x454d57, roughness: 0.96 }),
    boots: new THREE.MeshStandardMaterial({ color: 0x202a2c, roughness: 0.9 }),
    skin: new THREE.MeshStandardMaterial({ color: 0xd6a27f, roughness: 0.85 }),
    hair: new THREE.MeshStandardMaterial({ color: 0x3e3532, roughness: 1 }),
    detail: new THREE.MeshStandardMaterial({ color: 0x172f32, roughness: 0.85 }),
    cap: new THREE.MeshStandardMaterial({ color: 0xc0634f, roughness: 0.95 })
  };
  const rigid = (name) => () => [[name, 1]];
  const mix = (a, b, t) => [[a, 1 - t], [b, t]];
  const smooth = (a, b, value) => {
    const t = THREE.MathUtils.clamp((value - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  };
  const torsoWeights = (p) => p.y < 1.13
    ? mix("Hips", "Spine", smooth(0.91, 1.13, p.y))
    : mix("Spine", "Chest", smooth(1.13, 1.30, p.y));

  function add(name, geometry, material, weights, firstPerson = false) {
    const positions = geometry.attributes.position;
    const indices = [], values = [], point = new THREE.Vector3();
    for (let i = 0; i < positions.count; i += 1) {
      point.fromBufferAttribute(positions, i);
      const influences = weights(point);
      for (let j = 0; j < 4; j += 1) {
        indices.push(influences[j] ? boneIndices[influences[j][0]] : 0);
        values.push(influences[j]?.[1] || 0);
      }
    }
    geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(indices, 4));
    geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(values, 4));
    const mesh = new THREE.SkinnedMesh(geometry, material);
    mesh.name = name;
    mesh.userData.firstPerson = firstPerson;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // Vertices use the existing neutral rig space; never rebind its live animated pose.
    mesh.bind(skeleton, new THREE.Matrix4());
    mesh.frustumCulled = false;
    group.add(mesh);
    meshes.push(mesh);
    return mesh;
  }

  function tube(rings, axis = "y", sides = 16) {
    const vertices = [], indices = [];
    for (const [x, y, z, a, b] of rings) {
      for (let i = 0; i < sides; i += 1) {
        const angle = i * Math.PI * 2 / sides, u = Math.cos(angle) * a, v = Math.sin(angle) * b;
        vertices.push(x + (axis === "y" ? u : 0), y + (axis === "x" ? u : 0), z + v);
      }
    }
    for (let ring = 1; ring < rings.length; ring += 1) {
      for (let i = 0; i < sides; i += 1) {
        const a = (ring - 1) * sides + i, b = (ring - 1) * sides + (i + 1) % sides;
        const c = ring * sides + i, d = ring * sides + (i + 1) % sides;
        indices.push(a, c, b, b, c, d);
      }
    }
    for (const end of [0, rings.length - 1]) {
      const [x, y, z] = rings[end], center = vertices.length / 3;
      vertices.push(x, y, z);
      for (let i = 0; i < sides; i += 1) {
        const a = end * sides + i, b = end * sides + (i + 1) % sides;
        indices.push(center, end === 0 ? a : b, end === 0 ? b : a);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  }

  function shape(name, geometry, material, bone, position, scale, firstPerson = false, weights = rigid(bone)) {
    const matrix = new THREE.Matrix4().compose(new THREE.Vector3(...position), new THREE.Quaternion(), new THREE.Vector3(...scale));
    geometry.applyMatrix4(matrix);
    geometry.applyMatrix4(bones[bone].matrixWorld);
    return add(name, geometry, material, weights, firstPerson);
  }

  add("Jacket", tube([
    [0, 0.87, 0, 0.155, 0.105], [0, 0.94, 0, 0.17, 0.11],
    [0, 1.08, 0, 0.16, 0.105], [0, 1.23, 0, 0.205, 0.13],
    [0, 1.32, 0, 0.23, 0.12], [0, 1.39, 0, 0.18, 0.095],
    [0, 1.43, 0, 0.095, 0.075]
  ]), materials.jacket, torsoWeights);
  add("TrouserWaist", tube([[0, 0.82, 0, 0.16, 0.095], [0, 0.93, 0, 0.16, 0.10]]), materials.pants, rigid("Hips"));
  add("Neck", tube([[0, 1.42, 0, 0.057, 0.052], [0, 1.56, 0, 0.057, 0.052]]), materials.skin, rigid("Neck"));
  add("Collar", tube([[0, 1.40, 0, 0.096, 0.077], [0, 1.46, 0, 0.080, 0.065]]), materials.trim, rigid("Chest"));
  shape("JacketZipper", new THREE.BoxGeometry(1, 1, 1), materials.detail, "Chest",
    [0, -0.05, 0.125], [0.009, 0.31, 0.012], false, torsoWeights);
  for (const sign of [-1, 1]) {
    shape(`Pocket${sign}`, new THREE.BoxGeometry(1, 1, 1), materials.trim, "Chest",
      [sign * 0.105, -0.04, 0.126], [0.075, 0.075, 0.015], false, torsoWeights);
  }

  for (const [side, sign] of [["Left", 1], ["Right", -1]]) {
    const firstPerson = side === "Right";
    const sleeveWeights = (p) => mix(`${side}UpperArm`, `${side}ForeArm`, smooth(0.42, 0.49, Math.abs(p.x)));
    const forearmWeights = (p) => mix(`${side}ForeArm`, `${side}Hand`, smooth(0.69, 0.735, Math.abs(p.x)));
    // Reversing left-hand ring order keeps the winding outward on both arms.
    const armRings = (rings) => sign > 0 ? rings.map(([x, ...rest]) => [x * sign, ...rest]).reverse()
      : rings.map(([x, ...rest]) => [x * sign, ...rest]);
    add(`${side}Sleeve`, tube(armRings([
      [0.15, 1.39, 0, 0.077, 0.078], [0.21, 1.39, 0, 0.091, 0.084],
      [0.35, 1.39, 0, 0.073, 0.070], [0.47, 1.39, 0, 0.067, 0.063]
    ]), "x"), materials.jacket, sleeveWeights);
    add(`${side}Forearm`, tube(armRings([
      [0.465, 1.39, 0, 0.066, 0.062], [0.52, 1.39, 0, 0.065, 0.062],
      [0.64, 1.39, 0, 0.048, 0.045], [0.715, 1.39, 0, 0.037, 0.034]
    ]), "x"), materials.jacket, forearmWeights, firstPerson);
    add(`${side}Cuff`, tube(armRings([
      [0.69, 1.39, 0, 0.040, 0.037], [0.725, 1.39, 0, 0.038, 0.035]
    ]), "x"), materials.trim, forearmWeights, firstPerson);
    add(`${side}Hand`, tube(armRings([
      [0.72, 1.39, 0, 0.032, 0.031], [0.75, 1.39, 0, 0.039, 0.034],
      [0.79, 1.39, 0, 0.041, 0.034], [0.815, 1.39, 0, 0.025, 0.025]
    ]), "x", 12), materials.skin, rigid(`${side}Hand`), firstPerson);
    shape(`${side}Thumb`, new THREE.SphereGeometry(1, 10, 8), materials.skin, `${side}Hand`,
      [sign * 0.035, -0.018, 0.027], [0.026, 0.024, 0.022], firstPerson);
    const thighX = sign * 0.11;
    const legWeights = (p) => p.y > 0.53 ? mix(`${side}UpperLeg`, "Hips", smooth(0.79, 0.92, p.y))
      : mix(`${side}LowerLeg`, `${side}UpperLeg`, smooth(0.44, 0.55, p.y));
    add(`${side}Trousers`, tube([
      [thighX, 0.12, 0, 0.050, 0.054], [thighX, 0.30, 0, 0.064, 0.065],
      [thighX, 0.475, 0, 0.065, 0.068], [thighX, 0.55, 0, 0.070, 0.075],
      [thighX, 0.73, 0, 0.092, 0.088], [thighX, 0.88, 0, 0.098, 0.095]
    ]), materials.pants, legWeights);
    shape(`${side}Boot`, new THREE.BoxGeometry(1, 1, 1, 2, 1, 2), materials.boots, `${side}Foot`,
      [0, -0.015, 0.055], [0.125, 0.115, 0.26]);
    shape(`${side}BootCuff`, new THREE.CylinderGeometry(0.058, 0.059, 0.13, 12), materials.boots, `${side}Foot`,
      [0, 0.045, 0], [1, 1, 1]);
    shape(`${side}Sole`, new THREE.BoxGeometry(1, 1, 1), materials.detail, `${side}Foot`,
      [0, -0.063, 0.06], [0.13, 0.025, 0.275]);
  }

  add("Face", tube([
    [0, 1.51, 0.008, 0.054, 0.051], [0, 1.55, 0.008, 0.080, 0.073],
    [0, 1.62, 0, 0.102, 0.092], [0, 1.70, -0.008, 0.100, 0.090],
    [0, 1.76, -0.012, 0.070, 0.063], [0, 1.78, -0.012, 0.015, 0.018]
  ], "y", 20), materials.skin, rigid("Head"));
  for (const sign of [-1, 1]) {
    shape(`Ear${sign}`, new THREE.SphereGeometry(1, 10, 8), materials.skin, "Head",
      [sign * 0.100, 0.015, 0], [0.017, 0.029, 0.019]);
    shape(`Eye${sign}`, new THREE.SphereGeometry(1, 8, 6), materials.detail, "Head",
      [sign * 0.037, 0.025, 0.087], [0.009, 0.007, 0.006]);
    shape(`Brow${sign}`, new THREE.BoxGeometry(1, 1, 1), materials.hair, "Head",
      [sign * 0.036, 0.047, 0.084], [0.027, 0.008, 0.008]);
  }
  shape("Nose", new THREE.SphereGeometry(1, 8, 6), materials.skin, "Head",
    [0, 0.001, 0.096], [0.017, 0.025, 0.021]);
  shape("Mouth", new THREE.BoxGeometry(1, 1, 1), materials.hair, "Head",
    [0, -0.042, 0.085], [0.030, 0.004, 0.005]);
  add("Cap", tube([
    [0, 1.70, -0.012, 0.105, 0.095], [0, 1.75, -0.012, 0.099, 0.090],
    [0, 1.80, -0.015, 0.060, 0.061], [0, 1.815, -0.015, 0.010, 0.010]
  ], "y", 20), materials.cap, rigid("Head"));
  shape("CapBrim", new THREE.SphereGeometry(1, 12, 8), materials.cap, "Head",
    [0, 0.081, 0.097], [0.106, 0.012, 0.092]);

  return {
    group, meshes, materials,
    dispose() {
      for (const mesh of meshes) mesh.geometry.dispose();
      for (const material of Object.values(materials)) material.dispose();
      group.clear();
    }
  };
}
