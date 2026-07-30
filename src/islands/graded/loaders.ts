/**
 * Loading. One KTX2Loader and one GLTFLoader for the whole scene.
 *
 * The critical path is slab-runtime.glb plus the hero KTX2 set. The other four
 * card sets are fetched one beat ahead of the beat that shows them, so a
 * visitor who never scrolls past the hero never pays for them.
 */

import {
  LinearSRGBColorSpace,
  LinearMipmapLinearFilter,
  RepeatWrapping,
  type Group,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { FACES } from '../../data/beats';

const CARDS = '/assets/cards';

export interface CardSet {
  albedo: Texture;
  packed: Texture;
  label: Texture;
  holo: Texture;
}

export class Assets {
  private ktx2: KTX2Loader;
  private gltf: GLTFLoader;
  private holos = new Map<string, Promise<Texture>>();
  private sets = new Map<number, Promise<CardSet>>();

  emboss!: Texture;

  constructor(renderer: WebGLRenderer) {
    this.ktx2 = new KTX2Loader()
      .setTranscoderPath('/vendor/basis/')
      .detectSupport(renderer);
    // The runtime GLB carries no Draco, so no DRACOLoader is registered and its
    // 192 KB wasm decoder never reaches the client. See scripts/phase5/assets.mjs.
    this.gltf = new GLTFLoader().setKTX2Loader(this.ktx2);
  }

  /**
   * Every texture in this scene is sampled by an authored shader, so three's
   * automatic sRGB handling is switched off and the decode is done in GLSL.
   * KTX2Loader reads the transfer function out of the file and would otherwise
   * set SRGBColorSpace on the albedos, which selects an sRGB internal format
   * and makes the GPU decode too, giving a double decode that shows up as a
   * washed out card.
   */
  private tune(tex: Texture, tiling: boolean): Texture {
    tex.colorSpace = LinearSRGBColorSpace;
    tex.anisotropy = 8;
    if (tiling) {
      tex.wrapS = RepeatWrapping;
      tex.wrapT = RepeatWrapping;
      tex.minFilter = LinearMipmapLinearFilter;
    }
    tex.needsUpdate = true;
    return tex;
  }

  texture(url: string, tiling = false): Promise<Texture> {
    return this.ktx2.loadAsync(url).then((t) => this.tune(t, tiling));
  }

  holo(name: string): Promise<Texture> {
    let p = this.holos.get(name);
    if (!p) {
      p = this.texture(`${CARDS}/holo-${name}-normal.ktx2`, true);
      this.holos.set(name, p);
    }
    return p;
  }

  /** The shared frame emboss normal, one map across all five cards. */
  loadShared(): Promise<Texture> {
    return this.texture(`${CARDS}/frame-emboss-normal.ktx2`).then((t) => {
      this.emboss = t;
      return t;
    });
  }

  model(): Promise<Group> {
    return this.gltf.loadAsync('/assets/models/slab-runtime.glb').then((g) => g.scene);
  }

  /** A card set is idempotent and cached, so a re-entered beat costs nothing. */
  set(index: number): Promise<CardSet> {
    let p = this.sets.get(index);
    if (p) return p;
    const face = FACES[index];
    p = Promise.all([
      this.texture(`${CARDS}/${face.slug}-albedo.ktx2`),
      this.texture(`${CARDS}/${face.slug}-rg.ktx2`),
      this.texture(`${CARDS}/label-${face.slug}.ktx2`),
      this.holo(face.holo),
    ]).then(([albedo, packed, label, holo]) => {
      const set = { albedo, packed, label, holo };
      for (const cb of this.listeners) cb(index, set);
      return set;
    });
    this.sets.set(index, p);
    return p;
  }

  private listeners: ((index: number, set: CardSet) => void)[] = [];

  /**
   * Fires when a set finishes loading, whenever that happens to be.
   *
   * The beat 7 fan needs all five albedos, and the obvious way to get them is
   * to ask for all five up front. That silently un-lazies the whole scheme: it
   * pulled 1.6 MB of card sets down at hydration and the measured payload after
   * a full scroll was identical to the payload after hydration, which is the
   * tell. Subscribing instead means the fan is filled in by the sets the beats
   * were going to load anyway, and by beat 6 all five have been through.
   */
  onSet(cb: (index: number, set: CardSet) => void): void {
    this.listeners.push(cb);
    for (const [index, p] of this.sets) p.then((s) => cb(index, s)).catch(() => {});
  }

  dispose(): void {
    this.ktx2.dispose();
  }
}
