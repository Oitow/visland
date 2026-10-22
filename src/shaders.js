// The materials, written as small shaders so the light of the day, the lanterns and the fog are all ours.
// Every material shares the uniforms in U, so the day is set once a frame for all of them.
import * as THREE from 'three';

export const U = {
  uTime: { value: 0 },
  uSunDir: { value: new THREE.Vector3(0, 1, 0) }, // where the light comes from (the sun, or the moon at night)
  uSunColor: { value: new THREE.Color(1, 1, 1) },
  uAmbient: { value: new THREE.Color(0.5, 0.5, 0.5) },
  uGlowColor: { value: new THREE.Color(1, 0.7, 0.4) },
  uFogColor: { value: new THREE.Color(0.7, 0.85, 1) },
  uFogNear: { value: 50 },
  uFogFar: { value: 170 },
  uLight: { value: 1 }, // how much daylight, 0..1
  uSkyTop: { value: new THREE.Color(0.2, 0.5, 0.9) },
  uSkyHorizon: { value: new THREE.Color(0.7, 0.85, 1) },
  uSun: { value: new THREE.Vector3(0, 1, 0) }, // the sun itself, even when it is down
  uMoon: { value: new THREE.Vector3(0, -1, 0) },
  uCam: { value: new THREE.Vector3() },
  uWaterY: { value: 12.6 },
  // the eight nearest lights (lanterns, crystals): x, y, z and how far each reaches
  uLamps: { value: Array.from({ length: 8 }, () => new THREE.Vector4(0, -1000, 0, 1)) },
};

const FOG = /* glsl */ `
  uniform vec3 uFogColor;
  uniform float uFogNear, uFogFar;
  vec3 fogged(vec3 c, float d) { return mix(c, uFogColor, smoothstep(uFogNear, uFogFar, d)); }
`;

// the warm light of lanterns at a point facing n: each falls off with distance, more on surfaces turned to it
const LAMPS = /* glsl */ `
  uniform vec4 uLamps[8];
  uniform vec3 uGlowColor;
  vec3 lampLight(vec3 p, vec3 n) {
    float g = 0.0;
    for (int i = 0; i < 8; i++) {
      vec3 d = uLamps[i].xyz - p;
      float k = max(0.0, 1.0 - length(d) / uLamps[i].w);
      g += k * k * (0.45 + 0.55 * max(dot(n, normalize(d)), 0.0));
    }
    return uGlowColor * min(g, 1.4);
  }
`;

const NOISE = /* glsl */ `
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i), b = hash(i + vec2(1, 0)), c = hash(i + vec2(0, 1)), d = hash(i + vec2(1, 1));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }
`;

// the ground: its colour from the materials, a fine grain of small squares (a nod to the blocks it was made of),
// broad blotches, the light of the day and of lanterns, and the sun's light rippling over it under water
export function terrainMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: U,
    vertexShader: /* glsl */ `
      attribute vec3 aColor;
      attribute vec3 aLight; // ambient occlusion, how much of the sky it sees, how coarse the grain is
      varying vec3 vWorld, vNormal, vColor, vLight;
      varying float vDepth;
      void main() {
        vWorld = position;
        vNormal = normal;
        vColor = aColor;
        vLight = aLight;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vDepth = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uSunDir, uSunColor, uAmbient;
      uniform float uTime, uLight, uWaterY;
      ${FOG}
      ${NOISE}
      ${LAMPS}
      float hash3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
      varying vec3 vWorld, vNormal, vColor, vLight;
      varying float vDepth;
      void main() {
        vec3 n = normalize(vNormal);
        float grain = hash3(floor(vWorld * 5.0 + n * 0.5)) - 0.5;
        float blot = vnoise(vWorld.xz * 0.3 + vWorld.y * 0.21) - 0.5;
        vec3 base = vColor * (1.0 + grain * vLight.z * 1.3 + blot * 0.16);
        float ndl = max(dot(n, uSunDir), 0.0);
        // under ground (in caves, deep pits) little of the sky's light gets in
        vec3 lit = (uAmbient + uSunColor * ndl) * vLight.x * vLight.y + lampLight(vWorld, n) * (0.5 + 0.5 * vLight.x);
        vec3 c = base * lit;
        // caustics: under the water, bright threads where two moving noises meet
        float under = smoothstep(0.0, 0.6, uWaterY - vWorld.y) * smoothstep(-0.2, 0.6, n.y);
        if (under > 0.0) {
          float a = vnoise(vWorld.xz * 0.9 + vec2(uTime * 0.35, uTime * 0.2));
          float b = vnoise(vWorld.xz * 0.9 - vec2(uTime * 0.25, -uTime * 0.3) + 7.0);
          c += vec3(0.6, 0.9, 1.0) * pow(1.0 - abs(a - b), 14.0) * under * uLight * 0.3;
        }
        gl_FragColor = vec4(fogged(c, vDepth), 1.0);
      }`,
  });
}

