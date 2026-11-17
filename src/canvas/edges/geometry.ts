import { getSmoothStepPath, Position } from '@xyflow/react';
import type { Routing, ShapeType } from '../../model/types';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  shape?: ShapeType | 'task' | 'pill';
}

export interface Pt {
  x: number;
  y: number;
}

const center = (b: Box): Pt => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });

/** Point where the ray from the box center toward `to` leaves the box outline. */
function boundaryPoint(b: Box, to: Pt): Pt {
  const c = center(b);
  const dx = to.x - c.x;
  const dy = to.y - c.y;
  if (dx === 0 && dy === 0) return c;
  const hw = b.w / 2;
  const hh = b.h / 2;
  let t: number;
  if (b.shape === 'ellipse') {
    t = 1 / Math.sqrt((dx * dx) / (hw * hw) + (dy * dy) / (hh * hh));
  } else if (b.shape === 'diamond') {
    t = 1 / (Math.abs(dx) / hw + Math.abs(dy) / hh);
  } else {
    t = Math.min(hw / Math.abs(dx || 1e-9), hh / Math.abs(dy || 1e-9));
  }
  return { x: c.x + dx * t, y: c.y + dy * t };
}

function sideOf(b: Box, p: Pt): Position {
  const c = center(b);
  const nx = (p.x - c.x) / (b.w / 2);
  const ny = (p.y - c.y) / (b.h / 2);
  if (Math.abs(nx) >= Math.abs(ny)) return nx > 0 ? Position.Right : Position.Left;
  return ny > 0 ? Position.Bottom : Position.Top;
}

const normal: Record<Position, Pt> = {
  [Position.Left]: { x: -1, y: 0 },
  [Position.Right]: { x: 1, y: 0 },
  [Position.Top]: { x: 0, y: -1 },
  [Position.Bottom]: { x: 0, y: 1 },
};

function sideMid(b: Box, side: Position): Pt {
  switch (side) {
    case Position.Left:
      return { x: b.x, y: b.y + b.h / 2 };
    case Position.Right:
      return { x: b.x + b.w, y: b.y + b.h / 2 };
    case Position.Top:
      return { x: b.x + b.w / 2, y: b.y };
    case Position.Bottom:
      return { x: b.x + b.w / 2, y: b.y + b.h };
  }
}

function dominantSides(a: Box, b: Box): [Position, Position] {
  const ca = center(a);
  const cb = center(b);
  const dx = cb.x - ca.x;
  const dy = cb.y - ca.y;
  // gap-aware: prefer horizontal if boxes don't overlap horizontally
  const hGap = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w));
  const vGap = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h));
  // Flow reads left → right: whenever there is horizontal clearance, connect side to side.
  if (hGap > 24) return dx > 0 ? [Position.Right, Position.Left] : [Position.Left, Position.Right];
  if (vGap > 0 || Math.abs(dy) > Math.abs(dx)) return dy > 0 ? [Position.Bottom, Position.Top] : [Position.Top, Position.Bottom];
  return dx > 0 ? [Position.Right, Position.Left] : [Position.Left, Position.Right];
}

export interface EdgeGeometry {
  d: string;
  labelX: number;
  labelY: number;
  /** endpoint & direction (unit vector pointing *into* the endpoint) */
  end: Pt;
  endDir: Pt;
  start: Pt;
  startDir: Pt;
}

const unit = (v: Pt): Pt => {
  const l = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / l, y: v.y / l };
};

/**
 * Computes a path between two boxes.
 * `inset` shortens each end (so arrowheads/markers sit exactly on the outline).
 */
