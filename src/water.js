import * as THREE from "three";
import { WATER_REGION } from "./lake.js";
import { GLSL_NOISE } from "./shaders.js";

export class SnejWater {
  constructor(settings, lake) {
    this.settings = settings;
    this.lake = lake;
    this.time = 0;
    this.wind = 0.82;
    this.ripples = [];
    this.splashes = [];
    this.group = new THREE.Group();
    this.mesh = this.buildMesh();
    this.group.add(this.mesh);
    this.particles = new THREE.Group();
    this.group.add(this.particles);
  }

  surfaceY(x, z) {
    // Cast physics uses the flat water datum; visual surface relief remains static.
    return 0;
  }

  buildMesh() {
    const q = this.settings.quality;
    const segs = q === "low" ? 150 : q === "high" ? 300 : 230;
    const geo = new THREE.PlaneGeometry(WATER_REGION, WATER_REGION, segs, segs);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.ShaderMaterial({
      transparent: false,
      depthWrite: true,
      uniforms: {
        uTime: { value: 0 },
        uWind: { value: this.wind },
        uSunDir: { value: new THREE.Vector3(0.3, 0.8, 0.2) },
        uNight: { value: 0 },
        uCloud: { value: 0.14 }
      },
      vertexShader: `
        uniform float uTime;
        uniform float uWind;
        varying vec3 vWorld;
        varying float vWave;
        float wave(vec2 p, float k, float speed, float amp, vec2 dir) {
          return sin(dot(p, dir) * k + uTime * speed) * amp * uWind;
        }
        void main() {
          vec3 p = position;
          float w = 0.0;
          w += wave(p.xz, 0.0203, 1.30, 0.32, normalize(vec2(0.82, 0.57)));
          w += wave(p.xz, 0.0371, 1.55, 0.18, normalize(vec2(-0.48, 0.88)));
          w += wave(p.xz, 0.0518, 1.85, 0.10, normalize(vec2(0.16, -0.98)));
          w += wave(p.xz, 0.0791, 2.10, 0.07, normalize(vec2(-0.76, -0.65)));
          w += wave(p.xz, 0.1120, 2.40, 0.05, normalize(vec2(0.99, -0.10)));
          p.y += w;
          vWave = w;
          vec4 world = modelMatrix * vec4(p, 1.0);
          vWorld = world.xyz;
          gl_Position = projectionMatrix * viewMatrix * world;
        }
      `,
      fragmentShader: `
        ${GLSL_NOISE}
        uniform float uTime;
        uniform vec3 uSunDir;
        uniform float uNight;
        uniform float uCloud;
        varying vec3 vWorld;
        varying float vWave;
        void main() {
          vec3 shallow = vec3(0.10, 0.55, 0.62);
          vec3 deep = vec3(0.02, 0.09, 0.17);
          float caust = fbm(vWorld.xz * vec2(0.105, 0.166) + uTime * 0.06);
          float line = smoothstep(0.54, 0.62, caust) * (1.0 - uNight) * (1.0 - uCloud * 0.45);
          float fres = pow(1.0 - clamp(dot(normalize(cameraPosition - vWorld), vec3(0.0, 1.0, 0.0)), 0.0, 1.0), 2.0);
          vec3 col = mix(deep, shallow, 0.45 + vWave * 0.18);
          col += vec3(0.8, 0.95, 1.0) * fres * 0.28;
          col += vec3(0.55, 0.85, 1.0) * line * 0.18;
          gl_FragColor = vec4(col, 1.0);
        }
      `
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    return mesh;
  }

  waveHeight(x, z, t = this.time, wind = this.wind) {
    const waves = [
      [0.82, 0.57, 2.03, 1.3, 0.32],
      [-0.48, 0.88, 3.71, 1.55, 0.18],
      [0.16, -0.98, 5.18, 1.85, 0.1],
      [-0.76, -0.65, 7.91, 2.1, 0.07],
      [0.99, -0.1, 11.2, 2.4, 0.05]
    ];
    let y = 0;
    for (const w of waves) {
      y += Math.sin((x * w[0] + z * w[1]) * w[2] * 0.01 + t * w[3]) * w[4] * wind;
    }
    return y;
  }

  addSplash(x, y, z, count = 5, size = 0.5) {
    this.addRipple(x, z, 0.35 + size * 0.2, 1.0);
    for (let i = 0; i < count; i += 1) {
      const drop = new THREE.Mesh(
        new THREE.SphereGeometry(0.025 + size * 0.015, 6, 4),
        new THREE.MeshBasicMaterial({ color: 0x9deaff, transparent: true, opacity: 0.72 })
      );
      drop.position.set(x, y + 0.04, z);
      drop.userData.life = 0.45 + Math.random() * 0.2;
      drop.userData.vel = new THREE.Vector3((Math.random() - 0.5) * size, 0.5 + Math.random() * size, (Math.random() - 0.5) * size);
      this.particles.add(drop);
    }
  }

  addRipple(x, z, strength = 0.4, decay = 1) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.1, 0.13, 32),
      new THREE.MeshBasicMaterial({ color: 0x9deaff, transparent: true, opacity: 0.42, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 0.035, z);
    ring.userData.life = decay;
    ring.userData.strength = strength;
    this.particles.add(ring);
  }

  update(dt, camera, env) {
    this.time = 0;
    this.mesh.material.uniforms.uTime.value = 0;
    if (env) {
      this.mesh.material.uniforms.uSunDir.value.copy(env.sunDir);
      this.mesh.material.uniforms.uNight.value = env.nightAmount;
      this.mesh.material.uniforms.uCloud.value = env.cloudiness;
    }
    for (let i = this.particles.children.length - 1; i >= 0; i -= 1) {
      const p = this.particles.children[i];
      p.userData.life -= dt;
      if (p.userData.vel) {
        p.userData.vel.y -= 2.6 * dt;
        p.position.addScaledVector(p.userData.vel, dt);
      } else {
        const scale = p.scale.x + dt * (1.4 + p.userData.strength);
        p.scale.setScalar(scale);
      }
      if (p.material) p.material.opacity = Math.max(0, p.userData.life);
      if (p.userData.life <= 0) {
        p.geometry.dispose();
        p.material.dispose();
        this.particles.remove(p);
      }
    }
  }

  capture() {}

  captureReflection() {}

  getUnderwaterContext(camera) {
    const strength = camera.position.y < 0 ? Math.min(1, -camera.position.y / 2) : 0;
    return { strength, cloud: strength * 0.45 };
  }
}
