import dagre from '@dagrejs/dagre';
import type { Analysis } from './engine';
import type { Board, FrameItem, ID, Item } from './types';
import { isTask } from './types';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const rectOf = (i: Item): Rect => ({ x: i.x, y: i.y, w: i.w, h: i.h });

export const overlaps = (a: Rect, b: Rect, pad = 12) =>
  a.x < b.x + b.w + pad && a.x + a.w + pad > b.x && a.y < b.y + b.h + pad && a.y + a.h + pad > b.y;

export const contains = (outer: Rect, x: number, y: number) =>
  x >= outer.x && x <= outer.x + outer.w && y >= outer.y && y <= outer.y + outer.h;

export const snap = (v: number, g = 8) => Math.round(v / g) * g;

/** Moves `r` down (then right) until it doesn't overlap any non-frame item. */
export function findFreeSpot(board: Board, r: Rect, ignore: Set<ID> = new Set()): { x: number; y: number } {
  const obstacles = Object.values(board.items)
    .filter((i) => i.kind !== 'frame' && !ignore.has(i.id))
    .map(rectOf);
  const cand = { ...r };
  for (let i = 0; i < 80; i++) {
    const hit = obstacles.find((o) => overlaps(cand, o));
    if (!hit) return { x: snap(cand.x), y: snap(cand.y) };
    cand.y = hit.y + hit.h + 16;
  }
  return { x: snap(cand.x), y: snap(cand.y) };
}

/** The smallest frame whose bounds contain the item's center (frames can nest). */
export function frameAt(board: Board, item: Item): ID | null {
  const cx = item.x + item.w / 2;
  const cy = item.y + Math.min(item.h / 2, 30);
  let best: FrameItem | null = null;
  for (const f of Object.values(board.items)) {
    if (f.kind !== 'frame' || f.id === item.id) continue;
    if (item.kind === 'frame') {
      // a frame is inside another only if fully contained
      if (!(item.x >= f.x && item.y >= f.y && item.x + item.w <= f.x + f.w && item.y + item.h <= f.y + f.h)) continue;
      if (f.w * f.h <= item.w * item.h) continue;
    } else if (!contains(rectOf(f), cx, cy)) continue;
    if (!best || f.w * f.h < best.w * best.h) best = f;
  }
  return best?.id ?? null;
}

/** All items that (transitively) belong to a frame. */
export function frameMembers(board: Board, frameId: ID): ID[] {
  const out: ID[] = [];
  const stack = [frameId];
  const seen = new Set<ID>();
  while (stack.length) {
    const f = stack.pop()!;
    for (const it of Object.values(board.items)) {
      if (it.frameId === f && !seen.has(it.id)) {
        seen.add(it.id);
        out.push(it.id);
        if (it.kind === 'frame') stack.push(it.id);
      }
    }
  }
  return out;
}

