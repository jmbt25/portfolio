/**
 * The two authored materials: the card foil and the slab glass.
 *
 * Both are ShaderMaterials rather than MeshPhysicalMaterial. The foil needs a
 * view-angle hue shift masked by a channel that glTF has no slot for, and the
 * slab needs a fresnel rim without a transmission pass, which is what keeps
 * this scene to one render target and no postprocessing pipeline.
 */

import {
  Color,
  DoubleSide,
  FrontSide,
  NormalBlending,
  ShaderMaterial,
  type Texture,
  Vector2,
  Vector3,
} from 'three';

/* ------------------------------------------------------------------ shared */

const SRGB_DECODE = /* glsl */ `
  vec3 srgbToLinear(vec3 c) {
    return mix(pow((c + 0.055) / 1.055, vec3(2.4)), c / 12.92, step(c, vec3(0.04045)));
  }
`;

/**
 * A cheap spectral ramp. Three cosines a third of a cycle apart give a hue
 * sweep that stays inside sRGB at every phase, which a hue rotation in HSV
 * does not.
 */
const SPECTRUM = /* glsl */ `
  vec3 spectrum(float t) {
    return 0.5 + 0.5 * cos(6.28318530718 * (t + vec3(0.0, 0.3333, 0.6667)));
  }
`;

/**
 * The tangent frame, built from the object axes rather than a TANGENT
 * attribute. The card is a flat plane facing +Z in object space with a single
 * planar UV set edge to edge, so its tangent frame is the object frame. Phase 4
 * exported NORMAL, POSITION and TEXCOORD_0 only, and adding a tangent set to
 * the GLB to rederive something already known would be strictly worse.
 *
 * The frame is re-orthogonalised against the interpolated normal so the 0.35 mm
 * chamfer band around the card edge, where the normal is not +Z, still gets a
 * frame that is actually orthonormal.
 */
const TANGENT_FRAME = /* glsl */ `
  mat3 tangentFrame(vec3 n, vec3 tGuess) {
    vec3 t = normalize(tGuess - n * dot(n, tGuess));
    vec3 b = cross(n, t);
    return mat3(t, b, n);
  }
`;

/* -------------------------------------------------------------- card foil */

export interface FoilTextures {
  albedo: Texture;
  emboss: Texture;
  packed: Texture;
  holo: Texture;
}

const foilVert = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vViewPos;
  varying vec3 vNormal;
  varying vec3 vTangentGuess;

  void main() {
    vUv = uv;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vViewPos = mv.xyz;
    vNormal = normalize(normalMatrix * normal);
    vTangentGuess = normalize(normalMatrix * vec3(1.0, 0.0, 0.0));
    gl_Position = projectionMatrix * mv;
  }
