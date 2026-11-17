/**
 * Validation rules for creating / changing links. Every rule returns a human
 * explanation so the UI can tell the user *why* something isn't allowed.
 */
import { buildOrderGraph, findCycleNodes } from './engine';
import { makeLink } from './factory';
import type { Board, ID, Item, LinkType } from './types';
import { isTask } from './types';

export const LINK_META: Record<
  LinkType,
  { label: string; verb: string; describe: (a: string, b: string) => string; semantic: boolean }
> = {
  depends: {
    label: 'Blocks',
    verb: 'must finish before',
    describe: (a, b) => `“${a}” must be done before “${b}” can start.`,
    semantic: true,
  },
  soft: {
    label: 'Better before',
    verb: 'should come before',
    describe: (a, b) => `“${a}” should preferably be done before “${b}” (advisory — never blocks).`,
    semantic: true,
  },
  subtask: {
    label: 'Subtask',
    verb: 'contains',
    describe: (a, b) => `“${b}” is a part of “${a}”. “${a}” is done when all its parts are done.`,
    semantic: true,
  },
  relates: {
    label: 'Related',
    verb: 'relates to',
    describe: (a, b) => `“${a}” and “${b}” are related. No effect on status.`,
    semantic: true,
  },
  annotates: {
    label: 'Note',
    verb: 'annotates',
    describe: (_a, b) => `Note attached to “${b}”.`,
    semantic: true,
  },
  line: {
    label: 'Line',
    verb: 'connects to',
    describe: () => 'Plain diagram connector — no task meaning.',
    semantic: false,
  },
};

export const titleOf = (it: Item | undefined): string => {
  if (!it) return '?';
  switch (it.kind) {
    case 'task':
      return it.title || 'Untitled task';
    case 'note':
      return (it.text.split('\n')[0] || 'Note').slice(0, 40);
    case 'shape':
      return it.text || 'Shape';
    case 'frame':
      return it.title || 'Area';
    case 'text':
      return it.text.slice(0, 40) || 'Text';
  }
};

export type LinkCheck =
  | { ok: true; type: LinkType; source: ID; target: ID; replaces: ID[]; notice?: string }
  | { ok: false; reason: string };

/**
 * Decides the actual link type for a connection drawn from `source` to `target`
 * while the user has `mode` selected, so drawing "just works":
 *  - anything involving a note and a task becomes an annotation
 *  - anything involving shapes, text or frames becomes a plain line
 *  - task ↔ task uses the selected mode
 */
export function resolveLinkType(board: Board, mode: LinkType, source: ID, target: ID): LinkType {
  const s = board.items[source];
  const t = board.items[target];
  if (!s || !t) return 'line';
  if (mode === 'line') return 'line';
  const tasky = isTask(s) && isTask(t);
  if (tasky) return mode === 'annotates' ? 'relates' : mode;
  const noteTask = (s.kind === 'note' && isTask(t)) || (t.kind === 'note' && isTask(s));
  if (noteTask) return mode === 'relates' ? 'relates' : 'annotates';
  if (s.kind === 'note' && t.kind === 'note') return 'relates';
  return 'line';
}

