import { produce } from 'immer';
import { create } from 'zustand';
import { analyze, descendantsOf, type Analysis } from '../model/engine';
import { makeBoard, makeFrame, makeLink, makeNote, makeShape, makeTask, makeText, TASK_W, uid } from '../model/factory';
import { boundsOf, computeLayout, findFreeSpot, frameAt, frameMembers, type LayoutMode } from '../model/geometry';
import { checkLink, resolveLinkType, titleOf } from '../model/rules';
import { createSampleBoard } from '../model/sample';
import type {
  AppData,
  Board,
  ID,
  Item,
  Link,
  LinkType,
  ShapeType,
  TaskItem,
  TaskStatus,
  Viewport,
} from '../model/types';
import { isTask } from '../model/types';

export type View = 'canvas' | 'split' | 'list';
export type ListMode = 'outline' | 'next' | 'plan' | 'waiting' | 'done';
export type Theme = 'light' | 'dark';

export interface Toast {
  id: string;
  kind: 'info' | 'error' | 'success';
  text: string;
  action?: { label: string; run: () => void };
}

export interface UIState {
  view: View;
  listMode: ListMode;
  selection: ID[];
  selectedLinks: ID[];
  linkMode: LinkType;
  theme: Theme;
  showMinimap: boolean;
  snapToGrid: boolean;
  completed: 'show' | 'fade' | 'hide';
  showCritical: boolean;
  focusMode: boolean;
  sidebarOpen: boolean;
  inspectorOpen: boolean;
  /** item currently being edited inline on the canvas */
  editingId: ID | null;
  /** list row whose title input should grab focus */
  listEditId: ID | null;
  /** ask the canvas to center an item */
  centerRequest: { id: ID; nonce: number } | null;
  /** ask the list to scroll to an item */
  listRevealRequest: { id: ID; nonce: number } | null;
  search: string;
  tagFilter: string | null;
  toasts: Toast[];
  paletteOpen: boolean;
  helpOpen: boolean;
}

interface Clipboard {
  items: Item[];
  links: Link[];
}

export interface AddTaskOptions {
  at?: { x: number; y: number };
  parentId?: ID | null;
  /** create right after this sibling (same parent) */
  after?: ID;
  /** create as the next step after this task (with a dependency) */
  nextOf?: ID;
  /** create as a prerequisite of this task */
  prereqOf?: ID;
  frameId?: ID | null;
  title?: string;
  milestone?: boolean;
  patch?: Partial<TaskItem>;
  select?: boolean;
  edit?: 'canvas' | 'list' | null;
}

interface MutateOpts {
  history?: boolean;
  coalesce?: string;
  analyze?: boolean;
}

export interface Store {
  loaded: boolean;
  data: AppData;
  analysis: Analysis;
  past: Board[];
  future: Board[];
  coalesceKey: string | null;
  coalesceAt: number;
  gestureOpen: boolean;
  clipboard: Clipboard | null;
  ui: UIState;

  // infra
  hydrate(data: AppData | null): void;
  board(): Board;
  mutate(recipe: (b: Board) => void, opts?: MutateOpts): void;
  beginGesture(): void;
  endGesture(): void;
  undo(): void;
  redo(): void;
  setUI(patch: Partial<UIState>): void;
  toast(text: string, kind?: Toast['kind'], action?: Toast['action']): void;
  dismissToast(id: string): void;

  // selection & navigation
  select(ids: ID[], links?: ID[]): void;
  toggleSelect(id: ID): void;
  selectAll(): void;
  clearSelection(): void;
  revealOnCanvas(id: ID): void;
  revealInList(id: ID): void;

