import React, { useState, useRef, useEffect } from 'react';

interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
  variant?: 'ghost' | 'surface' | 'danger';
  active?: boolean;
  tooltip?: string;
  badge?: number;
}

/**
 * IconButton — Standardized icon button with hover, active, focus states.
 * Supports tooltip on hover (with delay), badge count, and variants.
 */
export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ icon, size = 'md', variant = 'ghost', active = false, tooltip, badge, className = '', ...rest }, ref) => {
    const [showTooltip, setShowTooltip] = useState(false);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const handleMouseEnter = () => {
      if (!tooltip) return;
      timerRef.current = setTimeout(() => setShowTooltip(true), 500);
    };

    const handleMouseLeave = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      setShowTooltip(false);
    };

    useEffect(() => {
      return () => { if (timerRef.current) clearTimeout(timerRef.current); };
    }, []);

    const classes = [
      'icon-btn',
      `icon-btn--${size}`,
      `icon-btn--${variant}`,
      active && 'icon-btn--active',
      className,
    ].filter(Boolean).join(' ');

    return (
      <button
        ref={ref}
        className={classes}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        {...rest}
      >
        {icon}
        {badge !== undefined && badge > 0 && (
          <span className="icon-btn__badge">{badge > 99 ? '99+' : badge}</span>
        )}
        {showTooltip && tooltip && (
          <span className="icon-btn__tooltip">{tooltip}</span>
        )}
      </button>
    );
  }
);

IconButton.displayName = 'IconButton';
