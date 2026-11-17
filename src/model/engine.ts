/**
 * The task engine: derives everything that is *not* stored.
 *
 * Inputs: a Board (items + links). Output: an Analysis with, per task:
 *  - hierarchy (parent, children, ancestors)
 *  - effective status (composite tasks roll up from children, gated milestones from prerequisites)
 *  - display state: ready / doing / blocked / done / dropped
 *  - blockers (own prerequisites + prerequisites inherited from ancestors)
 *  - progress, estimate rollups, impact (how much is waiting on it), urgency & needed-by date
 *  - warnings (overdue, due-date conflicts, started while blocked, dropped prerequisite)
 * and for the whole board: a suggested execution plan (topological order), "next actions",
 * the critical path and summary stats.
 *
 * Ordering model: every task t has a Start node S(t) and an End node E(t).
 *   S(t) → E(t)                 (a task starts before it ends)
 *   S(parent) → S(child)        (a subtask can't start before its parent may start)
 *   E(child) → E(parent)        (a parent is finished only when its parts are)
 *   E(prereq) → S(dependent)    (dependency: finish-to-start)
 * This single DAG gives us cycle detection, inherited blocking and plan ordering consistently.
 */
import type { Board, ID, Link, Priority, TaskItem, TaskStatus } from './types';
import { isTask } from './types';

export type TaskState = 'done' | 'dropped' | 'blocked' | 'doing' | 'ready';

export interface Blocker {
  /** The unfinished prerequisite. */
  id: ID;
  /** If inherited: the ancestor that has this prerequisite. */
  via: ID | null;
}

export type WarningKind = 'overdue' | 'due-conflict' | 'parent-due' | 'started-blocked' | 'dropped-prereq' | 'cycle';

export interface TaskWarning {
  kind: WarningKind;
  message: string;
  ref?: ID;
}

export interface TaskInfo {
  id: ID;
  parentId: ID | null;
  parentLinkId: ID | null;
  childIds: ID[];
  /** Nearest first. */
  ancestors: ID[];
  depth: number;
  composite: boolean;
  /** A milestone whose completion is derived from its prerequisites. */
  gated: boolean;
  /** Effective status after roll-ups. */
  status: TaskStatus;
  state: TaskState;
  resolved: boolean;
  prereqs: ID[];
  softPrereqs: ID[];
  dependents: ID[];
  softDependents: ID[];
  related: ID[];
  notes: ID[];
  blockers: Blocker[];
  softPending: ID[];
  progress: { done: number; total: number; ratio: number; unit: 'subtasks' | 'checklist' } | null;
  totalEstimate: number;
  remainingEstimate: number;
  /** Number of open tasks transitively waiting on this one. */
  impact: number;
  /** Highest priority among itself, its ancestors and everything waiting on it. */
  urgency: Priority;
  /** Earliest due date among itself, its ancestors and everything waiting on it. */
  neededBy: string | null;
  neededByFor: ID | null;
  overdue: boolean;
  warnings: TaskWarning[];
  /** 1-based position in the suggested plan (open leaf tasks only). */
  step: number | null;
  critical: boolean;
}

export interface BoardStats {
  total: number;
  open: number;
  done: number;
  doing: number;
  ready: number;
  blocked: number;
  dropped: number;
  overdue: number;
  remainingHours: number;
}

export interface Analysis {
  tasks: Map<ID, TaskInfo>;
  roots: ID[];
  plan: ID[];
  next: ID[];
  criticalLinks: Set<ID>;
  cycle: Set<ID>;
  stats: BoardStats;
}