  // items
  addTask(opts?: AddTaskOptions): ID;
  addItem(item: Item, opts?: { select?: boolean; edit?: boolean; free?: boolean }): ID;
  addNote(at: { x: number; y: number }, attachTo?: ID): ID;
  addShape(shape: ShapeType, at: { x: number; y: number }): ID;
  addFrame(at: { x: number; y: number }): ID;
  addText(at: { x: number; y: number }): ID;
  updateItem<T extends Item>(id: ID, patch: Partial<T>, coalesce?: string): void;
  updateItems(ids: ID[], patch: Partial<Item> | ((it: Item) => Partial<Item>)): void;
  moveItems(positions: Record<ID, { x: number; y: number }>): void;
  resizeItem(id: ID, rect: { x: number; y: number; w: number; h: number }): void;
  measureItems(sizes: Record<ID, { w: number; h: number }>): void;
  deleteItems(ids: ID[], opts?: { withSubtasks?: boolean }): void;
  duplicate(ids: ID[]): void;
  copy(ids: ID[]): void;
  paste(at?: { x: number; y: number }): void;
  convert(id: ID, kind: 'task' | 'note'): void;
  wrapInFrame(ids: ID[]): void;
  align(ids: ID[], how: 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom'): void;
  distribute(ids: ID[], axis: 'h' | 'v'): void;
  layout(mode: LayoutMode, ids?: ID[] | null): void;
  toggleCollapse(id: ID): void;

  // task semantics
  setStatus(ids: ID[], status: TaskStatus): void;
  toggleDone(ids: ID[]): void;
  cycleStatus(id: ID): void;
  setParent(childId: ID, parentId: ID | null, index?: number): boolean;
  indent(id: ID): boolean;
  outdent(id: ID): boolean;
  moveSibling(id: ID, dir: -1 | 1): void;

  // links
  connect(mode: LinkType, source: ID, target: ID): ID | null;
  updateLink(id: ID, patch: Partial<Link>): void;
  changeLinkType(id: ID, type: LinkType): void;
  reverseLink(id: ID): void;
  deleteLinks(ids: ID[]): void;
  removeRelation(type: LinkType, source: ID, target: ID): void;

  // boards
  createBoard(name?: string, sample?: boolean): void;
  switchBoard(id: ID): void;
  renameBoard(id: ID, name: string): void;
  deleteBoard(id: ID): void;
  duplicateBoard(id: ID): void;
  importData(raw: unknown): void;
  setViewport(vp: Viewport): void;
}

const HISTORY_LIMIT = 200;

const initialUI: UIState = {
  view: 'canvas',
  listMode: 'outline',
  selection: [],
  selectedLinks: [],
  linkMode: 'depends',
  theme: (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') as Theme,
  showMinimap: true,
  snapToGrid: true,
  completed: 'fade',
  showCritical: false,
  focusMode: false,
  sidebarOpen: true,
  inspectorOpen: true,
  editingId: null,
  listEditId: null,
  centerRequest: null,
  listRevealRequest: null,
  search: '',
  tagFilter: null,
  toasts: [],
  paletteOpen: false,
  helpOpen: false,
};

function emptyData(): AppData {
  const b = makeBoard('My board');
  return { version: 1, boards: { [b.id]: b }, boardOrder: [b.id], activeBoardId: b.id };
}

const UI_KEY = 'todo-diagrams:ui:v1';
const PERSISTED_UI: (keyof UIState)[] = [
  'view',
  'listMode',
  'linkMode',
  'theme',
  'showMinimap',
  'snapToGrid',
  'completed',
  'showCritical',
  'sidebarOpen',
  'inspectorOpen',
];
function loadUI(): Partial<UIState> {
  try {
    return JSON.parse(localStorage.getItem(UI_KEY) || '{}');
  } catch {
    return {};
  }
}
export function saveUI(ui: UIState) {
  try {
    const o: Record<string, unknown> = {};
    for (const k of PERSISTED_UI) o[k] = ui[k];
    localStorage.setItem(UI_KEY, JSON.stringify(o));
  } catch {
    /* ignore */
  }
}

/* ---------------- helpers operating on (draft) boards ---------------- */

function recomputeFrames(d: Board, ids?: ID[]) {
  const list = ids ? ids.map((id) => d.items[id]).filter(Boolean) : Object.values(d.items);
  // frames first (largest first) so nested frames resolve consistently
  const sorted = [...list].sort((a, b) => (a.kind === 'frame' ? 0 : 1) - (b.kind === 'frame' ? 0 : 1));
  for (const it of sorted) {
    const f = frameAt(d, it);
    if (it.frameId !== f) it.frameId = f;
  }
}

function siblingsOf(b: Board, a: Analysis, parentId: ID | null, frameId?: ID | null): TaskItem[] {
  const ids = parentId ? (a.tasks.get(parentId)?.childIds ?? []) : a.roots;
  let ts = ids.map((id) => b.items[id]).filter(isTask);
  if (!parentId && frameId !== undefined) ts = ts.filter((t) => t.frameId === frameId);
  return ts.sort((x, y) => x.order - y.order);
}

function orderAfter(sibs: TaskItem[], afterId?: ID): number {
  if (!sibs.length) return 1;
  if (!afterId) return sibs[sibs.length - 1].order + 1;
  const i = sibs.findIndex((s) => s.id === afterId);
  if (i < 0) return sibs[sibs.length - 1].order + 1;
  if (i === sibs.length - 1) return sibs[i].order + 1;
  return (sibs[i].order + sibs[i + 1].order) / 2;
}

/** Bottom-most y of a task and everything visually under it in its subtree. */
function subtreeBottom(b: Board, a: Analysis, id: ID): number {
  let bottom = b.items[id].y + b.items[id].h;
  for (const d of descendantsOf(a, id)) {
    const it = b.items[d];
    if (it && it.y > b.items[id].y) bottom = Math.max(bottom, it.y + it.h);
  }
  return bottom;
}

function bridgeOnDelete(b: Board, deleted: Set<ID>): Link[] {
  // Keep the order of a chain A → X → B when X is deleted: add A → B.
  const added: Link[] = [];
  for (const x of deleted) {
    const ins = Object.values(b.links).filter((l) => l.type === 'depends' && l.target === x && !deleted.has(l.source));
    const outs = Object.values(b.links).filter((l) => l.type === 'depends' && l.source === x && !deleted.has(l.target));
    for (const i of ins)
      for (const o of outs) {
        const exists = Object.values(b.links).some((l) => l.source === i.source && l.target === o.target && (l.type === 'depends' || l.type === 'subtask'));
        if (!exists) added.push(makeLink('depends', i.source, o.target));
      }
  }
  return added;
}

/* ---------------- store ---------------- */

export const useStore = create<Store>()((set, get) => {
  const initial = emptyData();
  const activeBoard = () => {
    const s = get();
    return s.data.boards[s.data.activeBoardId];
  };

  const replaceBoard = (next: Board, extra: Partial<Store> = {}, recompute = true) => {
    const s = get();
    set({
      data: { ...s.data, boards: { ...s.data.boards, [next.id]: next } },
      analysis: recompute ? analyze(next) : s.analysis,
      ...extra,
    });
  };

  const pruneSelection = (b: Board) => {
    const ui = get().ui;
    const selection = ui.selection.filter((id) => b.items[id]);
    const selectedLinks = ui.selectedLinks.filter((id) => b.links[id]);
    if (selection.length !== ui.selection.length || selectedLinks.length !== ui.selectedLinks.length) {
      set({ ui: { ...get().ui, selection, selectedLinks } });
    }
  };

  return {
    loaded: false,
    data: initial,
    analysis: analyze(initial.boards[initial.activeBoardId]),
    past: [],
    future: [],
    coalesceKey: null,
    coalesceAt: 0,
    gestureOpen: false,
    clipboard: null,
    ui: { ...initialUI, ...loadUI() },

    hydrate(data) {
      let d = data;
      if (!d || !d.boards || !d.boardOrder?.length) {
        const sample = createSampleBoard();
        d = { version: 1, boards: { [sample.id]: sample }, boardOrder: [sample.id], activeBoardId: sample.id };
      }
      if (!d.boards[d.activeBoardId]) d.activeBoardId = d.boardOrder[0];
      set({ data: d, analysis: analyze(d.boards[d.activeBoardId]), loaded: true, past: [], future: [] });
    },

    board: activeBoard,

    mutate(recipe, opts = {}) {
      const s = get();
      const cur = activeBoard();
      const next = produce(cur, (d) => {
        recipe(d as Board);
      });
      if (next === cur) return;
      const stamped = produce(next, (d) => {
        d.updatedAt = Date.now();
      });
      let past = s.past;
      let future = s.future;
      let coalesceKey = s.coalesceKey;
      let coalesceAt = s.coalesceAt;
      if (opts.history !== false && !s.gestureOpen) {
        const now = Date.now();
        const merge = opts.coalesce && opts.coalesce === s.coalesceKey && now - s.coalesceAt < 1500;
        if (!merge) past = [...s.past, cur].slice(-HISTORY_LIMIT);
        future = [];
        coalesceKey = opts.coalesce ?? null;
        coalesceAt = now;
      }
      replaceBoard(stamped, { past, future, coalesceKey, coalesceAt }, opts.analyze !== false);
      pruneSelection(stamped);
    },

    beginGesture() {
      const s = get();
      if (s.gestureOpen) return;
      set({ past: [...s.past, activeBoard()].slice(-HISTORY_LIMIT), future: [], gestureOpen: true, coalesceKey: null });
    },

    endGesture() {
      const s = get();
      if (!s.gestureOpen) return;
      set({ gestureOpen: false });
      const cur = activeBoard();
      const next = produce(cur, (d) => recomputeFrames(d as Board));
      replaceBoard(next);
      // drop the history entry if nothing changed
      const last = s.past[s.past.length - 1];
      if (last && JSON.stringify(last.items) === JSON.stringify(next.items)) set({ past: s.past.slice(0, -1) });
    },

    undo() {
      const s = get();
      if (!s.past.length) return;
      const prev = s.past[s.past.length - 1];
      replaceBoard(prev, { past: s.past.slice(0, -1), future: [activeBoard(), ...s.future], coalesceKey: null });
      pruneSelection(prev);
    },

    redo() {
      const s = get();
      if (!s.future.length) return;
      const nxt = s.future[0];
      replaceBoard(nxt, { past: [...s.past, activeBoard()], future: s.future.slice(1), coalesceKey: null });
      pruneSelection(nxt);
    },

    setUI(patch) {
      set({ ui: { ...get().ui, ...patch } });
    },

    toast(text, kind = 'info', action) {
      const t: Toast = { id: uid('toast'), kind, text, action };
      set({ ui: { ...get().ui, toasts: [...get().ui.toasts.slice(-3), t] } });
    },

    dismissToast(id) {
      set({ ui: { ...get().ui, toasts: get().ui.toasts.filter((t) => t.id !== id) } });
    },

    /* ---------------- selection ---------------- */

    select(ids, links = []) {
      get().setUI({ selection: ids, selectedLinks: links });
    },
    toggleSelect(id) {
      const sel = get().ui.selection;
      get().setUI({ selection: sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id] });
    },
    selectAll() {
      get().setUI({ selection: Object.keys(activeBoard().items), selectedLinks: [] });
    },
    clearSelection() {
      const ui = get().ui;
      if (ui.selection.length || ui.selectedLinks.length) get().setUI({ selection: [], selectedLinks: [] });
    },
    revealOnCanvas(id) {
      const ui = get().ui;
      const b = activeBoard();
      // expand collapsed ancestors so the item is visible
      const info = get().analysis.tasks.get(id);
      if (info) {
        const collapsedAnc = info.ancestors.filter((a) => (b.items[a] as TaskItem).collapsed);
        if (collapsedAnc.length) get().updateItems(collapsedAnc, { collapsed: false } as Partial<Item>);
      }
      get().setUI({
        view: ui.view === 'list' ? 'canvas' : ui.view,
        selection: [id],
        selectedLinks: [],
        centerRequest: { id, nonce: Date.now() },
      });
    },
    revealInList(id) {
      const ui = get().ui;
      get().setUI({
        view: ui.view === 'canvas' ? 'split' : ui.view,
        listMode: 'outline',
        selection: [id],
        listRevealRequest: { id, nonce: Date.now() },
      });
    },

    /* ---------------- items ---------------- */

    addTask(opts = {}) {
      const s = get();
      const b = activeBoard();
      const a = s.analysis;
      const t = makeTask({ title: opts.title ?? '', milestone: !!opts.milestone, ...opts.patch });
      if (t.milestone) t.w = 200;
      let parentId = opts.parentId ?? null;
      let pos: { x: number; y: number } | null = opts.at ?? null;

      if (opts.after && parentId === null && opts.parentId === undefined) {
        parentId = a.tasks.get(opts.after)?.parentId ?? null;
      }

      if (parentId) {
        const parent = b.items[parentId];
        const sibs = siblingsOf(b, a, parentId);
        t.order = orderAfter(sibs, opts.after);
        if (!pos) {
          const anchor = opts.after ? b.items[opts.after] : null;
          const y = anchor ? subtreeBottom(b, a, anchor.id) + 16 : subtreeBottom(b, a, parentId) + 28;
          pos = findFreeSpot(b, { x: (anchor?.x ?? parent.x + 44), y, w: t.w, h: t.h });
        }
        t.color = (parent as TaskItem).color;
      } else if (opts.after && b.items[opts.after]) {
        const anchor = b.items[opts.after];
        const sibs = siblingsOf(b, a, null);
        t.order = orderAfter(sibs, opts.after);
        if (!pos) pos = findFreeSpot(b, { x: anchor.x, y: subtreeBottom(b, a, anchor.id) + 16, w: t.w, h: t.h });
        t.frameId = anchor.frameId;
      } else if (opts.nextOf && b.items[opts.nextOf]) {
        const src = b.items[opts.nextOf];
        if (!pos) pos = findFreeSpot(b, { x: src.x + src.w + 80, y: src.y, w: t.w, h: t.h });
        t.order = siblingsOf(b, a, a.tasks.get(src.id)?.parentId ?? null).reduce((m, x) => Math.max(m, x.order), 0) + 1;
        parentId = null;
      } else if (opts.prereqOf && b.items[opts.prereqOf]) {
        const dst = b.items[opts.prereqOf];
        if (!pos) pos = findFreeSpot(b, { x: dst.x - t.w - 80, y: dst.y, w: t.w, h: t.h });
      } else {
        const sibs = siblingsOf(b, a, null);
        t.order = orderAfter(sibs);
        if (!pos) {
          const frameId = opts.frameId ?? null;
          const pool = Object.values(b.items).filter((i) => isTask(i) && i.frameId === frameId);
          const frame = frameId ? b.items[frameId] : null;
          const bounds = boundsOf(pool);
          const start = bounds
            ? { x: bounds.x, y: bounds.y + bounds.h + 24 }
            : frame
              ? { x: frame.x + 32, y: frame.y + 64 }
              : { x: 0, y: 0 };
          pos = findFreeSpot(b, { ...start, w: t.w, h: t.h });
        }
      }
      t.x = pos.x;
      t.y = pos.y;

      let linkToAdd: Link | null = null;
      let replaces: ID[] = [];
      let notice: string | undefined;
      const tmp = produce(b, (d) => {
        d.items[t.id] = t;
      });
      if (parentId) {
        const r = checkLink(tmp, 'subtask', parentId, t.id);
        if (r.ok) linkToAdd = makeLink('subtask', parentId, t.id);
        else s.toast(r.reason, 'error');
      } else if (opts.nextOf) {
        const r = checkLink(tmp, 'depends', opts.nextOf, t.id);
        if (r.ok) linkToAdd = makeLink('depends', opts.nextOf, t.id);
      } else if (opts.prereqOf) {
        const r = checkLink(tmp, 'depends', t.id, opts.prereqOf);
        if (r.ok) {
          linkToAdd = makeLink('depends', t.id, opts.prereqOf);
          replaces = r.replaces;
          notice = r.notice;
        }
      }

      get().mutate((d) => {
        d.items[t.id] = t;
        for (const id of replaces) delete d.links[id];
        if (linkToAdd) d.links[linkToAdd.id] = linkToAdd;
        if (opts.frameId !== undefined && opts.frameId !== null && !parentId) d.items[t.id].frameId = opts.frameId;
        else recomputeFrames(d, [t.id]);
      });
      if (notice) s.toast(notice);
      if (opts.select !== false) get().setUI({ selection: [t.id], selectedLinks: [] });
      if (opts.edit === 'canvas') get().setUI({ editingId: t.id });
      if (opts.edit === 'list') get().setUI({ listEditId: t.id });
      return t.id;
    },

    addItem(item, opts = {}) {
      const b = activeBoard();
      const it = { ...item };
      if (opts.free) {
        const p = findFreeSpot(b, { x: it.x, y: it.y, w: it.w, h: it.h });
        it.x = p.x;
        it.y = p.y;
      }
      get().mutate((d) => {
        d.items[it.id] = it as Item;
        recomputeFrames(d, [it.id]);
        if (it.kind === 'frame') recomputeFrames(d);
      });
      if (opts.select !== false) get().setUI({ selection: [it.id], selectedLinks: [] });
      if (opts.edit) get().setUI({ editingId: it.id });
      return it.id;
    },

    addNote(at, attachTo) {
      const n = makeNote({ x: at.x, y: at.y });
      const b = activeBoard();
      if (attachTo && b.items[attachTo]) {
        const t = b.items[attachTo];
        const p = findFreeSpot(b, { x: t.x + t.w + 40, y: t.y - 20, w: n.w, h: n.h });
        n.x = p.x;
        n.y = p.y;
      }
      const id = get().addItem(n, { edit: true });
      if (attachTo) get().connect('annotates', id, attachTo);
      get().setUI({ selection: [id], editingId: id });
      return id;
    },
    addShape(shape, at) {
      const sh = makeShape(shape, {});
      sh.x = at.x - sh.w / 2;
      sh.y = at.y - sh.h / 2;
      return get().addItem(sh, { edit: true });
    },
    addFrame(at) {
      return get().addItem(makeFrame({ x: at.x - 320, y: at.y - 200 }), { edit: true });
    },
    addText(at) {
      return get().addItem(makeText({ x: at.x - 110, y: at.y - 20 }), { edit: true });
    },

    updateItem(id, patch, coalesce) {
      get().mutate(
        (d) => {
          const it = d.items[id];
          if (!it) return;
          Object.assign(it, patch, { updatedAt: Date.now() });
        },
        { coalesce: coalesce ?? `item:${id}:${Object.keys(patch).join(',')}` },
      );
    },

    updateItems(ids, patch) {
      get().mutate((d) => {
        for (const id of ids) {
          const it = d.items[id];
          if (!it) continue;
          const p = typeof patch === 'function' ? patch(it) : patch;
          Object.assign(it, p, { updatedAt: Date.now() });
        }
      });
    },

    moveItems(positions) {
      const b = activeBoard();
      // frames drag their members along
      const extra: Record<ID, { x: number; y: number }> = {};
      for (const [id, p] of Object.entries(positions)) {
        const it = b.items[id];
        if (it?.kind !== 'frame') continue;
        const dx = p.x - it.x;
        const dy = p.y - it.y;
        if (!dx && !dy) continue;
        for (const m of frameMembers(b, id)) {
          if (positions[m]) continue;
          const mi = b.items[m];
          extra[m] = { x: mi.x + dx, y: mi.y + dy };
        }
      }
      get().mutate(
        (d) => {
          for (const [id, p] of Object.entries({ ...extra, ...positions })) {
            const it = d.items[id];
            if (!it) continue;
            if (it.x !== p.x) it.x = p.x;
            if (it.y !== p.y) it.y = p.y;
          }
        },
        { analyze: false },
      );
    },

    resizeItem(id, r) {
      get().mutate(
        (d) => {
          const it = d.items[id];
          if (!it) return;
          it.x = r.x;
          it.y = r.y;
          it.w = Math.max(40, r.w);
          it.h = Math.max(24, r.h);
        },
        { analyze: false },
      );
    },

    measureItems(sizes) {
      const b = activeBoard();
      const changed = Object.entries(sizes).filter(([id, s]) => {
        const it = b.items[id];
        return it && (Math.abs(it.h - s.h) > 0.5 || Math.abs(it.w - s.w) > 0.5);
      });
      if (!changed.length) return;
      const s = get();
      const next = produce(b, (d) => {
        for (const [id, sz] of changed) {
          d.items[id].h = Math.round(sz.h);
          d.items[id].w = Math.round(sz.w);
        }
      });
      // measurement is not a user action: no history, keep undo stacks pointing at equivalent boards
      set({ data: { ...s.data, boards: { ...s.data.boards, [next.id]: next } } });
    },

    deleteItems(ids, opts = {}) {
      const s = get();
      const b = activeBoard();
      const a = s.analysis;
      const del = new Set(ids.filter((id) => b.items[id]));
      if (opts.withSubtasks) for (const id of [...del]) for (const d of descendantsOf(a, id)) del.add(d);
      if (!del.size) return;
      const bridges = bridgeOnDelete(b, del);
      // children of deleted tasks move up to the nearest surviving ancestor
      const reparent: Link[] = [];
      for (const id of del) {
        const info = a.tasks.get(id);
        if (!info) continue;
        const newParent = info.ancestors.find((anc) => !del.has(anc)) ?? null;
        for (const c of info.childIds) if (!del.has(c) && newParent) reparent.push(makeLink('subtask', newParent, c));
      }
      const count = del.size;
      get().mutate((d) => {
        for (const id of del) delete d.items[id];
        for (const l of Object.values(d.links)) if (del.has(l.source) || del.has(l.target)) delete d.links[l.id];
        for (const l of [...bridges, ...reparent]) {
          const r = checkLink(d, l.type, l.source, l.target);
          if (r.ok) d.links[l.id] = l;
        }
        for (const it of Object.values(d.items)) if (it.frameId && del.has(it.frameId)) it.frameId = null;
        recomputeFrames(d);
      });
      get().setUI({ selection: [], selectedLinks: [], editingId: null });
      s.toast(`Deleted ${count} item${count > 1 ? 's' : ''}`, 'info', { label: 'Undo', run: () => get().undo() });
    },

    copy(ids) {
      const b = activeBoard();
      const set_ = new Set(ids);
      // include frame members when copying a frame
      for (const id of ids) if (b.items[id]?.kind === 'frame') frameMembers(b, id).forEach((m) => set_.add(m));
      const items = [...set_].map((id) => b.items[id]).filter(Boolean);
      const links = Object.values(b.links).filter((l) => set_.has(l.source) && set_.has(l.target));
      set({ clipboard: { items: structuredClone(items), links: structuredClone(links) } });
    },

    paste(at) {
      const cb = get().clipboard;
      if (!cb || !cb.items.length) return;
      const map = new Map<ID, ID>();
      const bounds = boundsOf(cb.items)!;
      const dx = at ? at.x - bounds.x : 32;
      const dy = at ? at.y - bounds.y : 32;
      const items = cb.items.map((it) => {
        const id = uid(it.id.slice(0, 2));
        map.set(it.id, id);
        return { ...structuredClone(it), id, x: it.x + dx, y: it.y + dy, createdAt: Date.now(), updatedAt: Date.now() };
      });
      for (const it of items) if (it.frameId) it.frameId = map.get(it.frameId) ?? it.frameId;
      const links = cb.links.map((l) => ({ ...l, id: uid('l_'), source: map.get(l.source)!, target: map.get(l.target)! }));
      get().mutate((d) => {
        for (const it of items) d.items[it.id] = it as Item;
        for (const l of links) d.links[l.id] = l;
        recomputeFrames(d, items.map((i) => i.id));
      });
      // shift clipboard so repeated pastes cascade
      set({ clipboard: { items: cb.items.map((i) => ({ ...i, x: i.x + 32, y: i.y + 32 })), links: cb.links } });
      get().setUI({ selection: items.map((i) => i.id), selectedLinks: [] });
    },

    duplicate(ids) {
      const prev = get().clipboard;
      get().copy(ids);
      get().paste();
      set({ clipboard: prev });
    },

    convert(id, kind) {
      const b = activeBoard();
      const it = b.items[id];
      if (!it) return;
      if (kind === 'task' && it.kind !== 'task') {
        const text = it.kind === 'frame' ? it.title : it.text;
        const [first, ...rest] = (text || '').split('\n');
        const t = makeTask({
          id: it.id,
          x: it.x,
          y: it.y,
          title: first.trim(),
          description: rest.join('\n').trim(),
          color: it.kind === 'note' ? null : it.color,
          frameId: it.frameId,
        });
        get().mutate((d) => {
          d.items[id] = t;
          for (const l of Object.values(d.links)) {
            if (l.source !== id && l.target !== id) continue;
            if (l.type === 'annotates') l.type = 'relates';
          }
        });
        get().setUI({ editingId: null });
      } else if (kind === 'note' && isTask(it)) {
        const info = get().analysis.tasks.get(id)!;
        if (info.childIds.length || info.parentId || info.prereqs.length || info.dependents.length) {
          get().toast('Only tasks without subtasks, parent or dependencies can become notes.', 'error');
          return;
        }
        const n = makeNote({
          id,
          x: it.x,
          y: it.y,
          text: [it.title, it.description].filter(Boolean).join('\n\n'),
          frameId: it.frameId,
        });
        get().mutate((d) => {
          d.items[id] = n;
          for (const l of Object.values(d.links)) {
            if (l.source !== id && l.target !== id) continue;
            if (l.type === 'soft') delete d.links[l.id];
          }
        });
      }
    },

    wrapInFrame(ids) {
      const b = activeBoard();
      const items = ids.map((id) => b.items[id]).filter(Boolean);
      const bb = boundsOf(items);
      if (!bb) return;
      const f = makeFrame({ x: bb.x - 32, y: bb.y - 64, w: bb.w + 64, h: bb.h + 96, title: 'New area' });
      get().mutate((d) => {
        d.items[f.id] = f;
        recomputeFrames(d);
      });
      get().setUI({ selection: [f.id], editingId: f.id });
    },

    align(ids, how) {
      const b = activeBoard();
      const items = ids.map((id) => b.items[id]).filter((i) => i && i.kind !== 'frame');
      const bb = boundsOf(items);
      if (!bb || items.length < 2) return;
      get().mutate((d) => {
        for (const it of items) {
          const di = d.items[it.id];
          if (how === 'left') di.x = bb.x;
          if (how === 'right') di.x = bb.x + bb.w - it.w;
          if (how === 'hcenter') di.x = bb.x + bb.w / 2 - it.w / 2;
          if (how === 'top') di.y = bb.y;
          if (how === 'bottom') di.y = bb.y + bb.h - it.h;
          if (how === 'vcenter') di.y = bb.y + bb.h / 2 - it.h / 2;
        }
        recomputeFrames(d, ids);
      });
    },

    distribute(ids, axis) {
      const b = activeBoard();
      const items = ids.map((id) => b.items[id]).filter((i) => i && i.kind !== 'frame');
      if (items.length < 3) return;
      const sorted = [...items].sort((p, q) => (axis === 'h' ? p.x - q.x : p.y - q.y));
      const total = sorted.reduce((s, i) => s + (axis === 'h' ? i.w : i.h), 0);
      const first = sorted[0];
      const last = sorted[sorted.length - 1];
      const span = axis === 'h' ? last.x + last.w - first.x : last.y + last.h - first.y;
      const gap = (span - total) / (sorted.length - 1);
      get().mutate((d) => {
        let cur = axis === 'h' ? first.x : first.y;
        for (const it of sorted) {
          if (axis === 'h') d.items[it.id].x = cur;
          else d.items[it.id].y = cur;
          cur += (axis === 'h' ? it.w : it.h) + gap;
        }
      });
    },

    layout(mode, ids) {
      const s = get();
      const b = activeBoard();
      const pos = computeLayout(b, s.analysis, mode, ids && ids.length > 1 ? ids : null);
      get().mutate((d) => {
        for (const [id, p] of Object.entries(pos)) {
          d.items[id].x = p.x;
          d.items[id].y = p.y;
        }
        // grow frames to fit their members
        for (const f of Object.values(d.items)) {
          if (f.kind !== 'frame') continue;
          const members = Object.values(d.items).filter((i) => i.frameId === f.id);
          const bb = boundsOf(members);
          if (!bb) continue;
          const right = Math.max(f.x + f.w, bb.x + bb.w + 32);
          const bottom = Math.max(f.y + f.h, bb.y + bb.h + 32);
          f.w = right - f.x;
          f.h = bottom - f.y;
        }
      });
      s.toast(mode === 'tree' ? 'Arranged as tree' : 'Arranged as flow', 'success', { label: 'Undo', run: () => get().undo() });
    },

    toggleCollapse(id) {
      const it = activeBoard().items[id];
      if (!isTask(it)) return;
      get().updateItem<TaskItem>(id, { collapsed: !it.collapsed });
    },

    /* ---------------- task semantics ---------------- */

    setStatus(ids, status) {
      const s = get();
      const a = s.analysis;
      let derivedNotice = false;
      get().mutate((d) => {
        const setLeaf = (t: TaskItem, st: TaskStatus) => {
          if (t.status === st) return;
          t.status = st;
          t.completedAt = st === 'done' ? Date.now() : null;
          t.updatedAt = Date.now();
        };
        for (const id of ids) {
          const t = d.items[id];
          const info = a.tasks.get(id);
          if (!isTask(t) || !info) continue;
          if (info.composite) {
            if (status === 'dropped') setLeaf(t, 'dropped');
            else {
              if (t.status === 'dropped') setLeaf(t, 'todo');
              if (status === 'done') {
                for (const dsc of descendantsOf(a, id)) {
                  const dt = d.items[dsc];
                  const di = a.tasks.get(dsc);
                  if (isTask(dt) && di && !di.composite && !di.gated && di.status !== 'dropped') setLeaf(dt, 'done');
                }
              } else if (info.status !== 'dropped') derivedNotice = true;
            }
          } else if (info.gated) {
            if (status === 'dropped') setLeaf(t, 'dropped');
            else if (t.status === 'dropped') setLeaf(t, 'todo');
            else derivedNotice = true;
          } else setLeaf(t, status);
        }
      });
      if (derivedNotice && ids.length === 1)
        s.toast('This status is derived — it follows the subtasks / prerequisites.', 'info');
    },

    toggleDone(ids) {
      const a = get().analysis;
      const tasks = ids.filter((id) => a.tasks.has(id));
      if (!tasks.length) return;
      const allDone = tasks.every((id) => a.tasks.get(id)!.status === 'done');
      if (allDone) {
        // reopen leaves only (composites reopen through their parts)
        const leaves = tasks.filter((id) => !a.tasks.get(id)!.composite && !a.tasks.get(id)!.gated);
        if (leaves.length) get().setStatus(leaves, 'todo');
        else get().toast('Reopen one of its subtasks to reopen this task.', 'info');
      } else get().setStatus(tasks, 'done');
    },

    cycleStatus(id) {
      const info = get().analysis.tasks.get(id);
      if (!info) return;
      const order: TaskStatus[] = ['todo', 'doing', 'done'];
      const t = activeBoard().items[id] as TaskItem;
      const cur = info.composite || info.gated ? info.status : t.status;
      const i = order.indexOf(cur);
      get().setStatus([id], order[(i + 1) % order.length] ?? 'todo');
    },

    setParent(childId, parentId, index) {
      const s = get();
      const b = activeBoard();
      const a = s.analysis;
      const info = a.tasks.get(childId);
      if (!info) return false;
      const existing = info.parentLinkId;
      if (parentId === null) {
        const sibs = siblingsOf(b, a, null);
        const order = index !== undefined ? orderAt(sibs.filter((x) => x.id !== childId), index) : orderAfter(sibs, info.ancestors[info.ancestors.length - 1]);
        get().mutate((d) => {
          if (existing) delete d.links[existing];
          (d.items[childId] as TaskItem).order = order;
        });
        return true;
      }
      if (info.parentId === parentId) {
        const same = siblingsOf(b, a, parentId).filter((x) => x.id !== childId);
        const o = index !== undefined ? orderAt(same, index) : orderAfter(same);
        get().mutate((d) => {
          (d.items[childId] as TaskItem).order = o;
        });
        return true;
      }
      const r = checkLink(b, 'subtask', parentId, childId);
      if (!r.ok) {
        s.toast(r.reason, 'error');
        return false;
      }
      const sibs = siblingsOf(b, a, parentId).filter((x) => x.id !== childId);
      const order = index !== undefined ? orderAt(sibs, index) : orderAfter(sibs);
      const l = makeLink('subtask', parentId, childId);
      get().mutate((d) => {
        for (const id of r.replaces) delete d.links[id];
        d.links[l.id] = l;
        (d.items[childId] as TaskItem).order = order;
      });
      return true;
    },

    indent(id) {
      const s = get();
      const b = activeBoard();
      const info = s.analysis.tasks.get(id);
      if (!info) return false;
      const t = b.items[id] as TaskItem;
      const sibs = siblingsOf(b, s.analysis, info.parentId, info.parentId ? undefined : t.frameId);
      const i = sibs.findIndex((x) => x.id === id);
      if (i <= 0) return false;
      const newParent = sibs[i - 1];
      if (newParent.milestone) {
        s.toast('Milestones can’t have subtasks.', 'error');
        return false;
      }
      const ok = get().setParent(id, newParent.id);
      if (ok && newParent.collapsed) get().updateItem<TaskItem>(newParent.id, { collapsed: false });
      return ok;
    },

    outdent(id) {
      const s = get();
      const b = activeBoard();
      const info = s.analysis.tasks.get(id);
      if (!info?.parentId) return false;
      const parentInfo = s.analysis.tasks.get(info.parentId)!;
      const grand = parentInfo.parentId;
      const sibs = siblingsOf(b, s.analysis, grand).filter((x) => x.id !== id);
      const pi = sibs.findIndex((x) => x.id === info.parentId);
      const order = orderAt(sibs, pi + 1);
      if (grand) {
        const r = checkLink(b, 'subtask', grand, id);
        if (!r.ok) {
          s.toast(r.reason, 'error');
          return false;
        }
        const l = makeLink('subtask', grand, id);
        get().mutate((d) => {
          for (const x of r.replaces) delete d.links[x];
          d.links[l.id] = l;
          (d.items[id] as TaskItem).order = order;
        });
      } else {
        get().mutate((d) => {
          if (info.parentLinkId) delete d.links[info.parentLinkId];
          (d.items[id] as TaskItem).order = order;
        });
      }
      return true;
    },

    moveSibling(id, dir) {
      const s = get();
      const b = activeBoard();
      const info = s.analysis.tasks.get(id);
      if (!info) return;
      const t = b.items[id] as TaskItem;
      const sibs = siblingsOf(b, s.analysis, info.parentId, info.parentId ? undefined : t.frameId);
      const i = sibs.findIndex((x) => x.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= sibs.length) return;
      const other = sibs[j];
      get().mutate((d) => {
        const a1 = d.items[id] as TaskItem;
        const a2 = d.items[other.id] as TaskItem;
        const tmp = a1.order;
        a1.order = a2.order;
        a2.order = tmp;
        if (a1.order === a2.order) a1.order += dir * 0.5;
      });
    },

    /* ---------------- links ---------------- */

    connect(mode, source, target) {
      const s = get();
      const b = activeBoard();
      const type = resolveLinkType(b, mode, source, target);
      const r = checkLink(b, type, source, target);
      if (!r.ok) {
        s.toast(r.reason, 'error');
        return null;
      }
      const l = makeLink(r.type, r.source, r.target);
      const sibs = r.type === 'subtask' ? siblingsOf(b, s.analysis, r.source) : [];
      get().mutate((d) => {
        for (const id of r.replaces) delete d.links[id];
        d.links[l.id] = l;
        if (r.type === 'subtask') (d.items[r.target] as TaskItem).order = orderAfter(sibs.filter((x) => x.id !== r.target));
      });
      if (r.notice) s.toast(r.notice);
      return l.id;
    },

    updateLink(id, patch) {
      get().mutate(
        (d) => {
          const l = d.links[id];
          if (l) Object.assign(l, patch);
        },
        { coalesce: `link:${id}:${Object.keys(patch).join(',')}` },
      );
    },

    changeLinkType(id, type) {
      const s = get();
      const b = activeBoard();
      const l = b.links[id];
      if (!l || l.type === type) return;
      const r = checkLink(b, type, l.source, l.target, id);
      if (!r.ok) {
        s.toast(r.reason, 'error');
        return;
      }
      get().mutate((d) => {
        for (const x of r.replaces) if (x !== id) delete d.links[x];
        const dl = d.links[id];
        dl.type = r.type;
        dl.source = r.source;
        dl.target = r.target;
        if (r.type === 'line' && dl.arrow === 'none') dl.arrow = 'end';
      });
      if (r.notice) s.toast(r.notice);
    },

    reverseLink(id) {
      const s = get();
      const b = activeBoard();
      const l = b.links[id];
      if (!l) return;
      if (l.type === 'annotates') return;
      const r = checkLink(b, l.type, l.target, l.source, id);
      if (!r.ok) {
        s.toast(r.reason, 'error');
        return;
      }
      get().mutate((d) => {
        for (const x of r.replaces) if (x !== id) delete d.links[x];
        d.links[id].source = r.source;
        d.links[id].target = r.target;
      });
    },

    deleteLinks(ids) {
      get().mutate((d) => {
        for (const id of ids) delete d.links[id];
      });
      get().setUI({ selectedLinks: [] });
    },

    removeRelation(type, source, target) {
      const b = activeBoard();
      const ids = Object.values(b.links)
        .filter(
          (l) =>
            l.type === type &&
            ((l.source === source && l.target === target) ||
              ((type === 'relates' || type === 'annotates') && l.source === target && l.target === source)),
        )
        .map((l) => l.id);
      if (ids.length) get().deleteLinks(ids);
    },

    /* ---------------- boards ---------------- */

    createBoard(name, sample) {
      const b = sample ? createSampleBoard() : makeBoard(name || 'Untitled board');
      const s = get();
      set({
        data: {
          ...s.data,
          boards: { ...s.data.boards, [b.id]: b },
          boardOrder: [...s.data.boardOrder, b.id],
          activeBoardId: b.id,
        },
        analysis: analyze(b),
        past: [],
        future: [],
        ui: { ...s.ui, selection: [], selectedLinks: [], editingId: null },
      });
    },

    switchBoard(id) {
      const s = get();
      if (!s.data.boards[id] || id === s.data.activeBoardId) return;
      set({
        data: { ...s.data, activeBoardId: id },
        analysis: analyze(s.data.boards[id]),
        past: [],
        future: [],
        ui: { ...s.ui, selection: [], selectedLinks: [], editingId: null },
      });
    },

    renameBoard(id, name) {
      const s = get();
      const b = s.data.boards[id];
      if (!b) return;
      set({ data: { ...s.data, boards: { ...s.data.boards, [id]: { ...b, name } } } });
    },

    deleteBoard(id) {
      const s = get();
      const order = s.data.boardOrder.filter((x) => x !== id);
      const boards = { ...s.data.boards };
      delete boards[id];
      if (!order.length) {
        const nb = makeBoard('My board');
        boards[nb.id] = nb;
        order.push(nb.id);
      }
      const active = s.data.activeBoardId === id ? order[0] : s.data.activeBoardId;
      set({
        data: { ...s.data, boards, boardOrder: order, activeBoardId: active },
        analysis: analyze(boards[active]),
        past: s.data.activeBoardId === id ? [] : s.past,
        future: s.data.activeBoardId === id ? [] : s.future,
      });
    },

    duplicateBoard(id) {
      const s = get();
      const src = s.data.boards[id];
      if (!src) return;
      const copy = remapBoard(structuredClone(src));
      copy.name = `${src.name} (copy)`;
      set({
        data: {
          ...s.data,
          boards: { ...s.data.boards, [copy.id]: copy },
          boardOrder: [...s.data.boardOrder, copy.id],
          activeBoardId: copy.id,
        },
        analysis: analyze(copy),
        past: [],
        future: [],
      });
    },

    importData(raw) {
      const s = get();
      const incoming: Board[] = [];
      const r = raw as Partial<AppData> & Partial<Board>;
      if (r && r.boards && typeof r.boards === 'object') incoming.push(...Object.values(r.boards as Record<string, Board>));
      else if (r && r.items && r.links) incoming.push(r as Board);
      const valid = incoming.filter((b) => b && b.items && b.links).map((b) => remapBoard(normalizeBoard(structuredClone(b))));
      if (!valid.length) {
        s.toast('That file doesn’t look like a Todo Diagrams export.', 'error');
        return;
      }
      const boards = { ...s.data.boards };
      for (const b of valid) boards[b.id] = b;
      set({
        data: {
          ...s.data,
          boards,
          boardOrder: [...s.data.boardOrder, ...valid.map((b) => b.id)],
          activeBoardId: valid[0].id,
        },
        analysis: analyze(valid[0]),
        past: [],
        future: [],
      });
      s.toast(`Imported ${valid.length} board${valid.length > 1 ? 's' : ''}`, 'success');
    },

    setViewport(vp) {
      const s = get();
      const b = activeBoard();
      set({ data: { ...s.data, boards: { ...s.data.boards, [b.id]: { ...b, viewport: vp } } } });
    },
  };
});

function orderAt(sibs: TaskItem[], index: number): number {
  if (!sibs.length) return 1;
  if (index <= 0) return sibs[0].order - 1;
  if (index >= sibs.length) return sibs[sibs.length - 1].order + 1;
  return (sibs[index - 1].order + sibs[index].order) / 2;
}

/** Give a board (and everything in it) fresh ids so it can coexist with the original. */
function remapBoard(b: Board): Board {
  const map = new Map<ID, ID>();
  const items: Record<ID, Item> = {};
  for (const it of Object.values(b.items)) {
    const id = uid(it.id.slice(0, 2));
    map.set(it.id, id);
    items[id] = { ...it, id };
  }
  for (const it of Object.values(items)) if (it.frameId) it.frameId = map.get(it.frameId) ?? null;
  const links: Record<ID, Link> = {};
  for (const l of Object.values(b.links)) {
    if (!map.has(l.source) || !map.has(l.target)) continue;
    const id = uid('l_');
    links[id] = { ...l, id, source: map.get(l.source)!, target: map.get(l.target)! };
  }
  return { ...b, id: uid('b_'), items, links, createdAt: Date.now(), updatedAt: Date.now() };
}

/** Fill in defaults for older / hand-written files. */
function normalizeBoard(b: Board): Board {
  const out = makeBoard(b.name || 'Imported board');
  out.viewport = b.viewport ?? null;
  for (const it of Object.values(b.items)) {
    let n: Item;
    switch (it.kind) {
      case 'task':
        n = makeTask(it);
        break;
      case 'note':
        n = makeNote(it);
        break;
      case 'shape':
        n = makeShape(it.shape, it);
        break;
      case 'frame':
        n = makeFrame(it);
        break;
      case 'text':
        n = makeText(it);
        break;
      default:
        continue;
    }
    out.items[n.id] = n;
  }
  for (const l of Object.values(b.links)) out.links[l.id] = makeLink(l.type, l.source, l.target, l);
  return out;
}

export { titleOf, TASK_W };
