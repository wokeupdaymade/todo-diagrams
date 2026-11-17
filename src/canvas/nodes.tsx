import {
  Handle,
  NodeResizeControl,
  NodeResizer,
  Position,
  ResizeControlVariant,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import { AlertTriangle, ChevronDown, ChevronRight, Clock, Diamond, ListChecks, StickyNote } from 'lucide-react';
import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { TaskInfo } from '../model/engine';
import type { FrameItem, Item, NoteItem, ShapeItem, TaskItem, TextItem } from '../model/types';
import { useStore } from '../store/store';
import { formatDue, formatHours, Markdown, PriorityFlag, StateBadge, StatusCheck } from '../ui/common';

export interface ItemNodeData extends Record<string, unknown> {
  item: Item;
  info?: TaskInfo;
  dim: boolean;
  faded: boolean;
  critical: boolean;
  hiddenCount: number;
  frameStats?: { done: number; total: number };
  blockerNames?: string[];
}
export type ItemNode = Node<ItemNodeData>;

const SIDES = [Position.Top, Position.Right, Position.Bottom, Position.Left];

function Handles() {
  return (
    <>
      {SIDES.map((p) => (
        <Handle key={p} id={p} type="source" position={p} className="h-dot" />
      ))}
    </>
  );
}

const gesture = {
  onResizeStart: () => useStore.getState().beginGesture(),
  onResizeEnd: () => useStore.getState().endGesture(),
};

/* ---------------- inline text editor ---------------- */

function InlineEditor({
  value,
  onCommit,
  multiline,
  enterCommits = true,
  className,
  placeholder,
  onKey,
}: {
  value: string;
  onCommit: (v: string) => void;
  /** auto-grow and allow line breaks */
  multiline?: boolean;
  /** Enter commits (Shift+Enter inserts a line break). Notes keep Enter for new lines and commit with Ctrl+Enter. */
  enterCommits?: boolean;
  className?: string;
  placeholder?: string;
  onKey?: (e: React.KeyboardEvent<HTMLTextAreaElement>, value: string) => boolean;
}) {
  const [v, setV] = useState(value);
  const ref = useRef<HTMLTextAreaElement>(null);
  const done = useRef(false);
  const setUI = useStore((s) => s.setUI);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.select();
  }, []);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !multiline) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [v, multiline]);
  const commit = () => {
    if (done.current) return;
    done.current = true;
    onCommit(v);
    setUI({ editingId: null });
  };
  return (
    <textarea
      ref={ref}
      className={`inline-editor nodrag nopan nowheel ${className ?? ''}`}
      value={v}
      rows={1}
      placeholder={placeholder}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (onKey && onKey(e, v)) {
          done.current = true;
          return;
        }
        if (e.key === 'Escape') {
          done.current = true;
          setUI({ editingId: null });
        } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || (enterCommits && !e.shiftKey) || !multiline)) {
          e.preventDefault();
          commit();
        }
      }}
    />
  );
}

/* ---------------- task ---------------- */

