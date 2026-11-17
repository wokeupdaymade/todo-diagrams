import type { LinkType, ShapeType } from '../model/types';

/** Small glyphs that mirror how each link type is drawn on the canvas. */
export function LinkIcon({ type, size = 18 }: { type: LinkType; size?: number }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', className: `link-icon li-${type}` };
  switch (type) {
    case 'depends':
      return (
        <svg {...common}>
          <path d="M3 12h13" stroke="currentColor" strokeWidth="2.2" />
          <path d="M21 12l-6-4v8z" fill="currentColor" />
        </svg>
      );
    case 'soft':
      return (
        <svg {...common}>
          <path d="M3 12h15" stroke="currentColor" strokeWidth="2" strokeDasharray="3.5 3" />
          <path d="M15 7.5l5.5 4.5L15 16.5" stroke="currentColor" strokeWidth="2" />
        </svg>
      );
    case 'subtask':
      return (
        <svg {...common}>
          <path d="M6 4l2.5 3L6 10 3.5 7z" fill="currentColor" />
          <path d="M6 10v7.5q0 2 2 2h12" stroke="currentColor" strokeWidth="2" />
        </svg>
      );
    case 'relates':
      return (
        <svg {...common}>
          <path d="M3 12h18" stroke="currentColor" strokeWidth="2.2" strokeDasharray="0.1 4" strokeLinecap="round" />
        </svg>
      );
    case 'annotates':
      return (
        <svg {...common}>
          <path d="M3 12h13" stroke="currentColor" strokeWidth="1.6" strokeDasharray="3 2.5" />
          <circle cx="19" cy="12" r="2.6" fill="currentColor" />
        </svg>
      );
    case 'line':
      return (
        <svg {...common}>
          <path d="M3 19L20 5" stroke="currentColor" strokeWidth="2" />
        </svg>
      );
  }
}

export function ShapeIcon({ shape, size = 18 }: { shape: ShapeType; size?: number }) {
  const p = { stroke: 'currentColor', strokeWidth: 1.8, fill: 'none' };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      {shape === 'rect' && <rect x="3" y="6" width="18" height="12" {...p} />}
      {shape === 'rounded' && <rect x="3" y="6" width="18" height="12" rx="4" {...p} />}
      {shape === 'ellipse' && <ellipse cx="12" cy="12" rx="9" ry="6.5" {...p} />}
      {shape === 'diamond' && <path d="M12 3l9 9-9 9-9-9z" {...p} />}
      {shape === 'hexagon' && <path d="M7 5h10l4 7-4 7H7l-4-7z" {...p} />}
      {shape === 'parallelogram' && <path d="M7 6h14l-4 12H3z" {...p} />}
      {shape === 'cylinder' && (
        <>
          <ellipse cx="12" cy="6.5" rx="8" ry="2.8" {...p} />
          <path d="M4 6.5v11c0 1.6 3.6 2.8 8 2.8s8-1.2 8-2.8v-11" {...p} />
        </>
      )}
    </svg>
  );
}

export const SHAPES: { shape: ShapeType; label: string }[] = [
  { shape: 'rounded', label: 'Rounded box' },
  { shape: 'rect', label: 'Rectangle' },
  { shape: 'ellipse', label: 'Ellipse' },
  { shape: 'diamond', label: 'Decision' },
  { shape: 'hexagon', label: 'Hexagon' },
  { shape: 'parallelogram', label: 'Input / output' },
  { shape: 'cylinder', label: 'Database' },
];