export function checkLink(board: Board, type: LinkType, source: ID, target: ID, ignoreLinkId?: ID): LinkCheck {
  const s = board.items[source];
  const t = board.items[target];
  if (!s || !t) return { ok: false, reason: 'Both ends must exist.' };
  if (source === target) return { ok: false, reason: 'An item can’t be linked to itself.' };

  const others = Object.values(board.links).filter((l) => l.id !== ignoreLinkId);
  const between = others.filter(
    (l) => (l.source === source && l.target === target) || (l.source === target && l.target === source),
  );

  if (type === 'line') {
    return { ok: true, type, source, target, replaces: [] };
  }

  if (type === 'annotates') {
    const note = s.kind === 'note' ? s : t.kind === 'note' ? t : null;
    const task = isTask(t) ? t : isTask(s) ? s : null;
    if (!note || !task) return { ok: false, reason: 'Notes can be attached to tasks only.' };
    if (between.some((l) => l.type === 'annotates')) return { ok: false, reason: 'This note is already attached.' };
    return { ok: true, type, source: note.id, target: task.id, replaces: [] };
  }

  if (type === 'relates') {
    if (!(s.kind === 'task' || s.kind === 'note') || !(t.kind === 'task' || t.kind === 'note'))
      return { ok: false, reason: '“Related” links connect tasks and notes.' };
    if (between.some((l) => l.type === 'relates')) return { ok: false, reason: 'These are already related.' };
    return { ok: true, type, source, target, replaces: [] };
  }

  // depends / soft / subtask: task semantics
  if (!isTask(s) || !isTask(t)) {
    return { ok: false, reason: `“${LINK_META[type].label}” links connect tasks. Convert the element to a task first.` };
  }
  const sName = titleOf(s);
  const tName = titleOf(t);

  const semanticBetween = between.filter((l) => l.type === 'depends' || l.type === 'soft' || l.type === 'subtask');
  const replaces: ID[] = [];
  let notice: string | undefined;

  if (type === 'subtask') {
    if (s.milestone) return { ok: false, reason: 'Milestones are checkpoints and can’t have subtasks. Turn it into a regular task first.' };
    if (semanticBetween.length) {
      // Re-purpose: an existing dependency/subtask between the two is replaced.
      replaces.push(...semanticBetween.map((l) => l.id));
    }
    const existingParent = others.find(
      (l) => l.type === 'subtask' && l.target === target && !replaces.includes(l.id),
    );
    if (existingParent) {
      if (existingParent.source === source) return { ok: false, reason: `“${tName}” is already a subtask of “${sName}”.` };
      replaces.push(existingParent.id);
      notice = `Moved “${tName}” from “${titleOf(board.items[existingParent.source])}” to “${sName}” — a task has a single parent.`;
    }
  } else {
    // depends / soft
    const same = semanticBetween.find((l) => l.type === type && l.source === source);
    if (same) return { ok: false, reason: 'That link already exists.' };
    const sub = semanticBetween.find((l) => l.type === 'subtask');
    if (sub) {
      return {
        ok: false,
        reason: `“${titleOf(board.items[sub.target])}” is a subtask of “${titleOf(board.items[sub.source])}”. Parent and subtask are already ordered by the hierarchy.`,
      };
    }
    // Opposite direction or other dependency kind between the same pair is replaced.
    replaces.push(...semanticBetween.map((l) => l.id));
  }

  // Ancestor/descendant dependency check (friendlier message than a generic cycle)
  if (type !== 'subtask') {
    const parentOf = new Map<ID, ID>();
    for (const l of others) if (l.type === 'subtask' && !parentOf.has(l.target)) parentOf.set(l.target, l.source);
    const isAncestor = (a: ID, b: ID) => {
      let cur = parentOf.get(b);
      const guard = new Set<ID>();
      while (cur && !guard.has(cur)) {
        if (cur === a) return true;
        guard.add(cur);
        cur = parentOf.get(cur);
      }
      return false;
    };
    if (isAncestor(source, target) || isAncestor(target, source)) {
      return {
        ok: false,
        reason: `“${sName}” and “${tName}” are in the same branch (one contains the other). A part can’t wait for its whole, and the whole already waits for its parts.`,
      };
    }
  }

  const exclude = new Set<ID>(replaces);
  if (ignoreLinkId) exclude.add(ignoreLinkId);
  const g = buildOrderGraph(board, exclude, [makeLink(type, source, target, { createdAt: Number.MAX_SAFE_INTEGER })]);
  if (findCycleNodes(g).size > 0) {
    return {
      ok: false,
      reason:
        type === 'subtask'
          ? `Making “${tName}” a part of “${sName}” would create a deadlock: something “${sName}” waits for already waits for “${tName}”.`
          : `This would create a circular dependency: “${sName}” already (indirectly) waits for “${tName}”.`,
    };
  }
  return { ok: true, type, source, target, replaces, notice };
}
