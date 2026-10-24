import React, { useId } from 'react';

interface SliderProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  label?: string;
  labelId?: string;
  showValue?: boolean;
  valueFormatter?: (v: number) => string;
  className?: string;
}

/**
 * Slider — Custom styled range slider.
 * White thumb with shadow, accent-colored filled track.
 */
export const Slider: React.FC<SliderProps> = ({
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  label,
  labelId,
  showValue = false,
  valueFormatter = (v) => `${v}`,
  className = '',
}) => {
  const generatedId = useId();
  const sliderId = labelId || `slider-${generatedId}`;
  const percent = ((value - min) / (max - min)) * 100;

  return (
    <div className={`slider-container ${className}`}>
      {label && <span id={labelId || `${sliderId}-label`} className="slider__label">{label}</span>}
      <input
        type="range"
        className="slider"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-labelledby={labelId || `${sliderId}-label`}
        style={{ '--slider-fill': `${percent}%` } as React.CSSProperties}
      />
      {showValue && (
        <span className="slider__value">{valueFormatter(value)}</span>
      )}
    </div>
  );
};
