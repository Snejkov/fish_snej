import * as THREE from "three";
import { GLSL_NOISE } from "./shaders.js";
import { clamp01, lerp, smoothstep } from "./util.js";

const KEYS = [
  { h: 0.0, zen: 0x0d2244, hor: 0x1a3055, sun: 0x16253c, amb: 0.38, dir: 0.05 },
  { h: 4.2, zen: 0x122a4c, hor: 0x223a60, sun: 0x2c3550, amb: 0.40, dir: 0.09 },
  { h: 5.4, zen: 0x18375c, hor: 0x7d4f5c, sun: 0xff8f52, amb: 0.40, dir: 0.55 },
  { h: 6.4, zen: 0x2a5c96, hor: 0xf7a068, sun: 0xffb478, amb: 0.66, dir: 1.9 },
  { h: 8.5, zen: 0x2d74be, hor: 0x9fc6e4, sun: 0xffeecd, amb: 0.90, dir: 2.9 },
  { h: 12.0, zen: 0x1f66c6, hor: 0xafd2ec, sun: 0xfffaf0, amb: 1.0, dir: 3.3 },
  { h: 15.5, zen: 0x2a6dbe, hor: 0xb6cee0, sun: 0xfff2d8, amb: 0.95, dir: 2.9 },
  { h: 17.6, zen: 0x24508c, hor: 0xf19256, sun: 0xffa055, amb: 0.68, dir: 1.7 },
  { h: 18.8, zen: 0x17305c, hor: 0xa85a50, sun: 0xf5713c, amb: 0.42, dir: 0.5 },
  { h: 20.0, zen: 0x14294c, hor: 0x2a3a5e, sun: 0x333b5c, amb: 0.42, dir: 0.11 },
  { h: 24.0, zen: 0x0d2244, hor: 0x1a3055, sun: 0x16253c, amb: 0.38, dir: 0.05 }
];

export class SnejSky {
  constructor(scene) {
    this.cloudiness = 0.14;
    this.nightAmount = 0;
    this.sunDir = new THREE.Vector3(0.5, 0.7, 0.34).normalize();
    this.group = new THREE.Group();
    this.ambient = new THREE.HemisphereLight(0xcfe8ff, 0x20301f, 0.8);
    this.sun = new THREE.DirectionalLight(0xfff2d8, 2.2);
    this.sun.castShadow = true;
    this.mesh = this.buildMesh();
    this.group.add(this.mesh, this.ambient, this.sun);
    scene.add(this.group);
  }

  buildMesh() {
    const geo = new THREE.SphereGeometry(1500, 48, 24);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        uZen: { value: new THREE.Color(0x1f66c6) },
        uHor: { value: new THREE.Color(0xafd2ec) },
        uSunColor: { value: new THREE.Color(0xfffaf0) },
        uSunDir: { value: this.sunDir },
        uTime: { value: 0 },
        uNight: { value: 0 },
        uCloud: { value: this.cloudiness }
      },
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vec4 world = modelMatrix * vec4(position, 1.0);
          vDir = normalize(world.xyz - cameraPosition);
          gl_Position = projectionMatrix * viewMatrix * world;
        }
      `,
      fragmentShader: `
        ${GLSL_NOISE}
        uniform vec3 uZen;
        uniform vec3 uHor;
        uniform vec3 uSunColor;
        uniform vec3 uSunDir;
        uniform float uTime;
        uniform float uNight;
        uniform float uCloud;
        varying vec3 vDir;
        void main() {
          float h = clamp(vDir.y * 0.5 + 0.5, 0.0, 1.0);
          vec3 col = mix(uHor, uZen, pow(h, 0.72));
          float sunDisk = smoothstep(0.9992, 0.99985, dot(vDir, uSunDir));
          col += uSunColor * sunDisk * (1.0 - uNight * 0.4);
          float moon = smoothstep(0.9980, 0.9990, dot(vDir, -uSunDir));
          float maria = fbm(vDir.xz * 18.0 + 3.0);
          col += vec3(0.72, 0.78, 0.88) * moon * uNight * (0.75 + maria * 0.25);
          vec2 starUv = vDir.xz * sqrt(2.0 / (1.0 + clamp(vDir.y, -0.9, 1.0)));
          vec2 cell = floor(starUv * 220.0);
          float starHash = hash12(cell);
          float star = step(0.70, starHash) * pow(hash12(cell + 9.3), 5.0);
          float twinkle = 0.72 + 0.28 * sin(uTime * (1.6 + starHash * 2.6) + starHash * 240.0);
          col += vec3(star * twinkle * uNight);
          float clouds = smoothstep(0.62 - uCloud * 0.42, 0.90 - uCloud * 0.30, fbm(vDir.xz * 2.2 + vec2(uTime * 0.006, 0.0)));
          col = mix(col, col + vec3(0.16, 0.16, 0.18), clouds * 0.22);
          gl_FragColor = vec4(col, 1.0);
        }
      `
    });
    return new THREE.Mesh(geo, mat);
  }

  sample(clock) {
    let a = KEYS[0];
    let b = KEYS[KEYS.length - 1];
    for (let i = 0; i < KEYS.length - 1; i += 1) {
      if (clock >= KEYS[i].h && clock <= KEYS[i + 1].h) {
        a = KEYS[i];
        b = KEYS[i + 1];
        break;
      }
    }
    const t = clamp01((clock - a.h) / Math.max(0.001, b.h - a.h));
    const zen = new THREE.Color(a.zen).lerp(new THREE.Color(b.zen), t);
    const hor = new THREE.Color(a.hor).lerp(new THREE.Color(b.hor), t);
    const sun = new THREE.Color(a.sun).lerp(new THREE.Color(b.sun), t);
    return { zen, hor, sun, amb: lerp(a.amb, b.amb, t), dir: lerp(a.dir, b.dir, t) };
  }

  update(dt, clock) {
    const s = this.sample(clock);
    const ang = ((clock - 6) / 24) * Math.PI * 2;
    this.sunDir.set(Math.cos(ang), Math.sin(ang), 0.34).normalize();
    this.nightAmount = smoothstep(0.08, -0.16, this.sunDir.y);
    this.mesh.material.uniforms.uZen.value.copy(s.zen);
    this.mesh.material.uniforms.uHor.value.copy(s.hor);
    this.mesh.material.uniforms.uSunColor.value.copy(s.sun);
    this.mesh.material.uniforms.uSunDir.value.copy(this.sunDir);
    this.mesh.material.uniforms.uNight.value = this.nightAmount;
    this.mesh.material.uniforms.uTime.value += dt;
    this.ambient.intensity = s.amb;
    this.sun.color.copy(s.sun);
    this.sun.intensity = s.dir;
    this.sun.position.copy(this.sunDir).multiplyScalar(220);
  }
}
