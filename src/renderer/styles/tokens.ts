/**
 * Design System Tokens — TypeScript constants
 * 
 * CSS custom properties handle visual styling.
 * These constants are for values needed in JS logic
 * (animation durations, breakpoints, etc.)
 * 
 * v5.0 — Aligned with first-principles redesign
 */

// ── Motion ──
export const DURATION = {
  instant: 80,
  micro: 150,
  normal: 250,
  slow: 400,
  reveal: 600,
  // Legacy aliases
  fast: 150,
  entrance: 600,
} as const;

export const EASING = {
  spring: [0.16, 1, 0.3, 1] as const,
  bouncy: [0.34, 1.56, 0.64, 1] as const,
  out: [0.33, 1, 0.68, 1] as const,
  in: [0.55, 0, 1, 0.45] as const,
  inOut: [0.4, 0, 0.2, 1] as const,
  // Legacy alias
  outExpo: [0.16, 1, 0.3, 1] as const,
};

// Framer Motion spring presets
export const SPRING = {
  smooth: { type: 'spring' as const, stiffness: 200, damping: 25, mass: 1 },
  gentle: { type: 'spring' as const, stiffness: 120, damping: 14, mass: 0.8 },
  snappy: { type: 'spring' as const, stiffness: 300, damping: 20, mass: 0.5 },
  bouncy: { type: 'spring' as const, stiffness: 400, damping: 10, mass: 0.5 },
};

// ── Breakpoints ──
export const BREAKPOINT = {
  compact: 600,  // below this = compact/small mode
  narrow: 400,   // very narrow window
} as const;

// ── Z-Index Layers ──
export const Z_INDEX = {
  base: 0,
  content: 1,
  interactive: 2,
  floating: 100,
  notification: 200,
  modal: 300,
  echo: 9999,
  toast: 10000,
  // Legacy aliases
  elevated: 10,
  popover: 50,
  overlay: 200,
} as const;

// ── Echo Mode ──
export const ECHO = {
  orbSize: 280,
  orbSizeCompact: 160,
  silenceThresholdMs: 1500,
  wordRevealIntervalMs: 140,
  latencyWarning5s: 5000,
  latencyWarning15s: 15000,
  interruptTransitionMs: 600,
} as const;

// ── Color Palette (for JS-side usage only — canvas rendering etc.) ──
export const ECHO_COLORS = {
  listening:   { r: 167, g: 139, b: 250 },
  speaking:    { r: 129, g: 140, b: 248 },
  thinking:    { r: 192, g: 132, b: 252 },
  interrupted: { r: 52,  g: 211, b: 153 },
  muted:       { r: 100, g: 100, b: 110 },
  error:       { r: 248, g: 113, b: 113 },
} as const;

// ── Stagger Delays ──
export const STAGGER = {
  fast: 0.03,
  normal: 0.05,
  slow: 0.08,
} as const;

// ── Surface States ──
export const SURFACE_HEIGHT = {
  query: 280,
  conversation: 480,
  workspace: 800,
  ambient: 120,
  contextual: 160,
} as const;

export type SurfaceState = keyof typeof SURFACE_HEIGHT;