export function edgePath(
  s: Box,
  t: Box,
  routing: Routing | 'tree',
  insetStart: number,
  insetEnd: number,
): EdgeGeometry {
  if (routing === 'tree') {
    // decomposition elbow: down from the parent's left part, then right into the child
    const sx = s.x + 18;
    const sy = s.y + s.h;
    const tx = t.x;
    const ty = t.y + Math.min(t.h / 2, 22);
    const r = Math.min(8, (ty - sy) / 2, (tx - sx) / 2);
    const ex = tx - insetEnd;
    const d = `M ${sx} ${sy + insetStart} L ${sx} ${ty - r} Q ${sx} ${ty} ${sx + r} ${ty} L ${ex} ${ty}`;
    return {
      d,
      labelX: sx,
      labelY: (sy + ty) / 2,
      end: { x: tx, y: ty },
      endDir: { x: 1, y: 0 },
      start: { x: sx, y: sy },
      startDir: { x: 0, y: -1 },
    };
  }

  if (routing === 'orthogonal') {
    const [ss, ts] = dominantSides(s, t);
    const sp = sideMid(s, ss);
    const tp = sideMid(t, ts);
    const sn = normal[ss];
    const tn = normal[ts];
    const [d, lx, ly] = getSmoothStepPath({
      sourceX: sp.x + sn.x * insetStart,
      sourceY: sp.y + sn.y * insetStart,
      targetX: tp.x + tn.x * insetEnd,
      targetY: tp.y + tn.y * insetEnd,
      sourcePosition: ss,
      targetPosition: ts,
      borderRadius: 10,
      offset: 18,
    });
    return {
      d,
      labelX: lx,
      labelY: ly,
      end: tp,
      endDir: { x: -tn.x, y: -tn.y },
      start: sp,
      startDir: { x: -sn.x, y: -sn.y },
    };
  }

  const cs = center(s);
  const ct = center(t);
  let sp = boundaryPoint(s, ct);
  let tp = boundaryPoint(t, cs);

  if (routing === 'straight') {
    const dir = unit({ x: tp.x - sp.x, y: tp.y - sp.y });
    const a = { x: sp.x + dir.x * insetStart, y: sp.y + dir.y * insetStart };
    const b = { x: tp.x - dir.x * insetEnd, y: tp.y - dir.y * insetEnd };
    return {
      d: `M ${a.x} ${a.y} L ${b.x} ${b.y}`,
      labelX: (sp.x + tp.x) / 2,
      labelY: (sp.y + tp.y) / 2,
      end: tp,
      endDir: dir,
      start: sp,
      startDir: { x: -dir.x, y: -dir.y },
    };
  }

  // curved: cubic bezier leaving perpendicular to the side it exits from
  const [ss, ts] = dominantSides(s, t);
  if (!s.shape || s.shape === 'task' || s.shape === 'pill' || s.shape === 'rect' || s.shape === 'rounded') sp = sideMid(s, ss);
  if (!t.shape || t.shape === 'task' || t.shape === 'pill' || t.shape === 'rect' || t.shape === 'rounded') tp = sideMid(t, ts);
  const sn = s.shape === 'ellipse' || s.shape === 'diamond' ? unit({ x: sp.x - cs.x, y: sp.y - cs.y }) : normal[sideOf(s, sp)];
  const tn = t.shape === 'ellipse' || t.shape === 'diamond' ? unit({ x: tp.x - ct.x, y: tp.y - ct.y }) : normal[sideOf(t, tp)];
  const dist = Math.hypot(tp.x - sp.x, tp.y - sp.y);
  const k = Math.max(Math.min(30, dist / 2), Math.min(160, dist * 0.45));
  const a = { x: sp.x + sn.x * insetStart, y: sp.y + sn.y * insetStart };
  const b = { x: tp.x + tn.x * insetEnd, y: tp.y + tn.y * insetEnd };
  const c1 = { x: a.x + sn.x * k, y: a.y + sn.y * k };
  const c2 = { x: b.x + tn.x * k, y: b.y + tn.y * k };
  const d = `M ${a.x} ${a.y} C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${b.x} ${b.y}`;
  // midpoint of the cubic
  const mx = 0.125 * a.x + 0.375 * c1.x + 0.375 * c2.x + 0.125 * b.x;
  const my = 0.125 * a.y + 0.375 * c1.y + 0.375 * c2.y + 0.125 * b.y;
  return {
    d,
    labelX: mx,
    labelY: my,
    end: tp,
    endDir: { x: -tn.x, y: -tn.y },
    start: sp,
    startDir: { x: -sn.x, y: -sn.y },
  };
}

export function canTreeRoute(parent: Box, child: Box): boolean {
  return child.x >= parent.x + 30 && child.y >= parent.y + parent.h + 6;
}

/** SVG path for a marker at point `p`, pointing along unit vector `dir` (into p). */
export function markerPath(kind: 'arrow' | 'open' | 'diamond' | 'circle', p: Pt, dir: Pt, size = 9): string {
  const ux = dir.x;
  const uy = dir.y;
  const px = -uy;
  const py = ux;
  const back = (n: number) => ({ x: p.x - ux * n, y: p.y - uy * n });
  if (kind === 'arrow' || kind === 'open') {
    const b = back(size);
    const w = size * 0.55;
    const l = { x: b.x + px * w, y: b.y + py * w };
    const r = { x: b.x - px * w, y: b.y - py * w };
    return kind === 'arrow'
      ? `M ${p.x} ${p.y} L ${l.x} ${l.y} L ${r.x} ${r.y} Z`
      : `M ${l.x} ${l.y} L ${p.x} ${p.y} L ${r.x} ${r.y}`;
  }
  if (kind === 'diamond') {
    const m = back(size / 2);
    const e = back(size);
    const w = size * 0.42;
    return `M ${p.x} ${p.y} L ${m.x + px * w} ${m.y + py * w} L ${e.x} ${e.y} L ${m.x - px * w} ${m.y - py * w} Z`;
  }
  const c = back(size / 2.6);
  const r = size / 2.6;
  return `M ${c.x - r} ${c.y} a ${r} ${r} 0 1 0 ${r * 2} 0 a ${r} ${r} 0 1 0 ${-r * 2} 0`;
}