`;

const foilFrag = /* glsl */ `
  uniform sampler2D uAlbedo;
  uniform sampler2D uEmboss;
  uniform sampler2D uPacked;
  uniform sampler2D uHolo;

  uniform vec2 uHoloRepeat;
  uniform float uHoloAmount;
  uniform float uSheen;
  uniform float uSheenAmount;
  uniform float uEmbossScale;
  uniform float uOpacity;
  uniform float uHuePhase;

  uniform vec3 uLightDir;
  uniform vec3 uLightColor;
  uniform vec3 uFillDir;
  uniform vec3 uFillColor;
  uniform vec3 uAmbient;

  varying vec2 vUv;
  varying vec3 vViewPos;
  varying vec3 vNormal;
  varying vec3 vTangentGuess;

  ${SRGB_DECODE}
  ${SPECTRUM}
  ${TANGENT_FRAME}

  void main() {
    vec3 base = srgbToLinear(texture2D(uAlbedo, vUv).rgb);

    // R is the foil mask, G is roughness. Phase 4 wired B to metallic for the
    // glTF convention and left it at zero, which is correct for a paper card.
    vec2 packed = texture2D(uPacked, vUv).rg;
    float foil = packed.r;
    float rough = clamp(packed.g, 0.04, 1.0);

    vec3 n = normalize(vNormal);
    mat3 tbn = tangentFrame(n, vTangentGuess);

    vec3 embossN = texture2D(uEmboss, vUv).rgb * 2.0 - 1.0;
    embossN.xy *= uEmbossScale;

    // The tiling holo normal only perturbs where there is foil. Off the foil it
    // would be a repeating pattern pressed into flat printed card stock, which
    // is the tell that reads as a decal rather than as a material.
    vec3 holoN = texture2D(uHolo, vUv * uHoloRepeat).rgb * 2.0 - 1.0;
    vec3 tangentN = normalize(embossN + vec3(holoN.xy * foil * (0.35 + uHoloAmount), 0.0));

    vec3 N = normalize(tbn * tangentN);
    vec3 V = normalize(-vViewPos);
    vec3 L = normalize(uLightDir);
    vec3 F = normalize(uFillDir);

    float ndl = max(dot(N, L), 0.0);
    float ndf = max(dot(N, F), 0.0);

    /*
     * The three terms are balanced to land at a multiplier of 1.0 on a card
     * facing the camera, not above it. An unnormalised rig here reads as a
     * washed out card rather than as a bright one, because the printed art is
     * already near white in the frame and the highlights clip before the
     * midtones have moved.
     */
    vec3 lit = base * (uAmbient + uLightColor * ndl + uFillColor * ndf * 0.26);

    vec3 h = normalize(L + V);
    float shine = exp2(mix(10.0, 2.5, rough));
    float spec = pow(max(dot(N, h), 0.0), shine);
    lit += uLightColor * spec * mix(0.04, 0.30, foil);

    // The view-angle hue shift. The band index is driven by the angle between
    // the perturbed normal and the eye, so it sweeps as the slab turns rather
    // than as time passes, and it is multiplied by the mask so it can only
    // appear where the card actually carries foil.
    float ang = dot(N, V);
    float band = fract(ang * 2.6 - ndl * 0.7 + uHuePhase);
    vec3 iris = spectrum(band);

    // Sparkle. The same holo normal read at a much tighter exponent, so the
    // pattern resolves into discrete glints instead of a flat wash.
    float sparkle = pow(max(dot(N, h), 0.0), 140.0);

    lit += iris * foil * uHoloAmount * (0.16 + 0.62 * sparkle);

    // The sheen bar, at the mockup's 102 degrees, travelling across the face.
    // Softer on unfoiled card stock than on foil, which is what separates a
    // raking light crossing a real card from a white gradient sliding over an
    // image.
    float axis = vUv.x * 0.978 + (1.0 - vUv.y) * 0.208;
    float sheen = smoothstep(0.13, 0.0, abs(axis - uSheen));
    lit += vec3(1.0) * sheen * uSheenAmount * mix(0.05, 0.44, foil);

    gl_FragColor = vec4(lit, uOpacity);

    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export function createFoilMaterial(tex: FoilTextures): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: foilVert,
    fragmentShader: foilFrag,
    transparent: true,
    depthWrite: true,
    side: FrontSide,
    blending: NormalBlending,
    uniforms: {
      uAlbedo: { value: tex.albedo },
      uEmboss: { value: tex.emboss },
      uPacked: { value: tex.packed },
      uHolo: { value: tex.holo },
      /*
       * The tile covers a good fraction of the card rather than repeating a
       * dozen times across it. At 3.0 by 4.2 the 1024 px pattern was minified
       * about twelvefold on a 250 px card and the ray clusters aliased into
       * regular banding, which is half of what falsifier A caught. Fewer,
       * larger clusters resolve instead of beating against the pixel grid.
       */
      uHoloRepeat: { value: new Vector2(1.7, 2.4) },
      uHoloAmount: { value: 0.16 },
      uSheen: { value: -1.5 },
      uSheenAmount: { value: 0.0 },
      uEmbossScale: { value: 1.15 },
      uOpacity: { value: 1.0 },
      uHuePhase: { value: 0.0 },
      uLightDir: { value: new Vector3(-0.28, 0.36, 0.72).normalize() },
      uLightColor: { value: new Color(0xfff4e2).multiplyScalar(0.72) },
      uFillDir: { value: new Vector3(0.34, -0.12, 0.6).normalize() },
      uFillColor: { value: new Color(0xdfe9f2).multiplyScalar(0.9) },
      uAmbient: { value: new Color(0xfffaf2).multiplyScalar(0.30) },
    },
  });
}