export function todayISO(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const isResolvedStatus = (s: TaskStatus) => s === 'done' || s === 'dropped';

/* ------------------------------------------------------------------ */
/* Link indexing                                                        */
/* ------------------------------------------------------------------ */

export interface LinkIndex {
  parentOf: Map<ID, { parent: ID; linkId: ID }>;
  children: Map<ID, ID[]>;
  prereqs: Map<ID, ID[]>;
  softPrereqs: Map<ID, ID[]>;
  dependents: Map<ID, ID[]>;
  softDependents: Map<ID, ID[]>;
  related: Map<ID, ID[]>;
  notes: Map<ID, ID[]>;
  /** depends / soft link ids keyed by `${source}>${target}` */
  depLinkByPair: Map<string, ID>;
}

const push = (m: Map<ID, ID[]>, k: ID, v: ID) => {
  const a = m.get(k);
  if (a) {
    if (!a.includes(v)) a.push(v);
  } else m.set(k, [v]);
};

export function indexLinks(board: Board): LinkIndex {
  const idx: LinkIndex = {
    parentOf: new Map(),
    children: new Map(),
    prereqs: new Map(),
    softPrereqs: new Map(),
    dependents: new Map(),
    softDependents: new Map(),
    related: new Map(),
    notes: new Map(),
    depLinkByPair: new Map(),
  };
  const links = Object.values(board.links).sort((a, b) => a.createdAt - b.createdAt);
  for (const l of links) {
    const s = board.items[l.source];
    const t = board.items[l.target];
    if (!s || !t || l.source === l.target) continue;
    switch (l.type) {
      case 'subtask':
        if (isTask(s) && isTask(t) && !idx.parentOf.has(t.id)) {
          idx.parentOf.set(t.id, { parent: s.id, linkId: l.id });
          push(idx.children, s.id, t.id);
        }
        break;
      case 'depends':
        if (isTask(s) && isTask(t)) {
          push(idx.prereqs, t.id, s.id);
          push(idx.dependents, s.id, t.id);
          idx.depLinkByPair.set(`${s.id}>${t.id}`, l.id);
        }
        break;
      case 'soft':
        if (isTask(s) && isTask(t)) {
          push(idx.softPrereqs, t.id, s.id);
          push(idx.softDependents, s.id, t.id);
          idx.depLinkByPair.set(`${s.id}>${t.id}`, l.id);
        }
        break;
      case 'relates':
        if (s.kind === 'task' || s.kind === 'note') push(idx.related, s.id, t.id);
        if (t.kind === 'task' || t.kind === 'note') push(idx.related, t.id, s.id);
        break;
      case 'annotates': {
        const note = s.kind === 'note' ? s : t.kind === 'note' ? t : null;
        const task = isTask(t) ? t : isTask(s) ? s : null;
        if (note && task) push(idx.notes, task.id, note.id);
        break;
      }
    }
  }
  // Sort children by order
  for (const [pid, kids] of idx.children) {
    kids.sort((a, b) => {
      const ta = board.items[a] as TaskItem;
      const tb = board.items[b] as TaskItem;
      return ta.order - tb.order || ta.createdAt - tb.createdAt;
    });
    idx.children.set(pid, kids);
  }
  return idx;
}

/* ------------------------------------------------------------------ */
/* Ordering graph (S/E nodes)                                           */
/* ------------------------------------------------------------------ */

export type OrderGraph = Map<string, { to: string; linkId?: ID }[]>;

const S = (id: ID) => `S:${id}`;
const E = (id: ID) => `E:${id}`;

function addEdge(g: OrderGraph, from: string, to: string, linkId?: ID) {
  const a = g.get(from);
  if (a) a.push({ to, linkId });
  else g.set(from, [{ to, linkId }]);
  if (!g.has(to)) g.set(to, []);
}

/**
 * Builds the S/E ordering graph from the board's semantic links.
 * `extra` lets callers test a hypothetical link; `exclude` hides links (e.g. one being replaced).
 */
export function buildOrderGraph(board: Board, exclude?: Set<ID>, extra: Link[] = []): OrderGraph {
  const g: OrderGraph = new Map();
  for (const it of Object.values(board.items)) {
    if (isTask(it)) addEdge(g, S(it.id), E(it.id));
  }
  const hasParent = new Set<ID>();
  const links = [...Object.values(board.links).sort((a, b) => a.createdAt - b.createdAt), ...extra];
  for (const l of links) {
    if (exclude?.has(l.id)) continue;
    const s = board.items[l.source];
    const t = board.items[l.target];
    if (!isTask(s) || !isTask(t) || s.id === t.id) continue;
    if (l.type === 'subtask') {
      if (hasParent.has(t.id)) continue;
      hasParent.add(t.id);
      addEdge(g, S(s.id), S(t.id));
      addEdge(g, E(t.id), E(s.id));
    } else if (l.type === 'depends' || l.type === 'soft') {
      addEdge(g, E(s.id), S(t.id), l.id);
    }
  }
  return g;
}

/** Returns the set of graph nodes that participate in (or are stuck behind) a cycle; empty if acyclic. */
export function findCycleNodes(g: OrderGraph): Set<string> {
  const indeg = new Map<string, number>();
  for (const k of g.keys()) indeg.set(k, indeg.get(k) ?? 0);
  for (const edges of g.values()) for (const e of edges) indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
  const q: string[] = [];
  for (const [k, d] of indeg) if (d === 0) q.push(k);
  let seen = 0;
  while (q.length) {
    const n = q.pop()!;
    seen++;
    for (const e of g.get(n) ?? []) {
      const d = indeg.get(e.to)! - 1;
      indeg.set(e.to, d);
      if (d === 0) q.push(e.to);
    }
  }
  const left = new Set<string>();
  if (seen === indeg.size) return left;
  for (const [k, d] of indeg) if (d > 0) left.add(k);
  return left;
}

/* ------------------------------------------------------------------ */
/* Analysis                                                              */
/* ------------------------------------------------------------------ */

export function analyze(board: Board, today: string = todayISO()): Analysis {
  const idx = indexLinks(board);
  const tasks = Object.values(board.items).filter(isTask);
  const byId = new Map<ID, TaskItem>(tasks.map((t) => [t.id, t]));
  const get = (id: ID) => byId.get(id)!;
  const kids = (id: ID) => idx.children.get(id) ?? [];
  const prereqs = (id: ID) => idx.prereqs.get(id) ?? [];
  const dependents = (id: ID) => idx.dependents.get(id) ?? [];

  // Ancestors (guard against corrupted parent cycles)
  const ancestorsOf = new Map<ID, ID[]>();
  for (const t of tasks) {
    const anc: ID[] = [];
    let cur = idx.parentOf.get(t.id)?.parent;
    const guard = new Set<ID>([t.id]);
    while (cur && !guard.has(cur)) {
      anc.push(cur);
      guard.add(cur);
      cur = idx.parentOf.get(cur)?.parent;
    }
    ancestorsOf.set(t.id, anc);
  }
  const ancestors = (id: ID) => ancestorsOf.get(id) ?? [];

  // Cycle detection on the ordering graph
  const graph = buildOrderGraph(board);
  const cycleNodes = findCycleNodes(graph);
  const cycle = new Set<ID>();
  for (const n of cycleNodes) cycle.add(n.slice(2));

  // ---- effective status (memoized, cycle-guarded)
  const statusMemo = new Map<ID, TaskStatus>();
  const visiting = new Set<ID>();
  const droppedBranch = (id: ID) => get(id).status === 'dropped' || ancestors(id).some((a) => get(a).status === 'dropped');

  const blockersMemo = new Map<ID, Blocker[]>();
  function blockersOf(id: ID): Blocker[] {
    const memo = blockersMemo.get(id);
    if (memo) return memo;
    const out: Blocker[] = [];
    const seen = new Set<ID>();
    for (const x of [id, ...ancestors(id)]) {
      for (const p of prereqs(x)) {
        if (seen.has(p) || p === id) continue;
        if (!isResolvedStatus(effStatus(p))) {
          seen.add(p);
          out.push({ id: p, via: x === id ? null : x });
        }
      }
    }
    blockersMemo.set(id, out);
    return out;
  }

  function effStatus(id: ID): TaskStatus {
    const memo = statusMemo.get(id);
    if (memo) return memo;
    const t = get(id);
    if (visiting.has(id)) return t.status;
    visiting.add(id);
    let s: TaskStatus;
    if (droppedBranch(id)) s = 'dropped';
    else if (kids(id).length > 0) {
      const cs = kids(id).map(effStatus).filter((c) => c !== 'dropped');
      if (cs.length === 0) s = t.status === 'dropped' ? 'dropped' : t.status;
      else if (cs.every((c) => c === 'done')) s = 'done';
      else if (cs.some((c) => c === 'doing' || c === 'done')) s = 'doing';
      else s = 'todo';
    } else if (t.milestone && prereqs(id).length > 0) {
      s = blockersOf(id).length === 0 ? 'done' : 'todo';
    } else s = t.status;
    visiting.delete(id);
    statusMemo.set(id, s);
    return s;
  }

  // ---- waiting sets (who is waiting on X) for impact / urgency / needed-by
  const descendantsMemo = new Map<ID, ID[]>();
  function descendants(id: ID): ID[] {
    const m = descendantsMemo.get(id);
    if (m) return m;
    const out: ID[] = [];
    const stack = [...kids(id)];
    const seen = new Set<ID>();
    while (stack.length) {
      const c = stack.pop()!;
      if (seen.has(c)) continue;
      seen.add(c);
      out.push(c);
      stack.push(...kids(c));
    }
    descendantsMemo.set(id, out);
    return out;
  }

  function waitingOn(id: ID): Set<ID> {
    const waiting = new Set<ID>();
    const queue: ID[] = [id];
    const visited = new Set<ID>();
    while (queue.length) {
      const x = queue.shift()!;
      if (visited.has(x)) continue;
      visited.add(x);
      for (const d of dependents(x)) {
        for (const w of [d, ...descendants(d)]) {
          if (w !== id && !waiting.has(w)) {
            waiting.add(w);
            queue.push(w);
          }
        }
      }
      const p = idx.parentOf.get(x)?.parent;
      if (p) queue.push(p);
    }
    for (const a of ancestors(id)) waiting.delete(a);
    return waiting;
  }

  const basePriority = (id: ID): Priority =>
    Math.max(get(id).priority, ...ancestors(id).map((a) => get(a).priority)) as Priority;
  const baseDue = (id: ID): { due: string | null; from: ID | null } => {
    let best: { due: string | null; from: ID | null } = { due: get(id).due, from: get(id).due ? id : null };
    for (const a of ancestors(id)) {
      const d = get(a).due;
      if (d && (!best.due || d < best.due)) best = { due: d, from: a };
    }
    return best;
  };

  // ---- build infos
  const infos = new Map<ID, TaskInfo>();
  for (const t of tasks) {
    const status = effStatus(t.id);
    const resolved = isResolvedStatus(status);
    const childIds = kids(t.id);
    const composite = childIds.length > 0;
    const blockers = resolved ? [] : blockersOf(t.id);
    let state: TaskState;
    if (status === 'done') state = 'done';
    else if (status === 'dropped') state = 'dropped';
    else if (status === 'doing') state = 'doing';
    else if (blockers.length) state = 'blocked';
    else state = 'ready';

    const softPending = (idx.softPrereqs.get(t.id) ?? []).filter((p) => !isResolvedStatus(effStatus(p)));
    const anc = ancestors(t.id);
    infos.set(t.id, {
      id: t.id,
      parentId: idx.parentOf.get(t.id)?.parent ?? null,
      parentLinkId: idx.parentOf.get(t.id)?.linkId ?? null,
      childIds,
      ancestors: anc,
      depth: anc.length,
      composite,
      gated: t.milestone && !composite && prereqs(t.id).length > 0,
      status,
      state,
      resolved,
      prereqs: prereqs(t.id),
      softPrereqs: idx.softPrereqs.get(t.id) ?? [],
      dependents: dependents(t.id),
      softDependents: idx.softDependents.get(t.id) ?? [],
      related: idx.related.get(t.id) ?? [],
      notes: idx.notes.get(t.id) ?? [],
      blockers,
      softPending,
      progress: null,
      totalEstimate: 0,
      remainingEstimate: 0,
      impact: 0,
      urgency: t.priority,
      neededBy: t.due,
      neededByFor: t.due ? t.id : null,
      overdue: false,
      warnings: [],
      step: null,
      critical: false,
    });
  }

  // ---- progress & estimates (post-order)
  const estMemo = new Map<ID, { total: number; remaining: number; leavesDone: number; leaves: number }>();
  function rollup(id: ID, guard = new Set<ID>()): { total: number; remaining: number; leavesDone: number; leaves: number } {
    const m = estMemo.get(id);
    if (m) return m;
    const info = infos.get(id)!;
    const t = get(id);
    let r: { total: number; remaining: number; leavesDone: number; leaves: number };
    if (!info.composite || guard.has(id)) {
      const est = t.estimate ?? 0;
      const dropped = info.status === 'dropped';
      r = {
        total: dropped ? 0 : est,
        remaining: info.resolved ? 0 : est,
        leavesDone: info.status === 'done' ? 1 : 0,
        leaves: dropped ? 0 : 1,
      };
    } else {
      guard.add(id);
      r = { total: 0, remaining: 0, leavesDone: 0, leaves: 0 };
      for (const c of info.childIds) {
        const cr = rollup(c, guard);
        r.total += cr.total;
        r.remaining += cr.remaining;
        r.leavesDone += cr.leavesDone;
        r.leaves += cr.leaves;
      }
      if (r.total === 0 && t.estimate) {
        r.total = t.estimate;
        r.remaining = info.resolved ? 0 : t.estimate;
      }
    }
    estMemo.set(id, r);
    return r;
  }
  for (const info of infos.values()) {
    const r = rollup(info.id);
    info.totalEstimate = r.total;
    info.remainingEstimate = r.remaining;
    const t = get(info.id);
    if (info.composite && r.leaves > 0) {
      info.progress = { done: r.leavesDone, total: r.leaves, ratio: r.leavesDone / r.leaves, unit: 'subtasks' };
    } else if (!info.composite && t.checklist.length > 0) {
      const done = t.checklist.filter((c) => c.done).length;
      info.progress = { done, total: t.checklist.length, ratio: done / t.checklist.length, unit: 'checklist' };
    }
  }

  // ---- impact, urgency, needed-by
  for (const info of infos.values()) {
    const waiting = waitingOn(info.id);
    let impact = 0;
    let urgency = basePriority(info.id);
    let nb = baseDue(info.id);
    for (const w of waiting) {
      const wi = infos.get(w);
      if (!wi || wi.resolved) continue;
      impact++;
      urgency = Math.max(urgency, basePriority(w)) as Priority;
      const d = baseDue(w);
      if (d.due && (!nb.due || d.due < nb.due)) nb = d;
    }
    info.impact = impact;
    info.urgency = urgency;
    info.neededBy = nb.due;
    info.neededByFor = nb.from;
  }

  // ---- warnings
  for (const info of infos.values()) {
    const t = get(info.id);
    if (cycle.has(info.id)) {
      info.warnings.push({ kind: 'cycle', message: 'Part of a circular dependency — nothing in the loop can ever start.' });
    }
    if (info.resolved) continue;
    if (t.due && t.due < today) {
      info.overdue = true;
      info.warnings.push({ kind: 'overdue', message: `Overdue (was due ${t.due}).` });
    }
    for (const p of info.prereqs) {
      const pt = get(p);
      const pi = infos.get(p)!;
      if (pi.status === 'dropped') {
        info.warnings.push({
          kind: 'dropped-prereq',
          message: `Prerequisite “${pt.title || 'Untitled'}” was dropped — check this task still makes sense.`,
          ref: p,
        });
      }
      if (t.due && pt.due && pt.due > t.due && !pi.resolved) {
        info.warnings.push({
          kind: 'due-conflict',
          message: `Due ${t.due}, but its prerequisite “${pt.title || 'Untitled'}” is only due ${pt.due}.`,
          ref: p,
        });
      }
    }
    if (info.neededBy && info.neededByFor && info.neededByFor !== info.id && t.due && t.due > info.neededBy) {
      const ft = get(info.neededByFor);
      const isAncestor = info.ancestors.includes(info.neededByFor);
      info.warnings.push({
        kind: isAncestor ? 'parent-due' : 'due-conflict',
        message: isAncestor
          ? `Due ${t.due}, after its parent “${ft.title || 'Untitled'}” (due ${ft.due}).`
          : `Due ${t.due}, but “${ft.title || 'Untitled'}” needs it by ${info.neededBy}.`,
        ref: info.neededByFor,
      });
    }
    if (!info.composite && info.status === 'doing' && info.blockers.length > 0) {
      info.warnings.push({
        kind: 'started-blocked',
        message: 'In progress although some prerequisites are not finished yet.',
      });
    }
  }

  // ---- plan: priority-guided topological sort of the ordering graph
  const indeg = new Map<string, number>();
  for (const k of graph.keys()) indeg.set(k, indeg.get(k) ?? 0);
  for (const edges of graph.values()) for (const e of edges) indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
  const available: string[] = [];
  for (const [k, d] of indeg) if (d === 0) available.push(k);

  const stateRank: Record<TaskState, number> = { done: 0, dropped: 0, doing: 1, ready: 2, blocked: 3 };
  const keyOf = (node: string): (number | string)[] => {
    const id = node.slice(2);
    const info = infos.get(id)!;
    const t = get(id);
    return [
      node[0] === 'E' ? 0 : 1, // closing nodes first: finishes things, unlocks more
      stateRank[info.state],
      -info.urgency,
      info.neededBy ?? '9999-99-99',
      -info.impact,
      Math.round(t.y / 40),
      t.x,
      t.order,
    ];
  };
  const cmp = (a: (number | string)[], b: (number | string)[]) => {
    for (let i = 0; i < a.length; i++) {
      if (a[i] < b[i]) return -1;
      if (a[i] > b[i]) return 1;
    }
    return 0;
  };

  const topo: string[] = [];
  const plan: ID[] = [];
  while (available.length) {
    let bi = 0;
    let bk = keyOf(available[0]);
    for (let i = 1; i < available.length; i++) {
      const k = keyOf(available[i]);
      if (cmp(k, bk) < 0) {
        bk = k;
        bi = i;
      }
    }
    const n = available.splice(bi, 1)[0];
    topo.push(n);
    if (n[0] === 'S') {
      const info = infos.get(n.slice(2))!;
      if (!info.composite && !info.resolved && !info.gated) plan.push(info.id);
    }
    for (const e of graph.get(n) ?? []) {
      const d = indeg.get(e.to)! - 1;
      indeg.set(e.to, d);
      if (d === 0) available.push(e.to);
    }
  }
  plan.forEach((id, i) => (infos.get(id)!.step = i + 1));

  const next = plan
    .filter((id) => {
      const s = infos.get(id)!.state;
      return s === 'ready' || s === 'doing';
    })
    .sort((a, b) => {
      const sa = infos.get(a)!.state === 'doing' ? 0 : 1;
      const sb = infos.get(b)!.state === 'doing' ? 0 : 1;
      return sa - sb || infos.get(a)!.step! - infos.get(b)!.step!;
    });

  // ---- critical path: longest remaining-work chain through the ordering DAG
  const criticalLinks = new Set<ID>();
  {
    const anyEstimate = tasks.some((t) => t.estimate != null);
    const weight = (id: ID) => {
      const info = infos.get(id)!;
      if (info.composite || info.resolved || info.gated) return 0;
      return anyEstimate ? (get(id).estimate ?? 0) : 1;
    };
    const dist = new Map<string, number>();
    const pred = new Map<string, { from: string; linkId?: ID }>();
    for (const n of topo) if (!dist.has(n)) dist.set(n, 0);
    for (const n of topo) {
      const dn = dist.get(n)!;
      for (const e of graph.get(n) ?? []) {
        const w = n[0] === 'S' && e.to === E(n.slice(2)) ? weight(n.slice(2)) : 0;
        if (dn + w > (dist.get(e.to) ?? -1)) {
          dist.set(e.to, dn + w);
          pred.set(e.to, { from: n, linkId: e.linkId });
        }
      }
    }
    let end: string | null = null;
    let best = 0;
    for (const [n, d] of dist) if (d > best) ((best = d), (end = n));
    if (end) {
      const onPath: ID[] = [];
      const links: ID[] = [];
      let cur: string | undefined = end;
      while (cur) {
        const p = pred.get(cur);
        if (!p) break;
        if (p.from[0] === 'S' && cur === E(p.from.slice(2)) && weight(p.from.slice(2)) > 0) onPath.push(p.from.slice(2));
        if (p.linkId) links.push(p.linkId);
        cur = p.from;
      }
      if (onPath.length >= 2) {
        onPath.forEach((id) => (infos.get(id)!.critical = true));
        links.forEach((l) => criticalLinks.add(l));
      }
    }
  }

  // ---- roots & stats
  const roots = tasks
    .filter((t) => !idx.parentOf.has(t.id))
    .sort((a, b) => a.order - b.order || a.createdAt - b.createdAt)
    .map((t) => t.id);

  const stats: BoardStats = { total: 0, open: 0, done: 0, doing: 0, ready: 0, blocked: 0, dropped: 0, overdue: 0, remainingHours: 0 };
  for (const info of infos.values()) {
    if (info.composite) continue; // count units of work only
    stats.total++;
    stats[info.state]++;
    if (!info.resolved) stats.open++;
    if (info.overdue) stats.overdue++;
    stats.remainingHours += info.remainingEstimate;
  }

  return { tasks: infos, roots, plan, next, criticalLinks, cycle, stats };
}

/* ------------------------------------------------------------------ */
/* Graph queries used by the UI                                         */
/* ------------------------------------------------------------------ */

export function descendantsOf(a: Analysis, id: ID): ID[] {
  const out: ID[] = [];
  const stack = [...(a.tasks.get(id)?.childIds ?? [])];
  const seen = new Set<ID>();
  while (stack.length) {
    const c = stack.pop()!;
    if (seen.has(c)) continue;
    seen.add(c);
    out.push(c);
    stack.push(...(a.tasks.get(c)?.childIds ?? []));
  }
  return out;
}

/** Everything that must (or should) happen before `id`, including inherited prerequisites. */
export function upstreamOf(a: Analysis, id: ID): Set<ID> {
  const out = new Set<ID>();
  const queue: ID[] = [id];
  const visited = new Set<ID>();
  while (queue.length) {
    const x = queue.shift()!;
    if (visited.has(x)) continue;
    visited.add(x);
    const info = a.tasks.get(x);
    if (!info) continue;
    for (const holder of [x, ...info.ancestors]) {
      const hi = a.tasks.get(holder)!;
      for (const p of [...hi.prereqs, ...hi.softPrereqs]) {
        for (const u of [p, ...descendantsOf(a, p)]) {
          if (!out.has(u)) {
            out.add(u);
            queue.push(u);
          }
        }
      }
    }
  }
  out.delete(id);
  return out;
}

/** Everything that waits (directly or transitively) on `id`. */
export function downstreamOf(a: Analysis, id: ID): Set<ID> {
  const out = new Set<ID>();
  const queue: ID[] = [id];
  const visited = new Set<ID>();
  while (queue.length) {
    const x = queue.shift()!;
    if (visited.has(x)) continue;
    visited.add(x);
    const info = a.tasks.get(x);
    if (!info) continue;
    for (const d of [...info.dependents, ...info.softDependents]) {
      for (const w of [d, ...descendantsOf(a, d)]) {
        if (!out.has(w)) {
          out.add(w);
          queue.push(w);
        }
      }
    }
    if (info.parentId) queue.push(info.parentId);
  }
  out.delete(id);
  for (const anc of a.tasks.get(id)?.ancestors ?? []) out.delete(anc);
  return out;
}

/** Items & links to highlight when focusing on a task. */
export function focusSet(a: Analysis, board: Board, id: ID): { items: Set<ID>; links: Set<ID> } {
  const items = new Set<ID>([id]);
  const info = a.tasks.get(id);
  if (!info) {
    // non-task: itself and direct neighbours
    for (const l of Object.values(board.links)) {
      if (l.source === id || l.target === id) {
        items.add(l.source);
        items.add(l.target);
      }
    }
    const links = new Set(Object.values(board.links).filter((l) => l.source === id || l.target === id).map((l) => l.id));
    return { items, links };
  }
  for (const u of upstreamOf(a, id)) items.add(u);
  for (const d of downstreamOf(a, id)) items.add(d);
  for (const anc of info.ancestors) items.add(anc);
  for (const c of descendantsOf(a, id)) items.add(c);
  for (const n of info.notes) items.add(n);
  const links = new Set<ID>();
  for (const l of Object.values(board.links)) {
    if (!items.has(l.source) || !items.has(l.target)) continue;
    if (l.type === 'relates' || l.type === 'line') continue;
    links.add(l.id);
  }
  return { items, links };
}
