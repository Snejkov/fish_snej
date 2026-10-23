import * as THREE from "three";
import {GLTFLoader} from "three/addons/loaders/GLTFLoader.js";
import {OrbitControls} from "three/addons/controls/OrbitControls.js";

let renderer, scene, camera, controls, observer, host, root, token=0;
const loader=new GLTFLoader();

function release(object) {
  if (!object) return;
  object.traverse((part) => {
    part.geometry?.dispose();
    const materials=part.material ? (Array.isArray(part.material) ? part.material : [part.material]) : [];
    for (const material of materials) {
      material.map?.dispose();
      material.dispose();
    }
  });
}

function resize() {
  if (!host || host.hidden || !host.clientWidth || !host.clientHeight) return;
  renderer.setSize(host.clientWidth,host.clientHeight);
  camera.aspect=host.clientWidth/host.clientHeight;
  camera.updateProjectionMatrix();
}

function initialize() {
  if (renderer) return;
  renderer=new THREE.WebGLRenderer({antialias:true,alpha:false});
  renderer.setPixelRatio(Math.min(devicePixelRatio,2));
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure=1.05;
  renderer.domElement.setAttribute("aria-label","Interactive fishing float model. Drag to rotate and scroll to zoom.");
  renderer.domElement.setAttribute("role","img");
  scene=new THREE.Scene();
  scene.background=new THREE.Color("#e5e8e0");
  scene.add(new THREE.HemisphereLight(0xffffff,0x74816d,2.1));
  for (const [position,power,color] of [[[2,4,4],2.5,0xfff5e8],[[-3,1,-2],1.3,0xdae7ff]]) {
    const light=new THREE.DirectionalLight(color,power);
    light.position.set(...position);scene.add(light);
  }
  camera=new THREE.PerspectiveCamera(32,1,.00005,10);
  controls=new OrbitControls(camera,renderer.domElement);
  controls.enableDamping=true;
  controls.enablePan=true;
  observer=new ResizeObserver(resize);
  renderer.setAnimationLoop(() => {
    if (!host?.isConnected || host.hidden || document.hidden) return;
    controls.update();renderer.render(scene,camera);
  });
}

export function resetModelView() {
  if (!root) return;
  const box=new THREE.Box3().setFromObject(root);
  const size=box.getSize(new THREE.Vector3());
  const center=box.getCenter(new THREE.Vector3());
  controls.target.copy(center);
  camera.position.copy(center).add(new THREE.Vector3(size.y*.28,size.y*.03,size.y*2.05));
  controls.minDistance=size.y*.18;
  controls.maxDistance=size.y*7;
  camera.near=Math.max(size.y/1000,.000001);
  camera.far=size.y*30;
  camera.updateProjectionMatrix();
  controls.update();
}

export function setWireframe(value) {
  root?.traverse((part) => {
    if (part.isMesh) for (const material of (Array.isArray(part.material) ? part.material : [part.material])) {
      material.wireframe=value;
    }
  });
}

export function detachModel() {
  token++;
  if (root) {scene.remove(root);release(root);root=null;}
  observer?.disconnect();
  host=null;
}

export async function showModel(model,element) {
  detachModel();
  const request=token;
  host=element;
  const caption=host.querySelector(".viewer-caption");
  host.dataset.state="loading";
  try {
    initialize();
    host.prepend(renderer.domElement);
    observer.observe(host);resize();
    const gltf=await loader.loadAsync(`assets/models/${model.id.toLowerCase()}/${model.files.glb}`);
    if (token!==request || !element.isConnected) {release(gltf.scene);return;}
    root=gltf.scene;
    root.traverse((part) => {
      if (!part.isMesh) return;
      for (const mat of (Array.isArray(part.material) ? part.material : [part.material])) {
        if (mat.map) mat.map.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
      }
    });
    scene.add(root);resetModelView();
    host.dataset.state="ready";
    caption.textContent=`${model.triangles.toLocaleString("en-US")} triangles / ${model.lengthMm} mm / Drag to rotate`;
  } catch (error) {
    if (request!==token) return;
    host.dataset.state="error";
    caption.textContent="3D preview unavailable. Use Reference or download the FBX.";
    console.error("Float model preview:",error);
  }
}
