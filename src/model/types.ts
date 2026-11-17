/**
 * Core document model.
 *
 * A Board is one workspace. It contains Items (things placed on the 2D canvas)
 * and Links (connections between items). Only *some* items and links carry
 * task semantics — the rest are plain diagram elements. See docs/DESIGN.md.
 *
 * Everything stored here is the *source of truth*. Anything that can be derived
 * (blocked state, progress, composite status, execution order…) is computed by
 * `engine.ts` and never stored, so the canvas and the list can never disagree.
 */

export type ID = string;

/** The status a person sets. Composite tasks and gated milestones derive theirs. */
export type TaskStatus = 'todo' | 'doing' | 'done' | 'dropped';

/** 0 none · 1 low · 2 medium · 3 high · 4 urgent */
export type Priority = 0 | 1 | 2 | 3 | 4;

export type ColorKey =
  | 'gray'
  | 'red'
  | 'orange'
  | 'yellow'
  | 'green'
  | 'teal'
  | 'blue'
  | 'purple'
  | 'pink';

export const COLOR_KEYS: ColorKey[] = ['gray', 'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink'];

export type ItemKind = 'task' | 'note' | 'shape' | 'frame' | 'text';

export type ShapeType = 'rect' | 'rounded' | 'ellipse' | 'diamond' | 'hexagon' | 'parallelogram' | 'cylinder';

interface ItemBase {
  id: ID;
  kind: ItemKind;
  /** Absolute canvas position (top-left). */
  x: number;
  y: number;
  /** Width / height. Tasks use `h` only as a layout hint (they auto-size). */
  w: number;
  h: number;
  color: ColorKey | null;
  /** The frame (area) this item sits in, derived from geometry on drop. */
  frameId: ID | null;
  createdAt: number;
  updatedAt: number;
}

export interface ChecklistEntry {
  id: ID;
  text: string;
  done: boolean;
}

export interface TaskItem extends ItemBase {
  kind: 'task';
  title: string;
  description: string;
  /** Stored status. Ignored (derived) for composite tasks and gated milestones, except 'dropped'. */
  status: TaskStatus;
  /** A milestone is a checkpoint with no work of its own: it is reached when its prerequisites are done. */
  milestone: boolean;
  priority: Priority;
  /** ISO dates (YYYY-MM-DD) */
  start: string | null;
  due: string | null;
  /** Estimated effort in hours. Used for rollups and the critical path. */
  estimate: number | null;
  tags: string[];
  /** Sort order among siblings (same parent). */
  order: number;
  /** Canvas only: hide the subtree under this task. */
  collapsed: boolean;
  checklist: ChecklistEntry[];
  completedAt: number | null;
}

export interface NoteItem extends ItemBase {
  kind: 'note';
  text: string;
}

export type StrokeStyle = 'solid' | 'dashed' | 'dotted';

export interface ShapeItem extends ItemBase {
  kind: 'shape';
  shape: ShapeType;
  text: string;
  stroke: StrokeStyle;
  fontSize: number;
}

export interface FrameItem extends ItemBase {
  kind: 'frame';
  title: string;
}

export interface TextItem extends ItemBase {
  kind: 'text';
  text: string;
  fontSize: number;
  bold: boolean;
}

export type Item = TaskItem | NoteItem | ShapeItem | FrameItem | TextItem;

/**
 * Link types and their meaning (source → target):
 *  - depends   : source must be finished before target can start (hard, blocks).
 *  - soft      : source should preferably be finished first (advisory; orders the plan but never blocks).
 *  - subtask   : target is a part of source (decomposition). A task has at most one parent.
 *  - relates   : loose association between two tasks/notes. No effect on state.
 *  - annotates : a note attached to a task (source = note).
 *  - line      : plain diagram connector, no semantics.
 */
export type LinkType = 'depends' | 'soft' | 'subtask' | 'relates' | 'annotates' | 'line';

export type Routing = 'curved' | 'orthogonal' | 'straight';
export type ArrowMode = 'end' | 'both' | 'none';

export interface Link {
  id: ID;
  type: LinkType;
  source: ID;
  target: ID;
  label: string;
  routing: Routing;
  /** Only used for `line` links (semantic links are colored by meaning/state). */
  color: ColorKey | null;
  arrow: ArrowMode;
  dashed: boolean;
  createdAt: number;
}

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export interface Board {
  id: ID;
  name: string;
  items: Record<ID, Item>;
  links: Record<ID, Link>;
  viewport: Viewport | null;
  createdAt: number;
  updatedAt: number;
}

export interface AppData {
  version: 1;
  boards: Record<ID, Board>;
  boardOrder: ID[];
  activeBoardId: ID;
}

export const isTask = (i: Item | undefined | null): i is TaskItem => !!i && i.kind === 'task';