function TaskNodeImpl({ id, data, selected }: NodeProps<ItemNode>) {
  const t = data.item as TaskItem;
  const info = data.info!;
  const editing = useStore((s) => s.ui.editingId === id);
  const showCritical = useStore((s) => s.ui.showCritical);
  const update = useStore((s) => s.updateItem);
  const toggleCollapse = useStore((s) => s.toggleCollapse);
  if (!info) return null;

  const due = formatDue(t.due);
  const prog = info.progress;
  const cls = [
    'task-card',
    `st-${info.state}`,
    t.milestone ? 'milestone' : '',
    info.composite ? 'composite' : '',
    t.color ? `c-${t.color}` : '',
    selected ? 'selected' : '',
    data.dim ? 'dim' : '',
    data.faded ? 'faded' : '',
    showCritical && data.critical ? 'critical' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>, v: string) => {
    const st = useStore.getState();
    if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      st.updateItem<TaskItem>(id, { title: v.trim() });
      st.setUI({ editingId: null });
      if (!t.milestone) st.addTask({ parentId: id, edit: 'canvas' });
      return true;
    }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      st.updateItem<TaskItem>(id, { title: v.trim() });
      st.setUI({ editingId: null });
      st.addTask({ nextOf: id, edit: 'canvas' });
      return true;
    }
    if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault();
      st.updateItem<TaskItem>(id, { title: v.trim() });
      st.setUI({ editingId: null });
      st.addTask({ after: id, edit: 'canvas' });
      return true;
    }
    return false;
  };

  return (
    <div className={cls}>
      {!t.milestone && <div className="task-stripe" />}
      <div className="task-body">
        <div className="task-top">
          {t.milestone ? (
            <span className="milestone-icon" title="Milestone">
              <Diamond size={14} strokeWidth={2.5} />
            </span>
          ) : null}
          <StatusCheck info={info} task={t} />
          {editing ? (
            <InlineEditor
              value={t.title}
              multiline
              className="task-title-input"
              placeholder="Task title"
              onCommit={(v) => v.trim() !== t.title && update<TaskItem>(id, { title: v.trim() })}
              onKey={onKey}
            />
          ) : (
            <div className={`task-title ${t.title ? '' : 'placeholder'}`}>{t.title || 'Untitled task'}</div>
          )}
          <PriorityFlag p={t.priority} />
        </div>
        <div className="task-meta">
          {(info.state === 'blocked' || info.state === 'doing' || (t.milestone && info.state !== 'ready')) && (
            <StateBadge state={info.state} small />
          )}
          {prog && (
            <span className="meta-progress" title={`${prog.done} of ${prog.total} ${prog.unit} done`}>
              {prog.unit === 'checklist' ? <ListChecks size={11} /> : null}
              <span className="bar">
                <span style={{ width: `${prog.ratio * 100}%` }} />
              </span>
              {prog.done}/{prog.total}
            </span>
          )}
          {due && (
            <span className={`meta-chip due ${info.resolved ? '' : due.cls}`} title={`Due ${t.due}`}>
              <Clock size={11} /> {due.text}
            </span>
          )}
          {info.remainingEstimate > 0 && <span className="meta-chip">{formatHours(info.remainingEstimate)}</span>}
          {t.tags.slice(0, 2).map((tag) => (
            <span key={tag} className="meta-tag">
              #{tag}
            </span>
          ))}
          {info.notes.length > 0 && (
            <span className="meta-chip" title={`${info.notes.length} note(s)`}>
              <StickyNote size={11} />
              {info.notes.length}
            </span>
          )}
          {info.warnings.length > 0 && !info.resolved && (
            <span className="meta-warn" title={info.warnings.map((w) => w.message).join('\n')}>
              <AlertTriangle size={12} />
            </span>
          )}
        </div>
        {info.state === 'blocked' && data.blockerNames && data.blockerNames.length > 0 && (
          <div className="task-waiting" title={data.blockerNames.join(', ')}>
            after {data.blockerNames[0]}
            {data.blockerNames.length > 1 ? ` +${data.blockerNames.length - 1}` : ''}
          </div>
        )}
      </div>
      {info.composite && (
        <button
          className="collapse-toggle nodrag"
          onClick={(e) => {
            e.stopPropagation();
            toggleCollapse(id);
          }}
          title={t.collapsed ? 'Show subtasks' : 'Hide subtasks'}
        >
          {t.collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
          {t.collapsed ? `${data.hiddenCount} hidden` : `${info.childIds.length}`}
        </button>
      )}
      <NodeResizeControl
        position="right"
        variant={ResizeControlVariant.Line}
        minWidth={150}
        maxWidth={640}
        className="task-resize"
        {...gesture}
      />
      <Handles />
    </div>
  );
}

/* ---------------- note ---------------- */

function NoteNodeImpl({ id, data, selected }: NodeProps<ItemNode>) {
  const n = data.item as NoteItem;
  const editing = useStore((s) => s.ui.editingId === id);
  const update = useStore((s) => s.updateItem);
  return (
    <div className={`note-card c-${n.color ?? 'yellow'} ${selected ? 'selected' : ''} ${data.dim ? 'dim' : ''}`}>
      <NodeResizer isVisible={selected} minWidth={120} minHeight={60} lineClassName="rz-line" handleClassName="rz-handle" {...gesture} />
      {editing ? (
        <InlineEditor
          value={n.text}
          multiline
          enterCommits={false}
          className="note-input"
          placeholder="Write a note… (Markdown, Ctrl+Enter to finish)"
          onCommit={(v) => v !== n.text && update<NoteItem>(id, { text: v })}
        />
      ) : n.text ? (
        <Markdown text={n.text} className="note-text" />
      ) : (
        <div className="note-text placeholder">Empty note — double-click to write</div>
      )}
      <Handles />
    </div>
  );
}

/* ---------------- shape ---------------- */