/* ------------------------------------------------------------- slab glass */

const slabVert = /* glsl */ `
  varying vec3 vViewPos;
  varying vec3 vNormal;
  varying vec2 vLocal;

  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vViewPos = mv.xyz;
    vNormal = normalize(normalMatrix * normal);
    // Object space XY, used to find the card well. The slab and the card come
    // out of the same GLB, so this frame is shared and the well bounds can be
    // measured off the card geometry rather than restated as a constant.
    vLocal = position.xy;
    gl_Position = projectionMatrix * mv;
  }
`;

const slabFrag = /* glsl */ `
  uniform vec3 uGlass;
  uniform vec3 uRim;
  uniform float uFresnelPower;
  uniform float uBaseAlpha;
  uniform float uWellAlpha;
  uniform float uRimAlpha;
  uniform float uOpacity;
  uniform vec3 uLightDir;
  uniform vec2 uWellMin;
  uniform vec2 uWellMax;
  uniform float uWellFeather;

  varying vec3 vViewPos;
  varying vec3 vNormal;
  varying vec2 vLocal;

  ${SRGB_DECODE}

  void main() {
    // gl_FrontFacing rather than a second draw. The cavity interior faces point
    // inward, and without this they read as the near black band the Phase 4
    // render showed, because a sealed void receives no light. Flipping the
    // normal lets them take the same rim response as the outer shell, which is
    // the interior fill PHASE4.md asks Phase 5 for.
    vec3 N = normalize(vNormal) * (gl_FrontFacing ? 1.0 : -1.0);
    vec3 V = normalize(-vViewPos);
    vec3 L = normalize(uLightDir);

    float ndv = clamp(abs(dot(N, V)), 0.0, 1.0);
    float fres = pow(1.0 - ndv, uFresnelPower);

    vec3 col = mix(srgbToLinear(uGlass), srgbToLinear(uRim), fres);

    // One specular streak stands in for the environment the transmission pass
    // is no longer there to sample.
    vec3 h = normalize(L + V);
    float streak = pow(max(dot(N, h), 0.0), 220.0);
    col += vec3(1.0) * streak * 0.85;

    /*
     * The acrylic is only nearly clear over the card. Everywhere else it is
     * 7 mm of material with a sealed void behind it and reads as solid light
     * grey, which is what gives the case its presence against the paper. A
     * uniform alpha makes the whole thing a pane of glass and the slab stops
     * looking like an object.
     */
    vec2 inside = smoothstep(uWellMin, uWellMin + uWellFeather, vLocal)
                * (1.0 - smoothstep(uWellMax - uWellFeather, uWellMax, vLocal));
    float well = inside.x * inside.y;
    float body = mix(uBaseAlpha, uWellAlpha, well);

    float alpha = mix(body, uRimAlpha, fres) + streak * 0.5;
    gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0) * uOpacity);

    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export function createSlabMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: slabVert,
    fragmentShader: slabFrag,
    transparent: true,
    // The card behind has to stay visible through the acrylic, so the glass
    // does not write depth and is drawn after everything it covers.
    depthWrite: false,
    side: DoubleSide,
    blending: NormalBlending,
    uniforms: {
      /*
       * Retuned once the poster stopped being a fixed reference.
       *
       * The poster now renders from this scene, so nothing here has to sit
       * beside a still of a different material. The earlier figures held the
       * case at a fairly opaque grey, which read as a flat plate rather than as
       * acrylic. Compared by rendering four variants through the poster camera
       * and looking at them: a lighter body with a sharper fresnel reads as
       * clear plastic, and going further still, to a base alpha of 0.16, loses
       * the case edge into the paper on the unlit side.
       */
      uGlass: { value: new Color(0xf2f6f9) },
      uRim: { value: new Color(0xffffff) },
      uFresnelPower: { value: 3.4 },
      /*
       * Halved against what the case is meant to read at, because the material
       * is DoubleSide and every ray through the slab crosses two walls. Two
       * layers at 0.22 composite to 0.39. Setting the intended figure here
       * instead gives a case that is opaque and blue.
       */
      uBaseAlpha: { value: 0.22 },
      uWellAlpha: { value: 0.022 },
      uRimAlpha: { value: 1.0 },
      uOpacity: { value: 1.0 },
      uLightDir: { value: new Vector3(-0.28, 0.36, 0.72).normalize() },
      uWellMin: { value: new Vector2(-0.033, -0.052) },
      uWellMax: { value: new Vector2(0.033, 0.039) },
      uWellFeather: { value: 0.0015 },
    },
  });
}

/* ----------------------------------------------------------------- shadow */

/**
 * The contact shadow, handoff spec section 05: 0 34px 64px -26px
 * rgba(30,28,24,0.44) plus 0 2px 8px rgba(30,28,24,0.12).
 *
 * A quad with a rounded box distance field rather than a shadow map. There is
 * one caster, one receiver and no light rig to speak of, so a shadow pass would
 * be a second render target and a depth texture to reproduce a value the design
 * already states in closed form.
 */
const shadowVert = /* glsl */ `
  varying vec2 vPos;
  uniform vec2 uHalf;
  void main() {
    vPos = position.xy * uHalf * 2.0;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position.xy * uHalf * 2.0, 0.0, 1.0);
  }
