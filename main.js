import './css/base.css';
import * as THREE from 'three';
import GUI from 'lil-gui';
import fragmentShader from './shaders/fragment.glsl';
import fontData from './fonts/GeistPixel-Square.json';
import atlasUrl from './fonts/GeistPixel-Square.png';

// --- Text layout computation ---
const TEXT = 'underscore final';

const charMap = {};
fontData.chars.forEach(c => { charMap[c.char] = c; });

const kernMap = {};
fontData.kernings.forEach(k => {
  kernMap[`${k.first},${k.second}`] = k.amount;
});

const glyphs = [];
let cursorX = 0;

for (let i = 0; i < TEXT.length; i++) {
  const ch = TEXT[i];
  const glyph = charMap[ch];
  if (!glyph) continue;

  if (ch !== ' ') {
    glyphs.push({
      textX: cursorX + glyph.xoffset,
      textY: glyph.yoffset,
      width: glyph.width,
      height: glyph.height,
      atlasX: glyph.x,
      atlasY: glyph.y,
    });
  }

  cursorX += glyph.xadvance;

  if (i < TEXT.length - 1) {
    const nextGlyph = charMap[TEXT[i + 1]];
    if (nextGlyph) {
      const kern = kernMap[`${glyph.id},${nextGlyph.id}`];
      if (kern) cursorX += kern;
    }
  }
}

const textWidth = cursorX;
const atlasW = fontData.common.scaleW;
const atlasH = fontData.common.scaleH;
const lineHeight = fontData.common.lineHeight;
const distRange = fontData.distanceField.distanceRange;

// Prepare uniform arrays
const glyphPos = glyphs.map(g =>
  new THREE.Vector4(g.textX, g.textY, g.width, g.height)
);
const glyphUV = glyphs.map(g =>
  new THREE.Vector4(
    g.atlasX / atlasW,
    g.atlasY / atlasH,
    (g.atlasX + g.width) / atlasW,
    (g.atlasY + g.height) / atlasH
  )
);

// --- Load MSDF atlas texture ---
const msdfTexture = new THREE.TextureLoader().load(atlasUrl);
msdfTexture.flipY = false;
msdfTexture.minFilter = THREE.LinearFilter;
msdfTexture.magFilter = THREE.LinearFilter;

// --- Tunable parameters ---
const toneMappingOptions = {
  None: THREE.NoToneMapping,
  ACES: THREE.ACESFilmicToneMapping,
  Reinhard: THREE.ReinhardToneMapping,
  Cineon: THREE.CineonToneMapping,
  AgX: THREE.AgXToneMapping,
  Neutral: THREE.NeutralToneMapping,
};

const params = {
  textScale: 0.2,
  blurMultiplier: 6.0,
  brightnessBoost: 2.5,
  mouseRadius: 0.2,
  mouseFalloff: 0.8,
  smoothK: 2.0,
  mouseDamping: 8,
  exposure: 1.0,
  toneMapping: 'ACES',
};

// --- Three.js scene setup ---
const scene = new THREE.Scene();
const vMouse = new THREE.Vector2();
const vMouseDamp = new THREE.Vector2();
const vResolution = new THREE.Vector2();

let w, h = 1;

const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);
const renderer = new THREE.WebGLRenderer();
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
document.body.appendChild(renderer.domElement);

const onPointerMove = (e) => { vMouse.set(e.pageX, e.pageY); };
document.addEventListener('mousemove', onPointerMove);
document.addEventListener('pointermove', onPointerMove);
document.body.addEventListener('touchmove', (e) => { e.preventDefault(); }, { passive: false });

const geo = new THREE.PlaneGeometry(1, 1);

const mat = new THREE.ShaderMaterial({
  vertexShader: /* glsl */`
    varying vec2 v_texcoord;
    void main() {
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        v_texcoord = uv;
    }`,
  fragmentShader,
  uniforms: {
    u_mouse: { value: vMouseDamp },
    u_resolution: { value: vResolution },
    u_pixelRatio: { value: 2 },
    u_msdf: { value: msdfTexture },
    u_glyphPos: { value: glyphPos },
    u_glyphUV: { value: glyphUV },
    u_textWidth: { value: textWidth },
    u_lineHeight: { value: lineHeight },
    u_distRange: { value: distRange },
    u_textScaleFactor: { value: params.textScale },
    u_blurMultiplier: { value: params.blurMultiplier },
    u_brightnessBoost: { value: params.brightnessBoost },
    u_mouseRadius: { value: params.mouseRadius },
    u_mouseFalloff: { value: params.mouseFalloff },
    u_smoothK: { value: params.smoothK },
  },
});

const quad = new THREE.Mesh(geo, mat);
scene.add(quad);

camera.position.z = 1;

// --- GUI ---
const gui = new GUI();

gui.add(params, 'textScale', 0.05, 1.0).name('Text Scale').onChange(v => {
  mat.uniforms.u_textScaleFactor.value = v;
});
gui.add(params, 'blurMultiplier', 0.0, 20.0).name('Blur Amount').onChange(v => {
  mat.uniforms.u_blurMultiplier.value = v;
});
gui.add(params, 'brightnessBoost', 1.0, 5.0).name('Brightness').onChange(v => {
  mat.uniforms.u_brightnessBoost.value = v;
});
gui.add(params, 'mouseRadius', 0.0, 1.0).name('Mouse Radius').onChange(v => {
  mat.uniforms.u_mouseRadius.value = v;
});
gui.add(params, 'mouseFalloff', 0.1, 2.0).name('Mouse Falloff').onChange(v => {
  mat.uniforms.u_mouseFalloff.value = v;
});
gui.add(params, 'smoothK', 0.1, 5.0).name('Smooth K').onChange(v => {
  mat.uniforms.u_smoothK.value = v;
});
gui.add(params, 'mouseDamping', 1, 20).name('Mouse Damping');
gui.add(params, 'exposure', 0.1, 5.0).name('Exposure').onChange(v => {
  renderer.toneMappingExposure = v;
});
gui.add(params, 'toneMapping', Object.keys(toneMappingOptions)).name('Tone Mapping').onChange(v => {
  renderer.toneMapping = toneMappingOptions[v];
  mat.needsUpdate = true;
});

// --- Animation loop ---
let time, lastTime = 0;
const update = () => {
  time = performance.now() * 0.001;
  const dt = time - lastTime;
  lastTime = time;

  for (const k in vMouse) {
    if (k === 'x' || k === 'y') {
      vMouseDamp[k] = THREE.MathUtils.damp(vMouseDamp[k], vMouse[k], params.mouseDamping, dt);
    }
  }

  requestAnimationFrame(update);
  renderer.render(scene, camera);
};
update();

// --- Resize handler ---
const resize = () => {
  w = window.innerWidth;
  h = window.innerHeight;

  const dpr = Math.min(window.devicePixelRatio, 2);

  renderer.setSize(w, h);
  renderer.setPixelRatio(dpr);

  camera.left = -w / 2;
  camera.right = w / 2;
  camera.top = h / 2;
  camera.bottom = -h / 2;
  camera.updateProjectionMatrix();

  quad.scale.set(w, h, 1);
  vResolution.set(w, h).multiplyScalar(dpr);
  mat.uniforms.u_pixelRatio.value = dpr;
};
resize();

window.addEventListener('resize', resize);