// trees and lanterns: flat-shaded colours, lit softly, leaves swaying in the wind
export function floraMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: U,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      attribute vec3 aColor;
      attribute float aSway;
      uniform float uTime;
      varying vec3 vNormal, vColor, vWorld;
      varying float vDepth;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        w.x += sin(uTime * 1.6 + w.x * 0.4 + w.z * 0.3) * 0.12 * aSway;
        w.z += cos(uTime * 1.3 + w.z * 0.4 + w.y * 0.2) * 0.1 * aSway;
        vNormal = normal;
        vColor = aColor;
        vec4 mv = viewMatrix * w;
        vDepth = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uSunDir, uSunColor, uAmbient;
      ${FOG}
      ${LAMPS}
      varying vec3 vNormal, vColor, vWorld;
      varying float vDepth;
      void main() {
        vec3 n = normalize(vNormal) * (gl_FrontFacing ? 1.0 : -1.0);
        float ndl = max(dot(n, uSunDir) * 0.7 + 0.3, 0.0);
        gl_FragColor = vec4(fogged(vColor * (uAmbient + uSunColor * ndl + lampLight(vWorld, n)), vDepth), 1.0);
      }`,
  });
}

// tufts of grass: one blade shape, many copies; they bend in the wind and shrink away into the distance
export function tuftMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: U,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      attribute vec3 aColor;
      attribute float aSway;
      uniform float uTime;
      uniform vec3 uCam;
      varying vec3 vColor, vWorld;
      varying float vDepth;
      void main() {
        vec4 base = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
        w.x += sin(uTime * 2.1 + base.x * 0.5 + base.z * 0.3) * 0.12 * aSway;
        w.z += cos(uTime * 1.7 + base.z * 0.5) * 0.08 * aSway;
        float far = 1.0 - smoothstep(24.0, 38.0, length(base.xz - uCam.xz));
        w.xyz = base.xyz + (w.xyz - base.xyz) * far;
        float k = fract(sin(dot(base.xz, vec2(12.9898, 78.233))) * 43758.5453);
        vColor = aColor * (0.85 + 0.3 * k);
        vWorld = w.xyz;
        vec4 mv = viewMatrix * w;
        vDepth = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uSunColor, uAmbient;
      ${FOG}
      ${LAMPS}
      varying vec3 vColor, vWorld;
      varying float vDepth;
      void main() { gl_FragColor = vec4(fogged(vColor * (uAmbient + uSunColor * 0.85 + lampLight(vWorld, vec3(0.0, 1.0, 0.0))), vDepth), 1.0); }`,
  });
}

// what glows by itself: crystals (pulsing gently) and the cores of lanterns
export function glowMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: U,
    vertexShader: /* glsl */ `
      attribute vec3 aColor;
      varying vec3 vColor;
      varying float vDepth;
      void main() {
        vColor = aColor;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vDepth = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      ${FOG}
      varying vec3 vColor;
      varying float vDepth;
      void main() { gl_FragColor = vec4(fogged(vColor * (1.05 + 0.15 * sin(uTime * 2.5)), vDepth * 0.6), 1.0); }`,
  });
}

