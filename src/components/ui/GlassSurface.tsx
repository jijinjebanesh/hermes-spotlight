import React from 'react';

interface GlassSurfaceProps {
  children: React.ReactNode;
  className?: string;
  blur?: 'sm' | 'md' | 'lg';
  border?: boolean;
  padding?: 'none' | 'sm' | 'md' | 'lg';
  as?: React.ElementType;
  style?: React.CSSProperties;
}

/**
 * GlassSurface — Frosted glass container primitive.
 * Provides consistent backdrop-filter blur with configurable intensity.
 */
export const GlassSurface = React.forwardRef<HTMLDivElement, GlassSurfaceProps>(
  ({ children, className = '', blur = 'md', border = true, padding = 'md', as: Tag = 'div', style, ...rest }, ref) => {
    const classes = [
      'glass-surface',
      `glass-surface--blur-${blur}`,
      `glass-surface--pad-${padding}`,
      border && 'glass-surface--bordered',
      className,
    ].filter(Boolean).join(' ');

    return (
      <Tag ref={ref} className={classes} style={style} {...rest}>
        {children}
      </Tag>
    );
  }
);

GlassSurface.displayName = 'GlassSurface';
