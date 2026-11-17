import type {
  Board,
  FrameItem,
  Link,
  LinkType,
  NoteItem,
  ShapeItem,
  ShapeType,
  TaskItem,
  TextItem,
} from './types';

let counter = 0;
export function uid(prefix = ''): string {
  counter = (counter + 1) % 1e6;
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
      : Math.random().toString(36).slice(2, 14);
  return `${prefix}${rand}${counter.toString(36)}`;
}

export const TASK_W = 248;
export const TASK_H = 76;

export function makeTask(p: Partial<TaskItem> = {}): TaskItem {
  const now = Date.now();
  return {
    id: uid('t_'),
    kind: 'task',
    x: 0,
    y: 0,
    w: TASK_W,
    h: TASK_H,
    color: null,
    frameId: null,
    createdAt: now,
    updatedAt: now,
    title: '',
    description: '',
    status: 'todo',
    milestone: false,
    priority: 0,
    start: null,
    due: null,
    estimate: null,
    tags: [],
    order: now,
    collapsed: false,
    checklist: [],
    completedAt: null,
    ...p,
  };
}

export function makeNote(p: Partial<NoteItem> = {}): NoteItem {
  const now = Date.now();
  return {
    id: uid('n_'),
    kind: 'note',
    x: 0,
    y: 0,
    w: 200,
    h: 140,
    color: 'yellow',
    frameId: null,
    createdAt: now,
    updatedAt: now,
    text: '',
    ...p,
  };
}

export function makeShape(shape: ShapeType = 'rounded', p: Partial<ShapeItem> = {}): ShapeItem {
  const now = Date.now();
  const square = shape === 'diamond' || shape === 'ellipse' || shape === 'hexagon';
  return {
    id: uid('s_'),
    kind: 'shape',
    x: 0,
    y: 0,
    w: square ? 150 : 170,
    h: square ? 110 : 90,
    color: 'blue',
    frameId: null,
    createdAt: now,
    updatedAt: now,
    shape,
    text: '',
    stroke: 'solid',
    fontSize: 14,
    ...p,
  };
}

export function makeFrame(p: Partial<FrameItem> = {}): FrameItem {
  const now = Date.now();
  return {
    id: uid('f_'),
    kind: 'frame',
    x: 0,
    y: 0,
    w: 640,
    h: 400,
    color: 'blue',
    frameId: null,
    createdAt: now,
    updatedAt: now,
    title: 'New area',
    ...p,
  };
}

export function makeText(p: Partial<TextItem> = {}): TextItem {
  const now = Date.now();
  return {
    id: uid('x_'),
    kind: 'text',
    x: 0,
    y: 0,
    w: 220,
    h: 40,
    color: null,
    frameId: null,
    createdAt: now,
    updatedAt: now,
    text: 'Text',
    fontSize: 20,
    bold: true,
    ...p,
  };
}

export function makeLink(type: LinkType, source: string, target: string, p: Partial<Link> = {}): Link {
  return {
    id: uid('l_'),
    type,
    source,
    target,
    label: '',
    routing: type === 'subtask' ? 'orthogonal' : 'curved',
    color: null,
    arrow: type === 'line' ? 'end' : 'none',
    dashed: false,
    createdAt: Date.now(),
    ...p,
  };
}

export function makeBoard(name = 'Untitled board'): Board {
  const now = Date.now();
  return {
    id: uid('b_'),
    name,
    items: {},
    links: {},
    viewport: null,
    createdAt: now,
    updatedAt: now,
  };
}
