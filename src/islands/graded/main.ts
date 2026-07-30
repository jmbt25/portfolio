/**
 * The graded slab stage.
 *
 * One WebGLRenderer, one canvas, one scene. Seven GSAP timelines, one per beat,
 * scrubbed by ScrollTrigger against the beat sections themselves, so beat k
 * occupies the k-th seventh of p at every width exactly as handoff spec section
 * 08 defines it.
 *
 * Nothing here runs unless Stage.astro's guards passed: 1024 or wider, WebGL2
 * present, reduced motion not requested.
 */

import {
  DynamicDrawUsage,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MathUtils,
  Mesh,
  NoToneMapping,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  SRGBColorSpace,
  ShaderMaterial,
  Vector3,
  WebGLRenderer,
} from 'three';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

import { BEATS, TR } from '../../data/beats';
import { Assets, type CardSet } from './loaders';
import {
  createFanMaterial,
  createFoilMaterial,
  createLabelMaterial,
  createShadowMaterial,
  createSlabMaterial,
} from './materials';

gsap.registerPlugin(ScrollTrigger);

/** Slab outer width in metres, from scripts/blender/spec.py. */
const SLAB_W = 0.085;

/** Slab display width as a ratio of --cw, per docs/handoff/design-ref/README.md. */
const SLAB_RATIO = 1.1075;

/**
 * The mockup's `perspective: 1700px`, carried across rather than picked, so the
 * foreshortening on the 3D slab matches the layouts the screenshots are
 * compared against.
 */
const PERSPECTIVE_PX = 1700;

/**
 * How far behind the slab the contact shadow plane sits, in metres. Clear of
 * the 42.5 mm the slab reaches at the edge pass.
 */
const SHADOW_Z = 0.06;

/** Card aspect, exactly 63:88. */
const CARD_ASPECT = 1408 / 1008;

/** Handoff spec section 08: cubic in-out on position, rotation and scale. */
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/**
 * The two halves of that curve, renormalised.
 *
 * A transition window straddles a beat boundary: its second half is the
 * incoming beat's first 0.16 of u, its first half the outgoing beat's last
 * 0.16. One timeline per beat therefore owns half a window at each end, and
 * each half has to run the slice of the shared curve that belongs to it or the
 * two halves will not meet with a matching tangent on the boundary.
 */
const easeSecondHalf = (t: number) => (easeInOut(0.5 + t * 0.5) - 0.5) / 0.5;
const easeFirstHalf = (t: number) => easeInOut(t * 0.5) / 0.5;

/** The edge pass is a half sine on raw, so its two halves slice the same way. */
const sinIn = (t: number) => Math.sin(Math.PI * (t * 0.5));
const sinOut = (t: number) => 1 - Math.sin(Math.PI * (0.5 + t * 0.5));

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * One state object per beat, never shared.
 *
 * Seven scrubbed timelines writing into one object is a race: GSAP updates
 * every trigger on a scroll tick, in scroll order, and the beat that is
 * actually active is not necessarily the last one to write. Giving each beat
 * its own object and reading only the active one removes the ordering question
 * rather than depending on it resolving favourably.
 */
interface State {
  x: number;
  ry: number;
  rx: number;
  rz: number;
  s: number;
  /** Edge pass yaw, added to ry. Plus or minus 92 degrees at the midpoint. */
  flip: number;
  /** Accumulated card slot rotation in half turns. One per beat boundary. */
  slot: number;
  /** Transition parameter, 0 to 1 across a whole window, 0 while holding. */
  raw: number;
  /** Beat 2 only. Drives holo, sheen and the brass wash off one bell curve. */
  reveal: number;
  /** Beat 7 only. */
  outY: number;
  spread: number;
  fanIn: number;
}

function seed(i: number): State {
  const b = BEATS[i];
  return {
    x: b.x, ry: b.ry, rx: b.rx, rz: b.rz, s: b.s,
    flip: 0, slot: i, raw: 0, reveal: 0, outY: 0, spread: 0, fanIn: 0,
  };
}

