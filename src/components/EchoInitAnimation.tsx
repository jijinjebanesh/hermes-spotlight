import React, { useRef, useEffect } from 'react';

export const EchoInitAnimation: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = canvas.width = 280;
    const H = canvas.height = 280;
    const cx = W / 2, cy = H / 2;

    const particles = Array.from({ length: 12 }, () => ({
      angle: Math.random() * Math.PI * 2,
      dist: 80 + Math.random() * 60,
      size: 2 + Math.random() * 2,
      speed: 0.8 + Math.random() * 0.4,
    }));

    let t = 0;
    let animFrame = 0;
    const easeIn = (x: number) => x * x * x;

    const drawInit = () => {
      ctx.clearRect(0, 0, W, H);
      particles.forEach(p => {
        const progress = Math.min(t * p.speed, 1);
        const dist = p.dist * (1 - easeIn(progress));
        const x = cx + Math.cos(p.angle) * dist;
        const y = cy + Math.sin(p.angle) * dist;
        const alpha = 1 - easeIn(progress) * 0.3;
        ctx.beginPath();
        ctx.arc(x, y, Math.max(0, p.size * (1 - progress * 0.5)), 0, Math.PI * 2);
        ctx.fillStyle = `rgba(167, 139, 250, ${Math.max(0, alpha)})`;
        ctx.fill();
      });
      t += 0.025;
      if (t < 1) {
        animFrame = requestAnimationFrame(drawInit);
      }
    };

    animFrame = requestAnimationFrame(drawInit);

    // Auto-unmount after 800ms
    const unmountTimer = setTimeout(() => {}, 800);

    return () => {
      cancelAnimationFrame(animFrame);
      clearTimeout(unmountTimer);
    };
  }, []);

  return (
    <div className="echo-init-overlay">
      <canvas ref={canvasRef} width={280} height={280} />
    </div>
  );
};
