/**
 * Chikny — the Wingman mascot.
 *
 * Source art is a 1536x1872 spritesheet: an 8x9 grid of 192x208 frames, where
 * each row is one animation state. Rows are ragged (not every row uses all 8
 * columns), so `frames` below is the real count and anything that animates must
 * respect it — running a 6-frame row as 8 shows two blank cells.
 *
 * This module is the single source of truth: the CSS served to the browser is
 * generated from POSES, so a pose can never drift out of sync with its stylesheet.
 */

export const SHEET = {
  url: '/brand/chikny.webp',
  width: 1536,
  height: 1872,
  frameW: 192,
  frameH: 208,
  cols: 8,
  rows: 9,
} as const;

export interface Pose {
  row: number;
  /** Populated columns in this row. */
  frames: number;
  /** Seconds for one full cycle. Omit for a still pose. */
  duration?: number;
  /** Pin to a single column instead of animating the row. */
  still?: number;
  meaning: string;
}

/**
 * Named for what Wingman is *doing*, not for what the chick is doing — so call
 * sites read as state ("negotiating") rather than as art direction ("row 8").
 */
export const POSES = {
  /** Arms crossed, smug, faintly conspiratorial. The logo. */
  logo: { row: 8, frames: 6, still: 2, meaning: 'the mark' },
  idle: { row: 0, frames: 6, duration: 2.4, meaning: 'waiting on you' },
  greeting: { row: 3, frames: 4, duration: 1.0, meaning: 'start of a conversation' },
  learning: { row: 7, frames: 6, duration: 1.2, meaning: 'building your profile' },
  negotiating: { row: 1, frames: 8, duration: 0.8, meaning: 'talking to another wingman' },
  thinking: { row: 8, frames: 6, still: 1, meaning: 'weighing a disclosure' },
  matched: { row: 8, frames: 6, still: 4, meaning: 'both sides said yes' },
  passed: { row: 5, frames: 8, duration: 1.6, meaning: 'wingman turned them down for you' },
  resting: { row: 6, frames: 6, duration: 2.0, meaning: 'nothing to do' },
} as const satisfies Record<string, Pose>;

export type PoseName = keyof typeof POSES;

/** Sampled from the sprite itself, so UI chrome matches the art exactly. */
export const PALETTE = {
  yolk: '#fdcf2e',
  yolkDeep: '#f0a81e',
  beak: '#ff7709',
  brow: '#882b00',
  plum: '#48074f',
  plumSoft: '#873f94',
  blush: '#d585dd',
} as const;

/** Generates the stylesheet for every pose. Served at /brand/wingman.css. */
export function spriteCss(): string {
  const { url, width, height, frameW, frameH } = SHEET;

  const blocks = Object.entries(POSES).map(([name, pose]) => {
    const p = pose as Pose;
    if (p.still !== undefined) {
      return `.chikny--${name} {
  background-position-x: calc(${-p.still} * var(--chikny-fw));
  background-position-y: calc(${-p.row} * var(--chikny-fh));
  animation: none;
}`;
    }
    return `.chikny--${name} {
  background-position-y: calc(${-p.row} * var(--chikny-fh));
  animation: chikny-${name} ${p.duration}s steps(${p.frames}) infinite;
}
@keyframes chikny-${name} {
  from { background-position-x: 0; }
  to   { background-position-x: calc(${-p.frames} * var(--chikny-fw)); }
}`;
  });

  return `/* generated from src/brand.ts — do not edit by hand */

/* --chikny-scale MUST keep the frame on whole pixels: ${frameW}x${frameH} times
   the scale has to come out integer. 0.5, 1, 1.5 and 2 are safe; 1.15 is not
   (208 * 1.15 = 239.2), and a fractional frame lets the neighbouring sprite
   bleed in along the seam. */
.chikny {
  --chikny-scale: 1;
  --chikny-fw: calc(${frameW}px * var(--chikny-scale));
  --chikny-fh: calc(${frameH}px * var(--chikny-scale));
  width: var(--chikny-fw);
  height: var(--chikny-fh);
  background-image: url('${url}');
  background-size: calc(${width}px * var(--chikny-scale)) calc(${height}px * var(--chikny-scale));
  background-repeat: no-repeat;
  image-rendering: pixelated;
  flex: none;
}

/* The art is pixel-art; motion should feel stepped, never smoothed. */
@media (prefers-reduced-motion: reduce) {
  .chikny { animation: none !important; }
}

${blocks.join('\n\n')}
`;
}
