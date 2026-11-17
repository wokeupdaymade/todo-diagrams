import { useCallback, useRef, useState, type ReactNode } from 'react';
import { useClickOutside } from './common';

/** Minimal dropdown: a trigger button and a floating panel. */
export function Popover({
  trigger,
  children,
  align = 'left',
  className,
  title,
  up,
}: {
  trigger: ReactNode;
  children: (close: () => void) => ReactNode;
  align?: 'left' | 'right' | 'center';
  className?: string;
  title?: string;
  up?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useClickOutside(ref, close, open);
  return (
    <div className={`popover-wrap ${className ?? ''}`} ref={ref}>
      <button className={`tb-btn ${open ? 'active' : ''}`} title={title} onClick={() => setOpen((o) => !o)}>
        {trigger}
      </button>
      {open && <div className={`popover align-${align} ${up ? 'up' : ''}`}>{children(close)}</div>}
    </div>
  );
}

export function MenuItem({
  icon,
  label,
  hint,
  onClick,
  active,
  danger,
  disabled,
}: {
  icon?: ReactNode;
  label: ReactNode;
  hint?: string;
  onClick: () => void;
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      className={`menu-item ${active ? 'active' : ''} ${danger ? 'danger' : ''}`}
      onClick={onClick}
      disabled={disabled}
    >
      <span className="menu-icon">{icon}</span>
      <span className="menu-label">{label}</span>
      {hint && <span className="menu-hint">{hint}</span>}
    </button>
  );
}

export const MenuSep = () => <div className="menu-sep" />;
export const MenuTitle = ({ children }: { children: ReactNode }) => <div className="menu-title">{children}</div>;