function shapePath(shape: ShapeItem['shape'], w: number, h: number): string {
  const i = 1.5; // inset for stroke
  const W = w - i;
  const H = h - i;
  switch (shape) {
    case 'rect':
      return `M${i} ${i}H${W}V${H}H${i}Z`;
    case 'rounded': {
      const r = Math.min(14, w / 4, h / 4);
      return `M${i + r} ${i}H${W - r}Q${W} ${i} ${W} ${i + r}V${H - r}Q${W} ${H} ${W - r} ${H}H${i + r}Q${i} ${H} ${i} ${H - r}V${i + r}Q${i} ${i} ${i + r} ${i}Z`;
    }
    case 'ellipse':
      return `M${w / 2} ${i}A${w / 2 - i} ${h / 2 - i} 0 1 1 ${w / 2 - 0.01} ${i}Z`;
    case 'diamond':
      return `M${w / 2} ${i}L${W} ${h / 2}L${w / 2} ${H}L${i} ${h / 2}Z`;
    case 'hexagon': {
      const k = Math.min(w * 0.22, h * 0.5);
      return `M${i + k} ${i}H${W - k}L${W} ${h / 2}L${W - k} ${H}H${i + k}L${i} ${h / 2}Z`;
    }
    case 'parallelogram': {
      const k = Math.min(w * 0.2, 30);
      return `M${i + k} ${i}H${W}L${W - k} ${H}H${i}Z`;
    }
    case 'cylinder': {
      const ry = Math.min(14, h / 5);
      return `M${i} ${i + ry}A${w / 2 - i} ${ry} 0 0 1 ${W} ${i + ry}V${H - ry}A${w / 2 - i} ${ry} 0 0 1 ${i} ${H - ry}Z M${i} ${i + ry}A${w / 2 - i} ${ry} 0 0 0 ${W} ${i + ry}`;
    }
  }
}

function ShapeNodeImpl({ id, data, selected }: NodeProps<ItemNode>) {
  const s = data.item as ShapeItem;
  const editing = useStore((st) => st.ui.editingId === id);
  const update = useStore((st) => st.updateItem);
  return (
    <div className={`shape-node c-${s.color ?? 'gray'} ${selected ? 'selected' : ''} ${data.dim ? 'dim' : ''}`}>
      <NodeResizer isVisible={selected} minWidth={40} minHeight={30} lineClassName="rz-line" handleClassName="rz-handle" {...gesture} />
      <svg className="shape-svg" width={s.w} height={s.h}>
        <path d={shapePath(s.shape, s.w, s.h)} className={`shape-path stroke-${s.stroke}`} />
      </svg>
      <div className="shape-text" style={{ fontSize: s.fontSize }}>
        {editing ? (
          <InlineEditor
            value={s.text}
            multiline
            className="shape-input"
            onCommit={(v) => v !== s.text && update<ShapeItem>(id, { text: v })}
          />
        ) : (
          s.text
        )}
      </div>
      <Handles />
    </div>
  );
}

/* ---------------- frame (area) ---------------- */

function FrameNodeImpl({ id, data, selected }: NodeProps<ItemNode>) {
  const f = data.item as FrameItem;
  const editing = useStore((s) => s.ui.editingId === id);
  const update = useStore((s) => s.updateItem);
  const st = data.frameStats;
  return (
    <div className={`frame-node c-${f.color ?? 'gray'} ${selected ? 'selected' : ''} ${data.dim ? 'dim' : ''}`}>
      <NodeResizer isVisible={selected} minWidth={160} minHeight={100} lineClassName="rz-line" handleClassName="rz-handle" {...gesture} />
      <div className="frame-header">
        {editing ? (
          <InlineEditor value={f.title} className="frame-input" onCommit={(v) => v !== f.title && update<FrameItem>(id, { title: v })} />
        ) : (
          <span className="frame-title">{f.title || 'Area'}</span>
        )}
        {st && st.total > 0 && (
          <span className="frame-stats">
            <span className="bar">
              <span style={{ width: `${(st.done / st.total) * 100}%` }} />
            </span>
            {st.done}/{st.total}
          </span>
        )}
      </div>
    </div>
  );
}

/* ---------------- text ---------------- */

function TextNodeImpl({ id, data, selected }: NodeProps<ItemNode>) {
  const t = data.item as TextItem;
  const editing = useStore((s) => s.ui.editingId === id);
  const update = useStore((s) => s.updateItem);
  return (
    <div
      className={`text-node ${t.color ? `c-${t.color}` : ''} ${selected ? 'selected' : ''} ${data.dim ? 'dim' : ''}`}
      style={{ fontSize: t.fontSize, fontWeight: t.bold ? 700 : 400 }}
    >
      <NodeResizer isVisible={selected} minWidth={40} minHeight={24} lineClassName="rz-line" handleClassName="rz-handle" {...gesture} />
      {editing ? (
        <InlineEditor value={t.text} multiline className="text-input" onCommit={(v) => v !== t.text && update<TextItem>(id, { text: v })} />
      ) : (
        <div className="text-content">{t.text || 'Text'}</div>
      )}
      <Handles />
    </div>
  );
}

export const nodeTypes = {
  task: memo(TaskNodeImpl),
  note: memo(NoteNodeImpl),
  shape: memo(ShapeNodeImpl),
  frame: memo(FrameNodeImpl),
  text: memo(TextNodeImpl),
};
