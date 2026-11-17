import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  Controls,
  MiniMap,
  ReactFlow,
  SelectionMode,
  useReactFlow,
  type Connection,
  type EdgeChange,
  type FinalConnectionState,
  type NodeChange,
  type OnConnectStartParams,
} from '@xyflow/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { descendantsOf, focusSet, type Analysis } from '../model/engine';
import { makeShape } from '../model/factory';
import { titleOf } from '../model/rules';
import type { Board, ID, Item, LinkType, ShapeType, TaskItem } from '../model/types';
import { isTask } from '../model/types';
import { useStore, type UIState } from '../store/store';
import { isTypingTarget } from '../ui/common';
import { ContextMenu, type MenuState, type MenuTarget } from './ContextMenu';
import { LinkEdge, type EdgeTone, type LinkEdgeType } from './edges/LinkEdge';
import { nodeTypes, type ItemNode } from './nodes';
import { CanvasToolbar } from './Toolbar';

const edgeTypes = { link: LinkEdge };
const LINK_KEYS: LinkType[] = ['depends', 'soft', 'subtask', 'relates', 'line'];

/* ------------------------------------------------------------------ */
/* Board → React Flow graph                                             */
/* ------------------------------------------------------------------ */

function buildGraph(
  board: Board,
  a: Analysis,
  ui: Pick<UIState, 'selection' | 'selectedLinks' | 'completed' | 'focusMode' | 'showCritical'>,
): { nodes: ItemNode[]; edges: LinkEdgeType[] } {
  const items = Object.values(board.items);
  const sel = new Set(ui.selection);
  const selLinks = new Set(ui.selectedLinks);

  // hidden by collapsed ancestors → represented by the topmost collapsed ancestor
  const repOf = new Map<ID, ID>();
  const hidden = new Set<ID>();
  for (const [id, info] of a.tasks) {
    let rep: ID | null = null;
    for (const anc of info.ancestors) if ((board.items[anc] as TaskItem).collapsed) rep = anc;
    if (rep) {
      hidden.add(id);
      repOf.set(id, rep);
    }
  }
  if (ui.completed === 'hide') {
    for (const [id, info] of a.tasks) if (info.resolved && !sel.has(id)) hidden.add(id);
  }

  const focus = sel.size === 1 ? focusSet(a, board, ui.selection[0]) : null;
  const dimOf = (id: ID) => !!(ui.focusMode && focus && !focus.items.has(id));

  // frame nesting depth for z-order
  const frameDepth = (it: Item) => {
    let d = 0;
    let cur = it.frameId;
    const guard = new Set<ID>();
    while (cur && !guard.has(cur)) {
      guard.add(cur);
      d++;
      cur = board.items[cur]?.frameId ?? null;
    }
    return d;
  };

  const frameStats = new Map<ID, { done: number; total: number }>();
  for (const it of items) {
    if (!isTask(it) || !it.frameId) continue;
    const info = a.tasks.get(it.id)!;
    if (info.composite || info.status === 'dropped') continue;
    const st = frameStats.get(it.frameId) ?? { done: 0, total: 0 };
    st.total++;
    if (info.status === 'done') st.done++;
    frameStats.set(it.frameId, st);
  }

  const nodes: ItemNode[] = [];
  const sorted = [...items].sort((p, q) => {
    if (p.kind === 'frame' && q.kind !== 'frame') return -1;
    if (q.kind === 'frame' && p.kind !== 'frame') return 1;
    if (p.kind === 'frame' && q.kind === 'frame') return q.w * q.h - p.w * p.h;
    return 0;
  });
  for (const it of sorted) {
    if (hidden.has(it.id)) continue;
    const info = isTask(it) ? a.tasks.get(it.id) : undefined;
    const fixed = it.kind !== 'task';
    nodes.push({
      id: it.id,
      type: it.kind,
      position: { x: it.x, y: it.y },
      data: {
        item: it,
        info,
        dim: dimOf(it.id),
        faded: ui.completed === 'fade' && !!info?.resolved,
        critical: !!info?.critical,
        hiddenCount: info && (it as TaskItem).collapsed ? descendantsOf(a, it.id).length : 0,
        frameStats: it.kind === 'frame' ? frameStats.get(it.id) : undefined,
        blockerNames: info?.blockers.filter((b) => !b.via).map((b) => titleOf(board.items[b.id])),
      },
      selected: sel.has(it.id),
      width: it.w,
      height: fixed ? it.h : undefined,
      measured: { width: it.w, height: it.h },
      zIndex: it.kind === 'frame' ? -1000 + frameDepth(it) : undefined,
      dragHandle: it.kind === 'frame' ? '.frame-header' : undefined,
      className: `kind-${it.kind}`,
    });
  }

  const visible = (id: ID): ID | null => {
    if (!board.items[id]) return null;
    if (!hidden.has(id)) return id;
    const r = repOf.get(id);
    return r && !hidden.has(r) ? r : null;
  };

  const edges: LinkEdgeType[] = [];
  const merged = new Map<string, LinkEdgeType>();
  for (const l of Object.values(board.links)) {
    const s = visible(l.source);
    const t = visible(l.target);
    if (!s || !t || s === t) continue;
    const rerouted = s !== l.source || t !== l.target;
    let tone: EdgeTone = 'line';
    const si = a.tasks.get(l.source);
    const ti = a.tasks.get(l.target);
    if (l.type === 'depends') tone = si?.resolved ? (ti?.resolved ? 'muted' : 'ok') : 'wait';
    else if (l.type === 'soft') tone = si?.resolved ? 'soft-ok' : 'soft';
    else if (l.type === 'subtask') tone = 'tree';
    else if (l.type === 'annotates') tone = 'note';
    else if (l.type === 'relates') tone = 'rel';
    const edge: LinkEdgeType = {
      id: l.id,
      source: s,
      target: t,
      type: 'link',
      selected: selLinks.has(l.id),
      data: {
        link: l,
        tone,
        viaCollapsed: rerouted,
        critical: ui.showCritical && a.criticalLinks.has(l.id),
        highlight: !!focus?.links.has(l.id),
        dim: !!(ui.focusMode && focus && !focus.links.has(l.id)),
        count: 1,
      },
      zIndex: 0,
    };
    if (rerouted) {
      const key = `${l.type}:${s}>${t}`;
      const prev = merged.get(key);
      if (prev) {
        prev.data!.count++;
        continue;
      }
      merged.set(key, edge);
    }
    edges.push(edge);
  }
  return { nodes, edges };
}

