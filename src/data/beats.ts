/**
 * The seven beats, as one source for the markup and the choreography.
 *
 * Poses and ranges are handoff spec section 08. Progress is measured against
 * these seven sections rather than raw document height, so beat k occupies the
 * k-th seventh of p at every width. Label copy is spec section 05, card and
 * panel copy is section 09.
 */

export interface Beat {
  /** Section id suffix and rail target. */
  n: number;
  /** HUD name. */
  name: string;
  /** Rail and eyebrow label. */
  screen: string;
  /** Slab centre offset from viewport centre, in CSS pixels. */
  x: number;
  ry: number;
  rx: number;
  rz: number;
  s: number;
  /** Index into FACES. */
  face: number;
}

export const BEATS: Beat[] = [
  { n: 1, name: 'HERO', screen: '01 Hero', x: 318, ry: -16, rx: 6, rz: -2, s: 1.0, face: 0 },
  { n: 2, name: 'REVEAL', screen: '02 Reveal', x: -318, ry: 0, rx: 2, rz: 0, s: 1.06, face: 0 },
  { n: 3, name: 'KOMIKFIND', screen: '03 komikfind', x: 318, ry: -15, rx: 5, rz: -3, s: 1.0, face: 1 },
  { n: 4, name: 'KALAKAL', screen: '04 kalakal', x: -318, ry: 15, rx: 5, rz: 3, s: 1.0, face: 2 },
  { n: 5, name: 'RAIDYARD', screen: '05 Raidyard', x: 318, ry: -15, rx: 5, rz: -3, s: 1.0, face: 3 },
  { n: 6, name: 'DOTAWEAKNESS', screen: '06 dotaweakness', x: -318, ry: 15, rx: 5, rz: 3, s: 1.0, face: 4 },
  { n: 7, name: 'COLLECTION', screen: '07 Collection', x: 0, ry: 0, rx: 0, rz: 0, s: 0.92, face: 4 },
];

export interface Face {
  slug: string;
  /** Holo pattern per the PICKS.md assignments. */
  holo: 'starburst' | 'halftone' | 'hex' | 'prismatic';
  /** Alt text for the static face image. */
  alt: string;
  /** Label zone 1: name, subject, cert line. */
  label: [string, string, string];
}

export const FACES: Face[] = [
  {
    slug: 'hero',
    holo: 'starburst',
    alt: 'Card face, JOSHUA',
    label: ['JOSHUA', 'DATA SCIENTIST / AI SYSTEMS ENGINEER', 'CERT 2026 0001 · FIRST EDITION'],
  },
  {
    slug: 'komikfind',
    holo: 'halftone',
    alt: 'Card face, KOMIKFIND',
    label: ['KOMIKFIND', 'SEMANTIC MANGA SEARCH', 'CERT 2026 0002 · FIRST EDITION'],
  },
  {
    slug: 'kalakal',
    holo: 'hex',
    alt: 'Card face, KALAKAL',
    label: ['KALAKAL', 'AUTONOMOUS SOLANA TRADING AGENT', 'CERT 2026 0003 · FIRST EDITION'],
  },
  {
    slug: 'raidyard',
    holo: 'prismatic',
    alt: 'Card face, RAIDYARD',
    label: ['RAIDYARD', 'ASYNC BASE RAID INSIDE REDDIT', 'CERT 2026 0004 · FIRST EDITION'],
  },
  {
    slug: 'dotaweakness',
    holo: 'prismatic',
    alt: 'Card face, DOTAWEAKNESS',
    label: ['DOTAWEAKNESS', 'DOTA 2 SELF ANALYSIS', 'CERT 2026 0005 · FIRST EDITION'],
  },
];

/** The beat that first needs each lazy face. Face 0 is on the critical path. */
export const FACE_NEEDED_AT: number[] = [1, 3, 4, 5, 6];

/** Transition half window in u, handoff spec section 08. */
export const TR = 0.16;
