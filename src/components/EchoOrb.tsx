import React, { useRef, useEffect } from 'react';
import type { EchoState } from '../audio/EchoEngine';

interface EchoOrbProps {
  state: EchoState;
  amplitude: number;  // 0-1
  compact?: boolean;
  muted?: boolean;
}

/**
 * Echo Orb — Canvas-rendered audio-reactive visualization.
 *
 * Uses lerp-based interpolation for smooth 60fps state transitions
 * rather than CSS transitions. Supports all Echo states including
 * muted, with special interrupt flash animation.
 *
 * Respects prefers-reduced-motion by rendering a static circle
 * with color transitions only.
 */
export const EchoOrb: React.FC<EchoOrbProps> = ({ state, amplitude, compact = false, muted = false }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const phaseRef = useRef(0);
  const amplitudeRef = useRef(amplitude);
  const stateRef = useRef(state);
  const compactRef = useRef(compact);
  const mutedRef = useRef(muted);

  // Lerp state for smooth transitions
  const lerpRef = useRef({
    scale: 1,
    targetScale: 1,
    glowR: 0.655, // #A78BFA
    glowG: 0.545,
    glowB: 0.98,
    targetR: 0.655,
    targetG: 0.545,
    targetB: 0.98,
    ringAlpha: 0,
    targetRingAlpha: 0.12,
    glowIntensity: 0.15,
    targetGlowIntensity: 0.15,
    interruptFlash: 0,
  });

  // Reduced motion detection
  const reducedMotionRef = useRef(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    reducedMotionRef.current = mq.matches;
    const handler = (e: MediaQueryListEvent) => { reducedMotionRef.current = e.matches; };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // Keep refs in sync
  useEffect(() => { amplitudeRef.current = amplitude; }, [amplitude]);
  useEffect(() => { compactRef.current = compact; }, [compact]);
  useEffect(() => { mutedRef.current = muted; }, [muted]);

  // Update lerp targets when state changes
  useEffect(() => {
    stateRef.current = state;
    const lerp = lerpRef.current;

    // Color targets per state
    const colors: Record<string, [number, number, number]> = {
      initializing: [0.655, 0.545, 0.98],   // --echo-listening (dimmed)
      listening:    [0.655, 0.545, 0.98],   // --echo-listening #A78BFA
      processing:   [0.753, 0.518, 0.988],  // blend toward thinking
      thinking:     [0.753, 0.518, 0.988],  // --echo-thinking #C084FC
      speaking:     [0.506, 0.549, 0.973],  // --echo-speaking #818CF8
      interrupted:  [0.204, 0.827, 0.6],    // --echo-interrupted #34D399
      error:        [1.0, 0.271, 0.227],    // --accent-error #FF453A
    };

    const [r, g, b] = colors[state] || colors.listening;
    lerp.targetR = r;
    lerp.targetG = g;
    lerp.targetB = b;

    switch (state) {
      case 'initializing':
        lerp.targetScale = 0.35;
        lerp.targetRingAlpha = 0;
        lerp.targetGlowIntensity = 0.1;
        break;
      case 'listening':
        lerp.targetScale = 0.95;
        lerp.targetRingAlpha = 0.12;
        lerp.targetGlowIntensity = 0.15;
        break;
      case 'processing':
        lerp.targetScale = 0.95;
        lerp.targetRingAlpha = 0;
        lerp.targetGlowIntensity = 0.12;
        break;
      case 'thinking':
        lerp.targetScale = 1.0;
        lerp.targetRingAlpha = 0;
        lerp.targetGlowIntensity = 0.15;
        break;
      case 'speaking':
        lerp.targetScale = 1.0;
        lerp.targetRingAlpha = 0.18;
        lerp.targetGlowIntensity = 0.2;
        break;
      case 'interrupted':
        lerp.scale = 0.9;        // SNAP — no lerp for responsiveness
        lerp.interruptFlash = 1.0;
        lerp.targetRingAlpha = 0;
        lerp.targetGlowIntensity = 0.25;
        lerp.targetScale = 0.9;
        break;
      case 'error':
        lerp.targetScale = 0.7;
        lerp.targetRingAlpha = 0;
        lerp.targetGlowIntensity = 0.1;
        break;
    }
  }, [state]);

  // Muted overrides
  useEffect(() => {
    if (muted) {
      const lerp = lerpRef.current;
      lerp.targetScale = 0.8;
      lerp.targetRingAlpha = 0;
      lerp.targetGlowIntensity = 0.08;
      lerp.targetR = 0.39;
      lerp.targetG = 0.39;
      lerp.targetB = 0.43;
    }
  }, [muted]);

  // Sync pixel resolution when compact prop changes.
  // The CSS width: 220px / 120px drives the visual size with spring transition;
  // canvas.width must match for crisp rendering — updated with debounce
  // to settle at the transition endpoint.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Debounce: wait for CSS spring transition to settle (~550ms)
    const t = setTimeout(() => {
      if (!canvasRef.current) return;
      const targetSize = compact ? 160 : 280;
      canvasRef.current.width = targetSize;
      canvasRef.current.height = targetSize;
    }, 550);
    return () => clearTimeout(t);
  }, [compact]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    const draw = () => {
      const isComp = compactRef.current;
      const targetSize = isComp ? 160 : 280;
      
      // Only set pixel size on first mount; resize is handled by CSS transition + effect above
      if (canvas.width === 0) {
        canvas.width = targetSize;
        canvas.height = targetSize;
      }
      
      const W = canvas.width;
      const H = canvas.height;
      const cx = W / 2, cy = H / 2;
      const BASE_R = isComp ? 32 : 48;
      const lerp = lerpRef.current;

      ctx.clearRect(0, 0, W, H);
      phaseRef.current += reducedMotionRef.current ? 0 : 0.02;

      const phase = phaseRef.current;
      const amp = mutedRef.current ? 0 : amplitudeRef.current;
      const st = stateRef.current;

      // ── Lerp all properties ──
      const lRate = 0.06;
      const fRate = 0.1;
      lerp.scale += (lerp.targetScale - lerp.scale) * lRate;
      lerp.glowR += (lerp.targetR - lerp.glowR) * lRate;
      lerp.glowG += (lerp.targetG - lerp.glowG) * lRate;
      lerp.glowB += (lerp.targetB - lerp.glowB) * lRate;
      lerp.ringAlpha += (lerp.targetRingAlpha - lerp.ringAlpha) * fRate;
      lerp.glowIntensity += (lerp.targetGlowIntensity - lerp.glowIntensity) * lRate;
      lerp.interruptFlash *= 0.92; // Decay

      const cr = Math.round(lerp.glowR * 255);
      const cg = Math.round(lerp.glowG * 255);
      const cb = Math.round(lerp.glowB * 255);

      // State-specific scale modulation
      let scaleMod = 0;
      if (!reducedMotionRef.current) {
        if (st === 'initializing') {
          scaleMod = Math.sin(phase * 3) * 0.05;
        } else if (st === 'listening') {
          scaleMod = amp * 0.12 + Math.sin(phase * 2) * 0.015;
        } else if (st === 'thinking') {
          scaleMod = Math.sin(phase * 1.5) * 0.02;
        } else if (st === 'speaking') {
          scaleMod = amp * 0.18;
        } else if (mutedRef.current) {
          scaleMod = Math.sin(phase * 0.5) * 0.008;
        }
      }

      const finalScale = lerp.scale + scaleMod;
      const orbR = BASE_R * finalScale;

      // ── Rings ──
      if (lerp.ringAlpha > 0.005 && !reducedMotionRef.current) {
        const ringCount = 3;
        for (let i = 0; i < ringCount; i++) {
          const delay = (i / ringCount) * Math.PI * 2;
          let expansion: number;
          if (st === 'listening') {
            expansion = amp * 40 + Math.sin(phase + delay) * 8;
          } else if (st === 'speaking') {
            expansion = amp * 60 + Math.sin(phase * 1.5 + delay) * 12;
          } else {
            expansion = Math.sin(phase + delay) * 4;
          }
          const ringR = BASE_R + 22 + i * 22 + expansion;
          const alpha = Math.max(0, lerp.ringAlpha - i * 0.03);

          ctx.beginPath();
          ctx.arc(cx, cy, Math.max(1, ringR), 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(${cr}, ${cg}, ${cb}, ${alpha})`;
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      }

      // ── Thinking shimmer ──
      if (st === 'thinking' && !reducedMotionRef.current) {
        if ((ctx as any).createConicGradient) {
          const gradient = (ctx as any).createConicGradient(phase, cx, cy);
          gradient.addColorStop(0,   `rgba(${cr},${cg},${cb},0.3)`);
          gradient.addColorStop(0.25, `rgba(${cr},${cg},${cb},0.05)`);
          gradient.addColorStop(0.5, `rgba(${cr},${cg},${cb},0.3)`);
          gradient.addColorStop(0.75, `rgba(${cr},${cg},${cb},0.05)`);
          gradient.addColorStop(1,   `rgba(${cr},${cg},${cb},0.3)`);
          ctx.beginPath();
          ctx.arc(cx, cy, orbR + 8, 0, Math.PI * 2);
          ctx.lineWidth = 3;
          ctx.strokeStyle = gradient;
          ctx.stroke();
        } else {
          const alpha = 0.15 + Math.sin(phase * 2) * 0.08;
          ctx.beginPath();
          ctx.arc(cx, cy, orbR + 6, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(${cr},${cg},${cb},${alpha})`;
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }

      // ── Interrupt ripple ──
      if (lerp.interruptFlash > 0.01) {
        const rippleR = orbR + (1 - lerp.interruptFlash) * 80;
        ctx.beginPath();
        ctx.arc(cx, cy, Math.max(1, rippleR), 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(52, 211, 153, ${lerp.interruptFlash * 0.8})`;
        ctx.lineWidth = 2.5;
        ctx.stroke();

        // Second ripple (delayed)
        if (lerp.interruptFlash < 0.7) {
          const ripple2R = orbR + (1 - lerp.interruptFlash * 1.4) * 60;
          ctx.beginPath();
          ctx.arc(cx, cy, Math.max(1, ripple2R), 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(52, 211, 153, ${lerp.interruptFlash * 0.4})`;
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      }

      // ── Outer glow ──
      const glowRadius = orbR * 2.5;
      const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowRadius);
      const glowAlpha = lerp.glowIntensity + amp * 0.1;
      glow.addColorStop(0,   `rgba(${cr}, ${cg}, ${cb}, ${glowAlpha})`);
      glow.addColorStop(0.4, `rgba(${cr}, ${cg}, ${cb}, ${glowAlpha * 0.3})`);
      glow.addColorStop(1,   `rgba(${cr}, ${cg}, ${cb}, 0)`);
      ctx.beginPath();
      ctx.arc(cx, cy, glowRadius, 0, Math.PI * 2);
      ctx.fillStyle = glow;
      ctx.fill();

      // ── Core orb ──
      const hlX = cx - orbR * 0.2;
      const hlY = cy - orbR * 0.25;
      const core = ctx.createRadialGradient(hlX, hlY, 0, cx, cy, orbR);

      // Mix interrupt flash into core color
      const flashR = lerp.interruptFlash * 52  + (1 - lerp.interruptFlash) * cr;
      const flashG = lerp.interruptFlash * 211 + (1 - lerp.interruptFlash) * cg;
      const flashB = lerp.interruptFlash * 153 + (1 - lerp.interruptFlash) * cb;

      core.addColorStop(0,   'rgba(255, 255, 255, 1)');
      core.addColorStop(0.3, 'rgba(240, 240, 255, 0.95)');
      core.addColorStop(0.7, `rgba(${Math.round(flashR)}, ${Math.round(flashG)}, ${Math.round(flashB)}, 0.8)`);
      core.addColorStop(1,   `rgba(${Math.round(flashR * 0.7)}, ${Math.round(flashG * 0.7)}, ${Math.round(flashB * 0.7)}, 0.6)`);

      ctx.beginPath();
      ctx.arc(cx, cy, orbR, 0, Math.PI * 2);
      ctx.fillStyle = core;
      ctx.fill();

      // ── Top specular highlight ──
      const specular = ctx.createRadialGradient(cx, cy - orbR * 0.35, 0, cx, cy - orbR * 0.15, orbR * 0.6);
      specular.addColorStop(0, 'rgba(255, 255, 255, 0.35)');
      specular.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.beginPath();
      ctx.arc(cx, cy, orbR, 0, Math.PI * 2);
      ctx.fillStyle = specular;
      ctx.fill();

      animRef.current = requestAnimationFrame(draw);
    };

    animRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animRef.current);
  }, []); // Empty deps - uses refs for current values

  return (
    <canvas
      ref={canvasRef}
      className="echo-orb-canvas"
      aria-hidden="true"
    />
  );
};