`;

const shadowFrag = /* glsl */ `
  varying vec2 vPos;
  uniform vec2 uBox;
  uniform float uRadius;
  uniform float uBlur;
  uniform vec2 uOffset;
  uniform float uNear;
  uniform float uNearBlur;
  uniform float uOpacity;
  uniform vec3 uColor;

  float roundedBox(vec2 p, vec2 b, float r) {
    vec2 q = abs(p) - b + r;
    return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
  }

  void main() {
    float far = 1.0 - smoothstep(-uBlur, uBlur, roundedBox(vPos - uOffset, uBox, uRadius));
    float near = 1.0 - smoothstep(-uNearBlur, uNearBlur,
      roundedBox(vPos - vec2(0.0, uNear), uBox + uBlur * 0.42, uRadius));
    float a = far * 0.44 + near * 0.12;
    gl_FragColor = vec4(uColor, clamp(a, 0.0, 1.0) * uOpacity);
    #include <colorspace_fragment>
  }
`;

export function createShadowMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: shadowVert,
    fragmentShader: shadowFrag,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    uniforms: {
      uHalf: { value: new Vector2(1, 1) },
      uBox: { value: new Vector2(1, 1) },
      uRadius: { value: 0.01 },
      uBlur: { value: 0.01 },
      uOffset: { value: new Vector2(0, -0.01) },
      uNear: { value: -0.001 },
      uNearBlur: { value: 0.002 },
      uOpacity: { value: 1 },
      uColor: { value: new Color(0x1e1c18) },
    },
  });
}

/* ------------------------------------------------------------------ label */

const labelVert = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vViewPos;
  varying vec3 vNormal;
  void main() {
    vUv = uv;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vViewPos = mv.xyz;
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * mv;
  }
`;