export async function start(stage: HTMLElement): Promise<void> {
  const canvas = stage.querySelector<HTMLCanvasElement>('[data-stage-canvas]');
  if (!canvas) throw new Error('no canvas in the stage');

  const renderer = new WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance',
  });
  renderer.setClearAlpha(0);
  renderer.outputColorSpace = SRGBColorSpace;
  /*
   * No tone mapping. The Phase 4 verification render used ACES because it was
   * framing a lit object on its own; here the canvas composites over paper
   * white next to a static poster of the same slab, and ACES desaturates the
   * card art enough that the crossfade reads as a colour shift. The shaders are
   * balanced to stay in range instead, which is the trade a compositing layer
   * should make.
   */
  renderer.toneMapping = NoToneMapping;

  let dprCap = 2;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, dprCap));

  const scene = new Scene();
  const camera = new PerspectiveCamera(30, 1, 0.01, 40);

  /* ------------------------------------------------------------- geometry */

  const assets = new Assets(renderer);
  const [root, , hero] = await Promise.all([
    assets.model(),
    assets.loadShared(),
    assets.set(0),
  ]);

  const byName = new Map<string, Mesh>();
  root.traverse((o) => { if ((o as Mesh).isMesh) byName.set(o.name, o as Mesh); });
  const cardMesh = byName.get('Card');
  const labelMesh = byName.get('Label');
  const slabMesh = byName.get('Slab');
  if (!cardMesh || !labelMesh || !slabMesh) throw new Error('slab GLB is missing a mesh');

  const slabMat = createSlabMaterial();
  slabMesh.material = slabMat;
  // The glass does not write depth, so it is drawn after everything it covers.
  // Without this the card can land on top of the case it sits inside.
  slabMesh.renderOrder = 10;

  /*
   * The card well, measured off the card geometry rather than restated from
   * spec.py. The slab and the card share an object frame, so the card's own
   * bounding box is the window, grown by the 1.00 mm per side of cavity
   * clearance Phase 4 built in. Measuring it means a change to the model
   * cannot silently leave a hand-copied constant behind.
   */
  cardMesh.geometry.computeBoundingBox();
  const cardBox = cardMesh.geometry.boundingBox!;
  const CLEARANCE = 0.001;
  slabMat.uniforms.uWellMin.value.set(
    cardBox.min.x + cardMesh.position.x - CLEARANCE,
    cardBox.min.y + cardMesh.position.y - CLEARANCE,
  );
  slabMat.uniforms.uWellMax.value.set(
    cardBox.max.x + cardMesh.position.x + CLEARANCE,
    cardBox.max.y + cardMesh.position.y + CLEARANCE,
  );

  const labelMat = createLabelMaterial(hero.label);
  labelMesh.material = labelMat;

  /*
   * Two card meshes in the slot, 180 degrees apart. A face swap turns the slot
   * by half a turn, which brings the hidden mesh to the front, and the mesh
   * that just left the front is the one whose textures are replaced. The shader
   * crossfade covers the handoff; at the midpoint of the turn the card is edge
   * on and the slab is at plus or minus 92 degrees as well, so there is nothing
   * on screen for the blend to show through.
   */
  const slot = new Group();
  slot.position.copy(cardMesh.position);
  slot.quaternion.copy(cardMesh.quaternion);
  slot.scale.copy(cardMesh.scale);
  cardMesh.parent?.add(slot);
  cardMesh.removeFromParent();

  const cardA = cardMesh;
  cardA.position.set(0, 0, 0);
  cardA.quaternion.identity();
  cardA.scale.set(1, 1, 1);
  const cardB = cardA.clone();
  cardB.rotation.y = Math.PI;
  slot.add(cardA, cardB);

  const mats = [
    createFoilMaterial({ albedo: hero.albedo, emboss: assets.emboss, packed: hero.packed, holo: hero.holo }),
    createFoilMaterial({ albedo: hero.albedo, emboss: assets.emboss, packed: hero.packed, holo: hero.holo }),
  ];
  cardA.material = mats[0];
  cardB.material = mats[1];

  /** Which face index each slot currently carries. */
  const carried: [number, number] = [0, 0];

  function carry(which: 0 | 1, faceIndex: number): void {
    if (carried[which] === faceIndex) return;
    carried[which] = faceIndex;
    assets.set(faceIndex).then((s: CardSet) => {
      // A late arrival must not overwrite a slot that has since moved on.
      if (carried[which] !== faceIndex) return;
      mats[which].uniforms.uAlbedo.value = s.albedo;
      mats[which].uniforms.uPacked.value = s.packed;
      mats[which].uniforms.uHolo.value = s.holo;
    }).catch(() => { carried[which] = -1; });
  }

  /** The label swaps in the same tick as the face, per handoff spec section 08. */
  let labelFace = 0;
  function carryLabel(faceIndex: number): void {
    if (labelFace === faceIndex || faceIndex < 0) return;
    labelFace = faceIndex;
    assets.set(faceIndex).then((s) => {
      if (labelFace !== faceIndex) return;
      labelMat.uniforms.uMap.value = s.label;
    }).catch(() => { /* keep the label already up */ });
  }

  const slab = new Group();
  slab.add(root);
  scene.add(slab);

  /*
   * The contact shadow. It tracks the slab's position but never its rotation,
   * because a drop shadow is cast onto the page behind the case rather than
   * onto a floor the case is standing on. Drawn before everything, with depth
   * test off, so it can sit behind the glass without being culled by it.
   */
  const shadowMat = createShadowMaterial();
  const shadow = new Mesh(new PlaneGeometry(1, 1), shadowMat);
  shadow.renderOrder = -1;
  shadow.frustumCulled = false;
  scene.add(shadow);

  /* ------------------------------------------------------------ beat 7 fan */

  // Handoff spec section 08: rotations of plus or minus 15 and 7.5 degrees,
  // offsets of plus or minus 238 and 119 px, origin 50% 130%, cards at 0.62 of
  // card width.
  const FAN_ROT = new Float32Array([-1, -0.5, 0, 0.5, 1]);
  const FAN_DX = [-238, -119, 0, 119, 238];
  const FAN_DY = [30, 8, 0, 8, 30];

  const fanGeo = new PlaneGeometry(1, CARD_ASPECT);
  fanGeo.setAttribute('aFace', new InstancedBufferAttribute(new Float32Array([0, 1, 2, 3, 4]), 1));
  fanGeo.setAttribute('aSpread', new InstancedBufferAttribute(FAN_ROT, 1));
  const fanMat = createFanMaterial([hero.albedo]);
  fanMat.uniforms.uPivotY.value = -0.80 * CARD_ASPECT;
  const fan = new InstancedMesh(fanGeo, fanMat, 5);
  fan.instanceMatrix.setUsage(DynamicDrawUsage);
  fan.frustumCulled = false;
  fan.visible = false;
  scene.add(fan);

  // Each set feeds its albedo into the fan as it arrives. Subscribing rather
  // than requesting: the beats fetch these on their own schedule and by beat 6
  // all five have been through, so the fan costs no extra request.
  assets.onSet((i, s) => { fanMat.uniforms[`uFace${i}`].value = s.albedo; });

  /* ---------------------------------------------------------------- sizing */

  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;left:0;top:0;width:var(--cw);height:0;visibility:hidden;';
  stage.appendChild(probe);

  let worldPerPx = 1;
  let viewH = 1;

  function resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    viewH = h;
    const cw = probe.getBoundingClientRect().width || 372;

    // The slab is sized by its flat width so the ratio holds across the whole
    // clamp(240px, 24vw, 372px) range, not only at the maximum, which is all a
    // fixed 40px inset can do.
    worldPerPx = SLAB_W / (SLAB_RATIO * cw);

    camera.fov = MathUtils.radToDeg(2 * Math.atan(h / (2 * PERSPECTIVE_PX)));
    camera.aspect = w / h;
    camera.position.set(0, 0, PERSPECTIVE_PX * worldPerPx);
    camera.near = worldPerPx * 8;
    camera.far = PERSPECTIVE_PX * worldPerPx * 4;
    camera.updateProjectionMatrix();

    renderer.setSize(w, h, false);

    // The shadow figures are the CSS ones converted to world units: the case
    // shape shrunk by the 26px spread, offset 34px down, blurred over 64px,
    // plus the tight 2px/8px pair underneath.
    const u = (px: number) => px * worldPerPx;
    const slabH = SLAB_W * (134 / 85);
    shadowMat.uniforms.uHalf.value.set(SLAB_W * 0.5 + u(90), slabH * 0.5 + u(90));
    shadowMat.uniforms.uBox.value.set(SLAB_W * 0.5 - u(26), slabH * 0.5 - u(26));
    shadowMat.uniforms.uRadius.value = u(16);
    shadowMat.uniforms.uBlur.value = u(32);
    shadowMat.uniforms.uOffset.value.set(0, -u(34));
    shadowMat.uniforms.uNear.value = -u(2);
    shadowMat.uniforms.uNearBlur.value = u(4);
  }

  /* ----------------------------------------------------------------- state */

  const states = BEATS.map((_, i) => seed(i));
  let active = 0;

  const fanMatrix = new Matrix4();
  let elapsed = 0;

  function apply(dt: number): void {
    elapsed += dt;
    const S = states[active];

    // Idle float and yaw, handoff spec section 08 beat 1: 7px over 7.5s plus
    // plus or minus 1.8 degrees of yaw. Reduced motion never reaches this
    // module, so there is no branch for it here.
    const floatPx = Math.sin((elapsed / 7.5) * Math.PI * 2) * -3.5;
    const idleYaw = Math.sin(elapsed / 2.6) * 1.8;

    slab.position.set(
      S.x * worldPerPx,
      (S.outY * 0.01 * viewH + floatPx) * worldPerPx,
      0,
    );
    slab.rotation.set(
      MathUtils.degToRad(S.rx),
      MathUtils.degToRad(S.ry + S.flip + idleYaw),
      MathUtils.degToRad(S.rz),
    );
    slab.scale.setScalar(S.s);

    /*
     * The shadow plane sits behind the slab's whole rotation envelope, not just
     * behind its resting depth. At the edge pass the slab is at plus or minus
     * 92 degrees and spans 42.5 mm of z, so a quad a few millimetres back ends
     * up in front of half the card and paints a grey wash across it. The
     * perspective shrink from being that far back is compensated on the scale.
     */
    shadow.position.set(slab.position.x, slab.position.y, -SHADOW_Z);
    shadow.scale.setScalar(S.s * (camera.position.z + SHADOW_Z) / camera.position.z);
    // The shadow fades as the slab turns towards edge on, which is the one
    // thing a flat quad cannot express by itself.
    shadowMat.uniforms.uOpacity.value =
      Math.max(0, Math.cos(MathUtils.degToRad(S.ry + S.flip))) * (S.outY < -6 ? 0 : 1);

    slot.rotation.y = Math.PI * S.slot;

    /*
     * The crossfade sits inside the edge pass rather than across the whole
     * transition, so the blend runs while the card has almost no projected
     * area. floor() rather than round() on the slot: it is stable for the whole
     * window, which is what makes "the mesh that is leaving" a well defined
     * thing to fade out.
     */
    const leaving = (Math.floor(S.slot + 1e-6) % 2 === 0 ? 0 : 1) as 0 | 1;
    const arriving = (leaving === 0 ? 1 : 0) as 0 | 1;
    const mix = MathUtils.smoothstep(S.raw, 0.42, 0.58);
    mats[leaving].uniforms.uOpacity.value = 1 - mix;
    mats[arriving].uniforms.uOpacity.value = mix;
    carryLabel(carried[mix < 0.5 ? leaving : arriving]);

    // Beat 2 drives holo, sheen and the brass wash off one bell curve, so they
    // peak together at the middle of the hold and are all back at rest by the
    // time the beat hands over. Every other beat leaves reveal at 0, where the
    // bell is 0 and these are at their resting values.
    const bell = Math.sin(Math.PI * S.reveal);
    for (const m of mats) {
      m.uniforms.uHoloAmount.value = 0.16 + (0.90 - 0.16) * bell;
      m.uniforms.uSheen.value = lerp(-1.5, 1.5, S.reveal);
      m.uniforms.uSheenAmount.value = bell;
      m.uniforms.uHuePhase.value = elapsed * 0.015;
    }
    slabMat.uniforms.uRimAlpha.value = 0.92 + bell * 0.06;

    fan.visible = S.fanIn > 0.001;
    if (fan.visible) {
      const cardW = (SLAB_W / SLAB_RATIO) * 0.62;
      const y = (0.18 * viewH - lerp(1.2 * viewH, 0, S.spread)) * worldPerPx;
      for (let i = 0; i < 5; i++) {
        fanMatrix.makeScale(cardW, cardW, cardW);
        fanMatrix.setPosition(
          FAN_DX[i] * S.spread * worldPerPx,
          y - FAN_DY[i] * S.spread * worldPerPx,
          i === 2 ? 0.0008 : 0,
        );
        fan.setMatrixAt(i, fanMatrix);
      }
      fan.instanceMatrix.needsUpdate = true;
      fanMat.uniforms.uSpread.value = S.spread;
      fanMat.uniforms.uOpacity.value = S.fanIn;
    }
  }

  /* ----------------------------------------------------------- choreography */

  const rails = Array.from(document.querySelectorAll<HTMLElement>('[data-rail]'));
  const hud = {
    pct: document.querySelector<HTMLElement>('[data-hud="pct"]'),
    beat: document.querySelector<HTMLElement>('[data-hud="beat"]'),
    range: document.querySelector<HTMLElement>('[data-hud="range"]'),
    phase: document.querySelector<HTMLElement>('[data-hud="phase"]'),
    bar: document.querySelector<HTMLElement>('[data-hud="bar"]'),
  };
  const pct = (n: number) => (n * 100).toFixed(2);

  function updateChrome(i: number, u: number): void {
    const p = (i + u) / 7;
    if (hud.pct) hud.pct.textContent = `${pct(p)}%`;
    if (hud.beat) hud.beat.textContent = `${String(i + 1).padStart(2, '0')} ${BEATS[i].name}`;
    if (hud.range) hud.range.textContent = `${pct(i / 7)} to ${pct((i + 1) / 7)}%`;
    if (hud.phase) hud.phase.textContent = u < 0.25 ? 'ENTRANCE' : u < 0.75 ? 'HOLD' : 'EXIT';
    if (hud.bar) hud.bar.style.width = `${(u * 100).toFixed(1)}%`;
    for (let k = 0; k < rails.length; k++) {
      rails[k].setAttribute('aria-current', k === i ? 'true' : 'false');
    }
  }

  for (let i = 0; i < BEATS.length; i++) {
    const sec = document.getElementById(`beat-${BEATS[i].n}`);
    if (!sec) continue;
    const S = states[i];
    const cur = BEATS[i];
    const prev = BEATS[i - 1];
    const next = BEATS[i + 1];

    const tl = gsap.timeline({ paused: true });
    const holdStart = prev ? TR : 0;
    const holdEnd = next ? 1 - TR : 1;
    const holdDur = Math.max(holdEnd - holdStart, 0.0001);

    if (prev) {
      const dir = cur.x >= prev.x ? 1 : -1;
      tl.fromTo(S,
        {
          x: lerp(prev.x, cur.x, 0.5), ry: lerp(prev.ry, cur.ry, 0.5),
          rx: lerp(prev.rx, cur.rx, 0.5), rz: lerp(prev.rz, cur.rz, 0.5),
          s: lerp(prev.s, cur.s, 0.5),
        },
        { x: cur.x, ry: cur.ry, rx: cur.rx, rz: cur.rz, s: cur.s, duration: TR, ease: easeSecondHalf },
        0)
        .fromTo(S, { flip: 92 * dir }, { flip: 0, duration: TR, ease: sinOut }, 0)
        .fromTo(S, { raw: 0.5, slot: i - 0.5 }, { raw: 1, slot: i, duration: TR, ease: 'none' }, 0);
    }

    // The hold resets raw to 0 so the next window starts from a clean edge. At
    // the instant this runs the smoothstep has been pinned at 1 for a while and
    // the slot parity flips with it, so the same mesh stays on screen.
    tl.set(S, { raw: 0, slot: i }, holdStart);

    if (i === 1) {
      // Beat 2, the reveal. rotateY sweeps -34 to +34 across the hold and
      // rotateX 6 to -2. Everything else this beat does hangs off reveal.
      tl.fromTo(S, { ry: -34 }, { ry: 34, duration: holdDur, ease: 'power3.inOut' }, holdStart)
        .fromTo(S, { rx: 6 }, { rx: -2, duration: holdDur, ease: 'none' }, holdStart)
        .fromTo(S, { reveal: 0 }, { reveal: 1, duration: holdDur, ease: 'none' }, holdStart);
    } else {
      // A held beat drifts 6 degrees of yaw, which is what keeps it from
      // reading as a frozen render.
      tl.fromTo(S, { ry: cur.ry - 3 }, { ry: cur.ry + 3, duration: holdDur, ease: 'none' }, holdStart);
    }

    if (i === 6) {
      // Beat 7. The slab exits on translateY to -135vh over u 0 to 0.32, the
      // fan spread runs over u 0.05 to 0.45.
      tl.fromTo(S, { outY: 0 }, { outY: -135, duration: 0.32, ease: 'power3.inOut' }, 0)
        .fromTo(S, { fanIn: 0 }, { fanIn: 1, duration: 0.10, ease: 'none' }, 0.05)
        .fromTo(S, { spread: 0 }, { spread: 1, duration: 0.40, ease: 'power3.inOut' }, 0.05);
    }

    if (next) {
      const dir = next.x >= cur.x ? 1 : -1;
      tl.to(S, {
        x: lerp(cur.x, next.x, 0.5), ry: lerp(cur.ry, next.ry, 0.5),
        rx: lerp(cur.rx, next.rx, 0.5), rz: lerp(cur.rz, next.rz, 0.5),
        s: lerp(cur.s, next.s, 0.5),
        duration: TR, ease: easeFirstHalf,
      }, 1 - TR)
        .fromTo(S, { flip: 0 }, { flip: 92 * dir, duration: TR, ease: sinIn }, 1 - TR)
        .fromTo(S, { raw: 0, slot: i }, { raw: 0.5, slot: i + 0.5, duration: TR, ease: 'none' }, 1 - TR);
    }

    ScrollTrigger.create({
      trigger: sec,
      // u is the viewport centre's normalised position through the section,
      // which is exactly "top center" to "bottom center".
      start: 'top center',
      end: 'bottom center',
      scrub: true,
      animation: tl,
      onUpdate: (self) => {
        active = i;
        const u = self.progress;
        updateChrome(i, u);

        // The slot that is not at the front carries whichever neighbour this
        // beat is currently moving towards.
        const mine = (i % 2) as 0 | 1;
        const other = ((i + 1) % 2) as 0 | 1;
        carry(mine, cur.face);
        if (u > 1 - TR && next) carry(other, next.face);
        else if (u < TR && prev) carry(other, prev.face);
      },
      // The set for the next beat is fetched when this one starts, so it is
      // resident by the time the boundary needs it.
      onEnter: () => { if (next) void assets.set(next.face); },
      onEnterBack: () => { if (prev) void assets.set(prev.face); },
    });
  }

  /* -------------------------------------------------------------- run loop */

  let raf = 0;
  let last = performance.now();
  let lost = false;
  let ready = false;

  let probeStart = 0;
  let probeFrames = 0;
  let probeDone = false;

  /**
   * The DPR probe. One second of measurement on the real scene, then the cap is
   * set once and not revisited. It starts at the full cap so a capable GPU is
   * never punished for the measurement, and it measures this scene rather than
   * a synthetic load because what matters is whether this machine can draw
   * this.
   */
  function probeFrame(now: number): void {
    if (probeDone) return;
    if (probeStart === 0) { probeStart = now; return; }
    probeFrames++;
    const secs = (now - probeStart) / 1000;
    if (secs < 1) return;
    probeDone = true;
    const fps = probeFrames / secs;
    if (fps < 50) {
      dprCap = 1.5;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, dprCap));
      resize();
    }
    stage.dataset.probeFps = fps.toFixed(1);
    stage.dataset.dpr = String(renderer.getPixelRatio());
  }

  function frame(now: number): void {
    raf = requestAnimationFrame(frame);
    if (lost) return;
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    apply(dt);
    renderer.render(scene, camera);
    probeFrame(now);
    if (!ready) {
      ready = true;
      // Two rendered frames plus 420ms, per handoff spec section 08 beat 1.
      requestAnimationFrame(() => setTimeout(() => { stage.dataset.canvas = 'ready'; }, 420));
    }
  }

  /* ---------------------------------------------------------- context loss */

  canvas.addEventListener('webglcontextlost', (e) => {
    // Graceful swap back to the static path. The poster is still in the DOM and
    // is the same asset the fallback layout uses, so this is one attribute
    // change rather than a rebuild.
    e.preventDefault();
    lost = true;
    stage.dataset.canvas = 'lost';
    ScrollTrigger.getAll().forEach((t) => t.kill());
  }, false);

  canvas.addEventListener('webglcontextrestored', () => {
    // Deliberately not resumed. Once the static path is showing, swapping back
    // mid-scroll would be a second unannounced visual change on a page the
    // visitor is already reading.
    stage.dataset.canvas = 'lost';
  }, false);

  /* ------------------------------------------------------------------- go */

  resize();
  window.addEventListener('resize', () => { resize(); ScrollTrigger.refresh(); }, { passive: true });
  ScrollTrigger.refresh();
  raf = requestAnimationFrame(frame);

  /*
   * Exposed so the verification scripts can assert on the scene rather than on
   * a screenshot alone, and so a falsifier can isolate one term of a shader
   * instead of inferring it from a picture that contains every term at once.
   */
  (window as unknown as Record<string, unknown>).__graded = {
    renderer, scene, camera, states, mats, slabMat, fanMat,
    activeBeat: () => active,
    info: () => renderer.info,
    stop: () => cancelAnimationFrame(raf),
    /** Object space point on the slab to CSS pixels. */
    project: (x: number, y: number, z: number) => {
      const v = new Vector3(x, y, z);
      slab.updateWorldMatrix(true, false);
      root.updateWorldMatrix(true, false);
      v.applyMatrix4(root.matrixWorld).project(camera);
      return {
        x: (v.x * 0.5 + 0.5) * window.innerWidth,
        y: (-v.y * 0.5 + 0.5) * window.innerHeight,
      };
    },
  };
}