export function boundsOf(items: Item[]): Rect | null {
  if (!items.length) return null;
  let x1 = Infinity,
    y1 = Infinity,
    x2 = -Infinity,
    y2 = -Infinity;
  for (const i of items) {
    x1 = Math.min(x1, i.x);
    y1 = Math.min(y1, i.y);
    x2 = Math.max(x2, i.x + i.w);
    y2 = Math.max(y2, i.y + i.h);
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/* ------------------------------------------------------------------ */
/* Auto layout                                                          */
/* ------------------------------------------------------------------ */

export type LayoutMode = 'tree' | 'flow';

/**
 * Lays out tasks (all, or only `ids`), group by group (each frame and the
 * unframed area are laid out separately, anchored where they currently are).
 *  - tree: each top-level task becomes an indented stack of its subtasks (mirrors the
 *          outline); top-level stacks are placed in columns by dependency level.
 *  - flow: dagre left-to-right using both dependencies and decomposition.
 * Notes attached to a task follow it.
 */
export function computeLayout(
  board: Board,
  a: Analysis,
  mode: LayoutMode,
  ids: ID[] | null,
): Record<ID, { x: number; y: number }> {
  const scope = new Set<ID>(
    (ids ?? Object.keys(board.items)).filter((id) => isTask(board.items[id])),
  );
  const out: Record<ID, { x: number; y: number }> = {};
  const groups = new Map<string, ID[]>();
  for (const id of scope) {
    const key = board.items[id].frameId ?? '__none__';
    const g = groups.get(key);
    if (g) g.push(id);
    else groups.set(key, [id]);
  }

  for (const [key, members] of groups) {
    const frame = key !== '__none__' ? board.items[key] : null;
    const anchorItems = members.map((id) => board.items[id]);
    const b = boundsOf(anchorItems)!;
    const ax = frame ? Math.max(b.x, frame.x + 32) : b.x;
    const ay = frame ? Math.max(b.y, frame.y + 64) : b.y;
    const set = new Set(members);
    const pos = mode === 'tree' ? treeLayout(board, a, set) : flowLayout(board, a, set);
    for (const [id, p] of Object.entries(pos)) out[id] = { x: Math.round(ax + p.x), y: Math.round(ay + p.y) };
  }

  // notes follow their task
  for (const l of Object.values(board.links)) {
    if (l.type !== 'annotates') continue;
    const note = board.items[l.source];
    const task = board.items[l.target];
    if (!note || !task || !out[task.id] || out[note.id]) continue;
    const dx = out[task.id].x - task.x;
    const dy = out[task.id].y - task.y;
    out[note.id] = { x: note.x + dx, y: note.y + dy };
  }
  return out;
}

const GAP_Y = 18;
const INDENT = 44;
const COL_GAP = 90;

function treeLayout(board: Board, a: Analysis, set: Set<ID>): Record<ID, { x: number; y: number }> {
  const pos: Record<ID, { x: number; y: number }> = {};
  const h = (id: ID) => Math.max(board.items[id].h, 56);
  const w = (id: ID) => board.items[id].w;
  const roots = [...set].filter((id) => {
    const p = a.tasks.get(id)?.parentId;
    return !p || !set.has(p);
  });

  // measure a subtree laid out as an indented stack
  function place(id: ID, x: number, y: number, dry: boolean): { w: number; h: number } {
    if (!dry) pos[id] = { x, y };
    let cy = y + h(id) + GAP_Y;
    let maxW = w(id);
    const info = a.tasks.get(id)!;
    const t = board.items[id];
    const kids = isTask(t) && t.collapsed ? [] : info.childIds.filter((c) => set.has(c));
    for (const c of kids) {
      const s = place(c, x + INDENT, cy, dry);
      cy += s.h + GAP_Y;
      maxW = Math.max(maxW, INDENT + s.w);
    }
    return { w: maxW, h: cy - y - GAP_Y };
  }

  // dependency level of each root (a root depends on another root if anything in its subtree does)
  const rootOf = new Map<ID, ID>();
  for (const r of roots) {
    rootOf.set(r, r);
    for (const d of descendantsIn(a, r, set)) rootOf.set(d, r);
  }
  const level = new Map<ID, number>();
  const rootDeps = new Map<ID, Set<ID>>();
  for (const r of roots) rootDeps.set(r, new Set());
  for (const [id, r] of rootOf) {
    const info = a.tasks.get(id)!;
    for (const p of [...info.prereqs, ...info.softPrereqs]) {
      const pr = rootOf.get(p);
      if (pr && pr !== r) rootDeps.get(r)!.add(pr);
    }
  }
  const lvl = (r: ID, guard = new Set<ID>()): number => {
    if (level.has(r)) return level.get(r)!;
    if (guard.has(r)) return 0;
    guard.add(r);
    let l = 0;
    for (const p of rootDeps.get(r)!) l = Math.max(l, lvl(p, guard) + 1);
    level.set(r, l);
    return l;
  };
  roots.forEach((r) => lvl(r));

  const cols = new Map<number, ID[]>();
  for (const r of roots) {
    const l = level.get(r)!;
    const c = cols.get(l);
    if (c) c.push(r);
    else cols.set(l, [r]);
  }
  const ordered = [...cols.keys()].sort((x, y) => x - y);
  let cx = 0;
  for (const l of ordered) {
    const rs = cols.get(l)!.sort((p, q) => (a.tasks.get(p)!.step ?? 1e9) - (a.tasks.get(q)!.step ?? 1e9) || board.items[p].y - board.items[q].y);
    let cy = 0;
    let colW = 0;
    for (const r of rs) {
      const s = place(r, cx, cy, false);
      cy += s.h + GAP_Y * 3;
      colW = Math.max(colW, s.w);
    }
    cx += colW + COL_GAP;
  }
  return pos;
}

function descendantsIn(a: Analysis, id: ID, set: Set<ID>): ID[] {
  const out: ID[] = [];
  const stack = [...(a.tasks.get(id)?.childIds ?? [])];
  while (stack.length) {
    const c = stack.pop()!;
    if (!set.has(c)) continue;
    out.push(c);
    stack.push(...(a.tasks.get(c)?.childIds ?? []));
  }
  return out;
}

function flowLayout(board: Board, a: Analysis, set: Set<ID>): Record<ID, { x: number; y: number }> {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'LR', nodesep: 28, ranksep: 90, marginx: 0, marginy: 0 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const id of set) {
    const it = board.items[id];
    g.setNode(id, { width: it.w, height: Math.max(it.h, 56) });
  }
  for (const l of Object.values(board.links)) {
    if (!set.has(l.source) || !set.has(l.target)) continue;
    if (l.type === 'depends' || l.type === 'soft') g.setEdge(l.source, l.target, { weight: 3, minlen: 1 });
    else if (l.type === 'subtask') g.setEdge(l.source, l.target, { weight: 1, minlen: 1 });
  }
  dagre.layout(g);
  const pos: Record<ID, { x: number; y: number }> = {};
  let minX = Infinity,
    minY = Infinity;
  for (const id of set) {
    const n = g.node(id);
    const it = board.items[id];
    const x = n.x - it.w / 2;
    const y = n.y - Math.max(it.h, 56) / 2;
    pos[id] = { x, y };
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
  }
  for (const p of Object.values(pos)) {
    p.x -= minX;
    p.y -= minY;
  }
  void a;
  return pos;
}
