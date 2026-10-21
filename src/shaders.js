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
};

const FOG = /* glsl */ `
  uniform vec3 uFogColor;
  uniform float uFogNear, uFogFar;
  vec3 fogged(vec3 c, float d) { return mix(c, uFogColor, smoothstep(uFogNear, uFogFar, d)); }
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

export function terrainMaterial(atlas) {
  return new THREE.ShaderMaterial({
    uniforms: { ...U, uAtlas: { value: atlas } },
    vertexShader: /* glsl */ `
      attribute vec3 aLight; // ambient occlusion and face shade, lantern glow, glowing by itself
      varying vec2 vUv;
      varying vec3 vNormal, vLight;
      varying float vDepth;
      void main() {
        vUv = uv;
        vNormal = normal;
        vLight = aLight;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vDepth = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uAtlas;
      uniform vec3 uSunDir, uSunColor, uAmbient, uGlowColor;
      ${FOG}
      varying vec2 vUv;
      varying vec3 vNormal, vLight;
      varying float vDepth;
      void main() {
        vec4 t = texture2D(uAtlas, vUv);
        if (t.a < 0.5) discard;
        float ndl = max(dot(vNormal, uSunDir), 0.0);
        vec3 lit = (uAmbient + uSunColor * ndl) * vLight.x + uGlowColor * vLight.y * (0.55 + 0.45 * vLight.x);
        vec3 c = mix(t.rgb * lit, t.rgb * 1.1, vLight.z);
        gl_FragColor = vec4(fogged(c, vDepth), 1.0);
      }`,
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

// clouds: flat-lit boxes, fading out far away so the edge of the field never shows
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
        vShade = normal.y > 0.5 ? 1.0 : normal.y < -0.5 ? 0.72 : 0.86;
        vFar = length(w.xz - uCam.xz);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uCloud;
      varying float vShade, vFar;
      void main() { gl_FragColor = vec4(uCloud * vShade, 0.82 * (1.0 - smoothstep(160.0, 300.0, vFar))); }`,
  });
}