/* ------------------------------------------------------------------ */

export function Canvas() {
  const board = useStore((s) => s.board());
  const analysis = useStore((s) => s.analysis);
  const selection = useStore((s) => s.ui.selection);
  const selectedLinks = useStore((s) => s.ui.selectedLinks);
  const completed = useStore((s) => s.ui.completed);
  const focusMode = useStore((s) => s.ui.focusMode);
  const showCritical = useStore((s) => s.ui.showCritical);
  const showMinimap = useStore((s) => s.ui.showMinimap);
  const snapToGrid = useStore((s) => s.ui.snapToGrid);
  const linkMode = useStore((s) => s.ui.linkMode);
  const centerRequest = useStore((s) => s.ui.centerRequest);
  const theme = useStore((s) => s.ui.theme);
  const rf = useReactFlow();
  const wrapper = useRef<HTMLDivElement>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const connectFrom = useRef<OnConnectStartParams | null>(null);
  const connected = useRef(false);
  const rightDown = useRef<{ x: number; y: number } | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [tool, setTool] = useState<'select' | 'hand'>('select');

  const { nodes, edges } = useMemo(
    () => buildGraph(board, analysis, { selection, selectedLinks, completed, focusMode, showCritical }),
    [board, analysis, selection, selectedLinks, completed, focusMode, showCritical],
  );

  /* ---------------- helpers ---------------- */

  const viewCenter = useCallback(() => {
    const el = wrapper.current;
    if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    return rf.screenToFlowPosition({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
  }, [rf]);

  const placePoint = useCallback(() => pointer.current ?? viewCenter(), [viewCenter]);

  /* ---------------- center requests ---------------- */

  useEffect(() => {
    if (!centerRequest) return;
    const it = useStore.getState().board().items[centerRequest.id];
    if (!it) return;
    const zoom = Math.max(rf.getZoom(), 0.85);
    // wait a frame so newly visible nodes are rendered
    requestAnimationFrame(() => rf.setCenter(it.x + it.w / 2, it.y + Math.min(it.h, 200) / 2, { zoom, duration: 450 }));
  }, [centerRequest, rf]);

  /* ---------------- change handlers ---------------- */

  const onNodesChange = useCallback((changes: NodeChange<ItemNode>[]) => {
    const st = useStore.getState();
    const b = st.board();
    const positions: Record<ID, { x: number; y: number }> = {};
    const measures: Record<ID, { w: number; h: number }> = {};
    const resizes: Record<ID, { w: number; h: number }> = {};
    let sel: Set<ID> | null = null;
    for (const c of changes) {
      if (c.type === 'position' && c.position) positions[c.id] = c.position;
      else if (c.type === 'dimensions' && c.dimensions) {
        if (c.resizing !== undefined) resizes[c.id] = { w: c.dimensions.width, h: c.dimensions.height };
        else if (b.items[c.id]?.kind === 'task') measures[c.id] = { w: c.dimensions.width, h: c.dimensions.height };
      } else if (c.type === 'select') {
        sel ??= new Set(st.ui.selection);
        if (c.selected) sel.add(c.id);
        else sel.delete(c.id);
      }
    }
    for (const [id, r] of Object.entries(resizes)) {
      const it = b.items[id];
      if (!it) continue;
      const p = positions[id] ?? { x: it.x, y: it.y };
      delete positions[id];
      st.resizeItem(id, { x: p.x, y: p.y, w: r.w, h: r.h });
    }
    if (Object.keys(positions).length) st.moveItems(positions);
    if (Object.keys(measures).length) st.measureItems(measures);
    if (sel) {
      const next = [...sel];
      const cur = st.ui.selection;
      if (next.length !== cur.length || next.some((x) => !cur.includes(x))) st.setUI({ selection: next });
    }
  }, []);

  const onEdgesChange = useCallback((changes: EdgeChange<LinkEdgeType>[]) => {
    const st = useStore.getState();
    let sel: Set<ID> | null = null;
    for (const c of changes) {
      if (c.type === 'select') {
        sel ??= new Set(st.ui.selectedLinks);
        if (c.selected) sel.add(c.id);
        else sel.delete(c.id);
      }
    }
    if (sel) {
      const next = [...sel];
      const cur = st.ui.selectedLinks;
      if (next.length !== cur.length || next.some((x) => !cur.includes(x))) st.setUI({ selectedLinks: next });
    }
  }, []);

  const onConnect = useCallback((c: Connection) => {
    connected.current = true;
    const st = useStore.getState();
    if (c.source && c.target && c.source !== c.target) {
      const id = st.connect(st.ui.linkMode, c.source, c.target);
      if (id) st.select([], [id]);
    }
  }, []);

  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, state: FinalConnectionState) => {
      const from = connectFrom.current?.nodeId;
      connectFrom.current = null;
      if (connected.current || state.isValid || !from) return;
      const st = useStore.getState();
      const pt = 'changedTouches' in event ? event.changedTouches[0] : (event as MouseEvent);
      const el = document.elementFromPoint(pt.clientX, pt.clientY)?.closest('.react-flow__node');
      const targetId = el?.getAttribute('data-id');
      if (targetId && targetId !== from) {
        const id = st.connect(st.ui.linkMode, from, targetId);
        if (id) st.select([], [id]);
        return;
      }
      if (targetId) return;
      // dropped on empty canvas → create a connected item there
      const b = st.board();
      const src = b.items[from];
      if (!src) return;
      const p = rf.screenToFlowPosition({ x: pt.clientX, y: pt.clientY });
      st.beginGesture();
      if (src.kind === 'shape') {
        const sh = makeShape(src.shape, { color: src.color, w: src.w, h: src.h, stroke: src.stroke });
        sh.x = p.x - sh.w / 2;
        sh.y = p.y - sh.h / 2;
        const id = st.addItem(sh, { edit: true });
        st.connect('line', from, id);
      } else if (src.kind === 'task' || src.kind === 'note') {
        const mode = st.ui.linkMode;
        const id = st.addTask({
          at: { x: p.x - 40, y: p.y - 22 },
          edit: 'canvas',
          patch: mode === 'subtask' && isTask(src) ? { color: src.color } : {},
        });
        if (src.kind === 'note') st.connect('annotates', from, id);
        else st.connect(mode, from, id);
        st.setUI({ selection: [id], selectedLinks: [], editingId: id });
      }
      st.endGesture();
    },
    [rf],
  );

  /* ---------------- pointer & menus ---------------- */

  const onPointerMove = (e: React.PointerEvent) => {
    pointer.current = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
  };

  const openMenu = (e: React.MouseEvent | MouseEvent, m: MenuTarget) => {
    e.preventDefault();
    const rd = rightDown.current;
    if (rd && Math.hypot(e.clientX - rd.x, e.clientY - rd.y) > 6) return; // was a right-drag pan
    setMenu({ ...m, x: e.clientX, y: e.clientY, flow: rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }) } as MenuState);
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (!target.classList.contains('react-flow__pane')) return;
    const p = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    useStore.getState().addTask({ at: { x: p.x - 124, y: p.y - 24 }, edit: 'canvas' });
  };

  /* ---------------- keyboard (canvas-specific) ---------------- */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = useStore.getState();
      const ui = st.ui;
      if (isTypingTarget(e.target) || ui.paletteOpen || ui.helpOpen) return;
      if (ui.view === 'list' || (ui.view === 'split' && activePane.current !== 'canvas')) return;
      const mod = e.ctrlKey || e.metaKey;
      const sel = ui.selection;
      const b = st.board();
      const single = sel.length === 1 ? b.items[sel[0]] : null;
      const at = () => {
        const p = placePoint();
        return { x: p.x, y: p.y };
      };
      const k = e.key;

      if (mod && k.toLowerCase() === 'c') {
        if (sel.length) st.copy(sel);
        return;
      }
      if (mod && k.toLowerCase() === 'v') {
        e.preventDefault();
        st.paste(pointer.current ?? undefined);
        return;
      }
      if (mod && k.toLowerCase() === 'd') {
        e.preventDefault();
        if (sel.length) st.duplicate(sel);
        return;
      }
      if (mod && k === 'Enter' && single && isTask(single)) {
        e.preventDefault();
        st.addTask({ nextOf: single.id, edit: 'canvas' });
        return;
      }
      if (mod || e.altKey) return;

      if (k === 'Tab' && single && isTask(single)) {
        e.preventDefault();
        if (single.milestone) return st.toast('Milestones can’t have subtasks.', 'error');
        st.addTask({ parentId: single.id, edit: 'canvas' });
        return;
      }
      if (k === 'Enter' && e.shiftKey && single && isTask(single)) {
        e.preventDefault();
        st.addTask({ after: single.id, edit: 'canvas' });
        return;
      }
      if (k === 'Enter' && single) {
        e.preventDefault();
        st.setUI({ editingId: single.id });
        return;
      }
      if (k.startsWith('Arrow') && sel.length) {
        e.preventDefault();
        const d = e.shiftKey ? 16 : 2;
        const dx = k === 'ArrowLeft' ? -d : k === 'ArrowRight' ? d : 0;
        const dy = k === 'ArrowUp' ? -d : k === 'ArrowDown' ? d : 0;
        const pos: Record<ID, { x: number; y: number }> = {};
        for (const id of sel) if (b.items[id]) pos[id] = { x: b.items[id].x + dx, y: b.items[id].y + dy };
        st.beginGesture();
        st.moveItems(pos);
        st.endGesture();
        return;
      }
      if (e.shiftKey && k === '!') {
        rf.fitView({ duration: 400, padding: 0.15 });
        return;
      }
      if (e.shiftKey && k === '@') {
        if (sel.length) rf.fitView({ nodes: sel.map((id) => ({ id })), duration: 400, padding: 0.3, maxZoom: 1.4 });
        return;
      }
      if (e.shiftKey && (k === 'L' || k === 'W')) {
        st.layout(k === 'L' ? 'tree' : 'flow', sel);
        return;
      }
      if (e.shiftKey) return;
      const lower = k.toLowerCase();
      const idx = '12345'.indexOf(k);
      if (idx >= 0) {
        st.setUI({ linkMode: LINK_KEYS[idx] });
        return;
      }
      const shapeKeys: Record<string, ShapeType> = { r: 'rounded', o: 'ellipse', d: 'diamond' };
      switch (lower) {
        case 't': {
          const p = at();
          st.addTask({ at: { x: p.x - 124, y: p.y - 24 }, edit: 'canvas' });
          break;
        }
        case 'm': {
          const p = at();
          st.addTask({ at: { x: p.x - 100, y: p.y - 24 }, milestone: true, edit: 'canvas' });
          break;
        }
        case 'n':
          st.addNote(at(), single && isTask(single) ? single.id : undefined);
          break;
        case 'r':
        case 'o':
        case 'd':
          st.addShape(shapeKeys[lower], at());
          break;
        case 'a':
          if (sel.length) st.wrapInFrame(sel);
          else st.addFrame(at());
          break;
        case 'l':
          st.addText(at());
          break;
        case 'c':
          if (single && isTask(single)) st.toggleCollapse(single.id);
          break;
        case 'f':
          st.setUI({ focusMode: !ui.focusMode });
          break;
        case 'h':
          setTool('hand');
          break;
        case 'v':
          setTool('select');
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [placePoint, rf]);

  const activePane = useActivePane();

  return (
    <div
      className={`canvas-wrap tool-${tool} link-mode-${linkMode}`}
      ref={wrapper}
      onPointerMove={onPointerMove}
      onPointerDownCapture={(e) => {
        activePane.current = 'canvas';
        if (e.button === 2) rightDown.current = { x: e.clientX, y: e.clientY };
        setMenu(null);
      }}
      onDoubleClick={onDoubleClick}
      onContextMenu={(e) => e.preventDefault()}
    >
      <ReactFlow<ItemNode, LinkEdgeType>
        key={board.id}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onConnectStart={(_, p) => {
          connected.current = false;
          connectFrom.current = p;
        }}
        onConnectEnd={onConnectEnd}
        onNodeDragStart={() => useStore.getState().beginGesture()}
        onNodeDragStop={() => useStore.getState().endGesture()}
        onSelectionDragStart={() => useStore.getState().beginGesture()}
        onSelectionDragStop={() => useStore.getState().endGesture()}
        onNodeDoubleClick={(e, n) => {
          e.stopPropagation();
          useStore.getState().setUI({ editingId: n.id });
        }}
        onEdgeDoubleClick={(e, ed) => {
          e.stopPropagation();
          useStore.getState().setUI({ editingId: ed.id, selectedLinks: [ed.id] });
        }}
        onPaneContextMenu={(e) => openMenu(e, { kind: 'pane' })}
        onNodeContextMenu={(e, n) => {
          const st = useStore.getState();
          if (!st.ui.selection.includes(n.id)) st.select([n.id]);
          const sel = useStore.getState().ui.selection;
          openMenu(e, sel.length > 1 ? { kind: 'selection', ids: sel } : { kind: 'node', id: n.id });
        }}
        onSelectionContextMenu={(e) => openMenu(e, { kind: 'selection', ids: useStore.getState().ui.selection })}
        onEdgeContextMenu={(e, ed) => {
          useStore.getState().select([], [ed.id]);
          openMenu(e, { kind: 'edge', id: ed.id });
        }}
        onMoveEnd={(_, vp) => useStore.getState().setViewport(vp)}
        defaultViewport={board.viewport ?? undefined}
        fitView={!board.viewport}
        fitViewOptions={{ padding: 0.15, maxZoom: 1.1 }}
        minZoom={0.1}
        maxZoom={2.5}
        connectionMode={ConnectionMode.Loose}
        connectionRadius={28}
        connectionLineStyle={{ strokeWidth: 2, stroke: 'var(--accent)', strokeDasharray: linkMode === 'soft' || linkMode === 'relates' ? '6 5' : undefined }}
        snapToGrid={snapToGrid}
        snapGrid={[8, 8]}
        selectionOnDrag={tool === 'select'}
        selectionMode={SelectionMode.Partial}
        panOnDrag={tool === 'hand' ? true : [1, 2]}
        panOnScroll
        zoomOnScroll={false}
        zoomOnPinch
        zoomOnDoubleClick={false}
        deleteKeyCode={null}
        selectionKeyCode={null}
        multiSelectionKeyCode={['Shift', 'Meta', 'Control']}
        elevateEdgesOnSelect={false}
        elevateNodesOnSelect
        nodeDragThreshold={2}
        proOptions={{ hideAttribution: true }}
        colorMode={theme}
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1.2} className="canvas-bg" />
        <Controls showInteractive={false} position="bottom-left" />
        {showMinimap && (
          <MiniMap
            pannable
            zoomable
            position="bottom-right"
            className="minimap"
            nodeClassName={(n) => {
              const d = n.data as ItemNode['data'];
              if (d.info) return `mm-task st-${d.info.state}`;
              return `mm-${d.item.kind} c-${d.item.color ?? 'gray'}`;
            }}
            nodeBorderRadius={4}
          />
        )}
      </ReactFlow>
      <CanvasToolbar tool={tool} setTool={setTool} placePoint={viewCenter} />
      {menu && <ContextMenu menu={menu} onClose={() => setMenu(null)} />}
    </div>
  );
}

/* Which pane (canvas or list) the user last interacted with — keyboard routing in split view. */
const paneRef = { current: 'canvas' as 'canvas' | 'list' };
export function useActivePane() {
  return paneRef;
}
