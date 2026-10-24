import React, { useId } from 'react';

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  size?: 'sm' | 'md';
  label?: string;
  id?: string;
}

/**
 * Toggle — macOS-style toggle switch with animated knob.
 * md: 36×20px, sm: 28×16px. Accessible with proper labeling.
 */
export const Toggle: React.FC<ToggleProps> = ({
  checked,
  onChange,
  disabled = false,
  size = 'md',
  label,
  id: providedId,
}) => {
  const generatedId = useId();
  const id = providedId || generatedId;
  const classes = [
    'toggle',
    `toggle--${size}`,
    checked && 'toggle--checked',
    disabled && 'toggle--disabled',
  ].filter(Boolean).join(' ');

  return (
    <label className={classes} htmlFor={id}>
      <input
        id={id}
        type="checkbox"
        className="toggle__input"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        aria-label={label}
      />
      <span className="toggle__track">
        <span className="toggle__knob" />
      </span>
      {label && <span className="toggle__label">{label}</span>}
    </label>
  );
};
