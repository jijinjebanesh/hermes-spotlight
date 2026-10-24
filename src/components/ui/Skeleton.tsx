import React from 'react';

interface SkeletonProps {
  width?: string | number;
  height?: string | number;
  variant?: 'text' | 'circular' | 'rectangular';
  className?: string;
}

/**
 * Skeleton — Content loading placeholder with shimmer animation.
 */
export const Skeleton: React.FC<SkeletonProps> = ({
  width,
  height,
  variant = 'text',
  className = '',
}) => {
  const classes = [
    'skeleton',
    `skeleton--${variant}`,
    className,
  ].filter(Boolean).join(' ');

  const style: React.CSSProperties = {};
  if (width) style.width = typeof width === 'number' ? `${width}px` : width;
  if (height) style.height = typeof height === 'number' ? `${height}px` : height;

  return <div className={classes} style={style} />;
};