// the sea: shallow turquoise to deep blue by the depth under it (a texture of the sea floor), ripples, the sun's
// glint, and foam where it meets the shore
export function waterMaterial(depthTexture, size) {
  return new THREE.ShaderMaterial({
    uniforms: { ...U, uDepth: { value: depthTexture }, uSize: { value: size } },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      varying float vDepth;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        vec4 mv = viewMatrix * w;
        vDepth = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uDepth;
      uniform float uSize, uTime, uLight;
      uniform vec3 uSun, uSunColor, uCam, uSkyHorizon;
      ${FOG}
      ${NOISE}
      varying vec3 vWorld;
      varying float vDepth;
      void main() {
        vec2 uv = vWorld.xz / uSize;
        float outside = step(1.0, max(abs(uv.x - 0.5), abs(uv.y - 0.5)) * 2.0);
        float d = mix(texture2D(uDepth, uv).r, 1.0, outside);
        vec3 col = mix(vec3(0.30, 0.82, 0.78), vec3(0.04, 0.22, 0.46), smoothstep(0.0, 0.8, d));
        float n1 = vnoise(vWorld.xz * 0.7 + vec2(uTime * 0.5, uTime * 0.3));
        float n2 = vnoise(vWorld.xz * 1.6 - vec2(uTime * 0.4, -uTime * 0.6));
        vec3 N = normalize(vec3((n1 - 0.5) * 0.5, 1.0, (n2 - 0.5) * 0.5));
        vec3 V = normalize(uCam - vWorld);
        float fres = pow(1.0 - abs(dot(N, V)), 3.0);
        col = mix(col, uSkyHorizon, fres * 0.55);
        col *= 0.22 + 0.78 * uLight;
        vec3 H = normalize(V + uSun);
        col += uSunColor * pow(max(dot(N, H), 0.0), 140.0) * 1.4 * step(0.0, uSun.y);
        float foam = smoothstep(0.1, 0.0, d) * step(0.42, vnoise(vWorld.xz * 2.2 + uTime * 0.8));
        col = mix(col, vec3(0.95) * (0.3 + 0.7 * uLight), foam * 0.85);
        float alpha = max(mix(0.5, 0.93, smoothstep(0.0, 0.5, d)), foam);
        gl_FragColor = vec4(fogged(col, vDepth), alpha);
      }`,
  });
}

// the sky: a gradient from the horizon up, a glow round the sun, and a square sun and moon (it is a voxel world)
export function skyMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: U,
    side: THREE.BackSide,
    depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uSkyTop, uSkyHorizon, uSun, uMoon;
      uniform float uLight;
      ${NOISE}
      varying vec3 vDir;
      // whether d falls on a square disc round the direction s, and where on it
      vec3 square(vec3 d, vec3 s, float r) {
        float sd = dot(d, s);
        if (sd <= 0.0) return vec3(0.0);
        vec3 p = d / sd - s;
        vec3 e1 = normalize(cross(s, vec3(0.0, 0.0, 1.0)));
        vec3 e2 = cross(e1, s);
        vec2 q = vec2(dot(p, e1), dot(p, e2)) / r;
        return vec3(step(max(abs(q.x), abs(q.y)), 1.0), q);
      }
      void main() {
        vec3 d = normalize(vDir);
        vec3 col = mix(uSkyHorizon, uSkyTop, smoothstep(0.0, 0.55, d.y));
        float glow = pow(max(dot(d, uSun), 0.0), 10.0);
        col += vec3(1.0, 0.65, 0.35) * glow * 0.35 * smoothstep(-0.2, 0.2, uSun.y);
        vec3 sun = square(d, uSun, 0.07);
        col = mix(col, vec3(1.0, 0.95, 0.75), sun.x);
        vec3 moon = square(d, uMoon, 0.05);
        float crater = step(0.72, hash(floor(moon.yz * 4.0 + 7.0)));
        col = mix(col, mix(vec3(0.9, 0.92, 1.0), vec3(0.62, 0.66, 0.78), crater), moon.x * (1.0 - uLight * 0.7));
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
}

export function starMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { ...U, uNight: { value: 0 }, uScale: { value: 1 } },
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      attribute float aBright;
      uniform float uScale;
      varying float vBright;
      void main() {
        vBright = aBright;
        gl_PointSize = 2.0 * uScale;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uNight;
      varying float vBright;
      void main() { gl_FragColor = vec4(vec3(1.0, 0.97, 0.9), vBright * uNight); }`,
  });
}

// clouds: low-poly puffs, lit from above, fading out far away so the edge of the field never shows
export function cloudMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { ...U, uCloud: { value: new THREE.Color(1, 1, 1) } },
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      varying float vShade, vFar;
      uniform vec3 uCam;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vShade = 0.8 + 0.2 * normal.y;
        vFar = length(w.xz - uCam.xz);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uCloud;
      varying float vShade, vFar;
      void main() { gl_FragColor = vec4(uCloud * vShade, 0.82 * (1.0 - smoothstep(160.0, 300.0, vFar))); }`,
  });
}