const labelFrag = /* glsl */ `
  uniform sampler2D uMap;
  uniform float uOpacity;
  uniform vec3 uLightDir;
  uniform vec3 uAmbient;
  varying vec2 vUv;
  varying vec3 vViewPos;
  varying vec3 vNormal;

  ${SRGB_DECODE}

  void main() {
    vec3 base = srgbToLinear(texture2D(uMap, vUv).rgb);
    vec3 N = normalize(vNormal);
    float ndl = max(dot(N, normalize(uLightDir)), 0.0);
    gl_FragColor = vec4(base * (uAmbient + vec3(1.0) * ndl * 0.55), uOpacity);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export function createLabelMaterial(map: Texture): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: labelVert,
    fragmentShader: labelFrag,
    transparent: true,
    side: FrontSide,
    uniforms: {
      uMap: { value: map },
      uOpacity: { value: 1.0 },
      uLightDir: { value: new Vector3(-0.28, 0.36, 0.72).normalize() },
      uAmbient: { value: new Color(0xffffff).multiplyScalar(0.62) },
    },
  });
}

/* -------------------------------------------------------------- fan, beat 7 */

/**
 * The collection fan. Five instances of one plane, each choosing its own albedo
 * from a per-instance index.
 *
 * GLSL ES cannot index an array of samplers with a value that is not
 * dynamically uniform, and an instance index is not. The selection is therefore
 * an unrolled comparison over the five slots, which compiles to five texture
 * reads and one select rather than to a dynamic lookup.
 */
const fanVert = /* glsl */ `
  attribute float aFace;
  attribute float aSpread;
  varying vec2 vUv;
  varying float vFace;

  uniform float uSpread;
  uniform float uPivotY;

  void main() {
    // V is flipped because the fan is a hand built PlaneGeometry, whose UV
    // origin is bottom left, sampling KTX2 textures, which are stored top down
    // and cannot be flipped on upload the way an uncompressed texture can. The
    // card in the GLB needs no flip: Blender authored its UVs against glTF's
    // own top left convention.
    vUv = vec2(uv.x, 1.0 - uv.y);
    vFace = aFace;

    // Fan spread, handoff spec section 08: rotations of plus or minus 15 and
    // 7.5 degrees, origin 50% 130%. The per-instance offsets of plus or minus
    // 238 and 119 px are in the instance matrix, so the rotation here happens
    // about the pivot first and the offset is applied after it.
    float ang = radians(15.0) * uSpread * aSpread;
    float c = cos(ang);
    float sn = sin(ang);

    vec3 p = position;
    p.y -= uPivotY;
    vec3 r = vec3(p.x * c - p.y * sn, p.x * sn + p.y * c, p.z);
    r.y += uPivotY;

    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(r, 1.0);
  }
`;

const fanFrag = /* glsl */ `
  uniform sampler2D uFace0;
  uniform sampler2D uFace1;
  uniform sampler2D uFace2;
  uniform sampler2D uFace3;
  uniform sampler2D uFace4;
  uniform float uOpacity;

  varying vec2 vUv;
  varying float vFace;

  ${SRGB_DECODE}

  void main() {
    float f = floor(vFace + 0.5);
    vec3 c = srgbToLinear(texture2D(uFace0, vUv).rgb);
    c = mix(c, srgbToLinear(texture2D(uFace1, vUv).rgb), step(0.5, f) * step(f, 1.5));
    c = mix(c, srgbToLinear(texture2D(uFace2, vUv).rgb), step(1.5, f) * step(f, 2.5));
    c = mix(c, srgbToLinear(texture2D(uFace3, vUv).rgb), step(2.5, f) * step(f, 3.5));
    c = mix(c, srgbToLinear(texture2D(uFace4, vUv).rgb), step(3.5, f));
    gl_FragColor = vec4(c, uOpacity);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export function createFanMaterial(faces: Texture[]): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: fanVert,
    fragmentShader: fanFrag,
    transparent: true,
    side: FrontSide,
    uniforms: {
      uFace0: { value: faces[0] },
      uFace1: { value: faces[1] ?? faces[0] },
      uFace2: { value: faces[2] ?? faces[0] },
      uFace3: { value: faces[3] ?? faces[0] },
      uFace4: { value: faces[4] ?? faces[0] },
      uSpread: { value: 0 },
      uOpacity: { value: 1 },
      uPivotY: { value: -0.80 },
    },
  });
}
