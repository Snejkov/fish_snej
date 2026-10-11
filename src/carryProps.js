import * as THREE from "three";

function addMesh(parent, geometry, material, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}

function makeSocket(hand, name, sign, shoulderAngle, elbowAngle) {
  const socket = new THREE.Group();
  socket.name = name;
  socket.position.x = sign * 0.035;
  // Align each prop with its authored carry pose while keeping the grip on the hand.
  const shoulder = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), shoulderAngle);
  const elbow = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), elbowAngle);
  socket.quaternion.copy(shoulder.multiply(elbow).invert());
  hand.add(socket);
  return socket;
}

export function createCarryProps(bones) {
  const dark = new THREE.MeshStandardMaterial({ color: 0x263236, roughness: 0.88 });
  const metal = new THREE.MeshStandardMaterial({ color: 0xc8d5dd, metalness: 0.55, roughness: 0.35 });
  const accent = new THREE.MeshBasicMaterial({ color: 0xf3cb70, toneMapped: false });
  const leftSocket = makeSocket(bones.LeftHand, "LeftCarrySocket", 1, -Math.PI / 2 + 0.18, -0.12);
  const rightSocket = makeSocket(bones.RightHand, "RightCarrySocket", -1, Math.PI / 2 - 0.24, 0.88);

  const tackleBox = new THREE.Group();
  tackleBox.name = "TackleBox";
  leftSocket.add(tackleBox);
  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: 0xc7554d, roughness: 0.76, emissive: 0xc7554d, emissiveIntensity: 0.14
  });
  const lidMaterial = new THREE.MeshStandardMaterial({
    color: 0xd4dedb, roughness: 0.65, emissive: 0xd4dedb, emissiveIntensity: 0.06
  });
  const body = addMesh(tackleBox, new THREE.BoxGeometry(0.25, 0.26, 0.44), bodyMaterial, 0, -0.245);
  body.name = "TackleBoxBody";
  addMesh(tackleBox, new THREE.BoxGeometry(0.265, 0.045, 0.455), lidMaterial, 0, -0.1025);
  addMesh(tackleBox, new THREE.BoxGeometry(0.14, 0.023, 0.034), dark);
  for (const x of [-0.07, 0.07]) {
    addMesh(tackleBox, new THREE.BoxGeometry(0.019, 0.09, 0.028), dark, x, -0.045);
    for (const z of [-0.228, 0.228]) {
      addMesh(tackleBox, new THREE.BoxGeometry(0.034, 0.065, 0.012), accent, x, -0.132, z);
    }
  }
  const rim = new THREE.LineSegments(
    new THREE.EdgesGeometry(body.geometry),
    new THREE.LineBasicMaterial({ color: 0xec9990, toneMapped: false })
  );
  rim.position.copy(body.position);
  tackleBox.add(rim);

  const rod = new THREE.Group();
  rod.name = "CarriedRod";
  rod.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(-0.06, 1, 0.22).normalize());
  rightSocket.add(rod);
  addMesh(rod, new THREE.CylinderGeometry(0.024, 0.026, 0.42, 10), dark, 0, 0.02);
  addMesh(rod, new THREE.CylinderGeometry(0.029, 0.029, 0.025, 10), accent, 0, -0.18);
  addMesh(rod, new THREE.CylinderGeometry(0.025, 0.025, 0.035, 10), metal, 0, 0.215);
  const shaftMaterial = new THREE.MeshStandardMaterial({
    color: 0x80b7c5, metalness: 0.25, roughness: 0.42, emissive: 0x80b7c5, emissiveIntensity: 0.12
  });
  for (const [start, end, bottom, top] of [[0.23, 1.10, 0.017, 0.012], [1.10, 1.80, 0.012, 0.008], [1.80, 2.45, 0.008, 0.003]]) {
    addMesh(rod, new THREE.CylinderGeometry(top, bottom, end - start, 8), shaftMaterial, 0, (start + end) / 2);
    addMesh(rod, new THREE.CylinderGeometry(bottom * 1.1, bottom * 1.1, 0.025, 8), accent, 0, start);
  }

  addMesh(rod, new THREE.BoxGeometry(0.045, 0.075, 0.09), dark, 0, -0.075, -0.05);
  const reel = addMesh(rod, new THREE.CylinderGeometry(0.058, 0.048, 0.055, 12), metal, 0, -0.075, -0.12);
  reel.rotation.x = Math.PI / 2;
  const spool = addMesh(rod, new THREE.CylinderGeometry(0.035, 0.035, 0.058, 12), accent, 0, -0.075, -0.145);
  spool.rotation.x = Math.PI / 2;
  addMesh(rod, new THREE.BoxGeometry(0.085, 0.013, 0.013), metal, -0.05, -0.09, -0.09);
  addMesh(rod, new THREE.CylinderGeometry(0.014, 0.014, 0.045, 8), dark, -0.09, -0.10, -0.09);

  const linePoints = [new THREE.Vector3(0, -0.075, -0.16)];
  for (const y of [0.62, 1.10, 1.60, 2.06, 2.42]) {
    const radius = y > 2 ? 0.01 : 0.019;
    const guide = addMesh(rod, new THREE.TorusGeometry(radius, 0.003, 5, 8), accent, 0, y, 0.026);
    guide.rotation.x = Math.PI / 2;
    linePoints.push(new THREE.Vector3(0, y, 0.026));
  }
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(linePoints),
    new THREE.LineBasicMaterial({ color: 0xdce8ee, toneMapped: false })
  );
  line.name = "RodGuideLine";
  rod.add(line);
  const tip = new THREE.Object3D();
  tip.name = "RodTip";
  tip.position.y = 2.45;
  rod.add(tip);

  return { leftSocket, rightSocket, tackleBox, rod, tip };
}
