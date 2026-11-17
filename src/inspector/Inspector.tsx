import {
  AlertTriangle,
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalSpaceAround,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalSpaceAround,
  ArrowLeftRight,
  ArrowRight,
  Ban,
  Check,
  CheckSquare,
  Crosshair,
  Diamond,
  Eye,
  Frame,
  List,
  Lock,
  Network,
  PanelRightClose,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  StickyNote,
  Trash2,
  Workflow,
  X,
} from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { descendantsOf, type TaskInfo } from '../model/engine';
import { LINK_META, titleOf } from '../model/rules';
import type {
  ArrowMode,
  FrameItem,
  ID,
  Item,
  Link,
  LinkType,
  NoteItem,
  Priority,
  Routing,
  ShapeItem,
  StrokeStyle,
  TaskItem,
  TaskStatus,
  TextItem,
} from '../model/types';
import { isTask } from '../model/types';
import { useStore } from '../store/store';
import {
  ColorSwatches,
  formatDue,
  formatHours,
  Markdown,
  PRIORITY_LABEL,
  PriorityFlag,
  StateBadge,
  StatusCheck,
  TaskPicker,
  TaskRef,
} from '../ui/common';
import { LinkIcon, ShapeIcon, SHAPES } from '../ui/icons';

export function Inspector() {
  const selection = useStore((s) => s.ui.selection);
  const selectedLinks = useStore((s) => s.ui.selectedLinks);
  const items = useStore((s) => s.board().items);
  const setUI = useStore((s) => s.setUI);

  let body: React.ReactNode;
  let title = 'Board';
  if (selection.length === 1 && items[selection[0]]) {
    const it = items[selection[0]];
    title = it.kind === 'task' ? (it.milestone ? 'Milestone' : 'Task') : it.kind === 'frame' ? 'Area' : it.kind[0].toUpperCase() + it.kind.slice(1);
    body = <ItemPanel key={it.id} item={it} />;
  } else if (selection.length > 1) {
    title = `${selection.length} selected`;
    body = <MultiPanel ids={selection} />;
  } else if (selectedLinks.length === 1) {
    title = 'Connection';
    body = <LinkPanel key={selectedLinks[0]} id={selectedLinks[0]} />;
  } else {
    body = <BoardPanel />;
  }

  return (
    <aside className="inspector">
      <div className="inspector-head">
        <span className="inspector-title">{title}</span>
        <button className="icon-btn" title="Hide panel" onClick={() => setUI({ inspectorOpen: false })}>
          <PanelRightClose size={16} />
        </button>
      </div>
      <div className="inspector-body">{body}</div>
    </aside>
  );
}

function ItemPanel({ item }: { item: Item }) {
  switch (item.kind) {
    case 'task':
      return <TaskPanel id={item.id} />;
    case 'note':
      return <NotePanel note={item} />;
    case 'shape':
      return <ShapePanel shape={item} />;
    case 'frame':
      return <FramePanel frame={item} />;
    case 'text':
      return <TextPanel text={item} />;
  }
}

/* ------------------------------------------------------------------ */
/* Shared bits                                                          */
/* ------------------------------------------------------------------ */

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="field">
      <label title={hint}>{label}</label>
      <div className="field-body">{children}</div>
    </div>
  );
}

function Section({
  title,
  count,
  children,
  action,
  hint,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
  action?: React.ReactNode;
  hint?: string;
}) {
  return (
    <section className="insp-section">
      <div className="insp-section-head" title={hint}>
        <span>{title}</span>
        {count !== undefined && count > 0 && <span className="count">{count}</span>}
        <span className="grow" />
        {action}
      </div>
      {children}
    </section>
  );
}

function ItemActions({ id, children }: { id: ID; children?: React.ReactNode }) {
  const st = useStore.getState;
  const view = useStore((s) => s.ui.view);
  return (
    <div className="item-actions">
      {view !== 'canvas' && (
        <button className="tb-btn" title="Show on canvas" onClick={() => st().revealOnCanvas(id)}>
          <Crosshair size={15} />
        </button>
      )}
      {isTask(st().board().items[id]) && view !== 'list' && (
        <button className="tb-btn" title="Show in list" onClick={() => st().revealInList(id)}>
          <List size={15} />
        </button>
      )}
      {children}
      <span className="grow" />
      <button className="tb-btn danger" title="Delete (Del)" onClick={() => st().deleteItems([id])}>
        <Trash2 size={15} />
      </button>
    </div>
  );
}

function TextArea({
  value,
  onChange,
  placeholder,
  className,
  minRows = 2,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  minRows?: number;
}) {
  return (
    <textarea
      className={`insp-textarea ${className ?? ''}`}
      value={value}
      placeholder={placeholder}
      rows={Math.max(minRows, value.split('\n').length)}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Task                                                                 */
/* ------------------------------------------------------------------ */

const STATUS_OPTS: { s: TaskStatus; label: string; icon: React.ReactNode }[] = [
  { s: 'todo', label: 'To do', icon: <span className="dot-ring" /> },
  { s: 'doing', label: 'In progress', icon: <Play size={12} /> },
  { s: 'done', label: 'Done', icon: <Check size={12} /> },
  { s: 'dropped', label: 'Dropped', icon: <Ban size={12} /> },
];

function TaskPanel({ id }: { id: ID }) {
  const t = useStore((s) => s.board().items[id]) as TaskItem;
  const info = useStore((s) => s.analysis.tasks.get(id));
  const st = useStore.getState;
  const update = (p: Partial<TaskItem>, key?: string) => st().updateItem<TaskItem>(id, p, key);
  if (!t || !info) return null;

  return (
    <div className="task-panel">
      <ItemActions id={id}>
        <button
          className={`tb-btn ${t.milestone ? 'active' : ''}`}
          title={t.milestone ? 'Make regular task' : 'Make milestone (a checkpoint with no work of its own)'}
          disabled={!t.milestone && info.childIds.length > 0}
          onClick={() => update({ milestone: !t.milestone, w: t.milestone ? 248 : 200 })}
        >
          <Diamond size={15} />
        </button>
        <button className="tb-btn" title="Attach a note" onClick={() => st().addNote({ x: t.x, y: t.y }, id)}>
          <StickyNote size={15} />
        </button>
      </ItemActions>

      <div className="title-row">
        <StatusCheck info={info} task={t} size={22} />
        <textarea
          className="title-input"
          value={t.title}
          placeholder={t.milestone ? 'Milestone name' : 'Task title'}
          rows={1}
          onChange={(e) => update({ title: e.target.value.replace(/\n/g, ' ') })}
          ref={(el) => {
            if (el) {
              el.style.height = 'auto';
              el.style.height = `${el.scrollHeight}px`;
            }
          }}
        />
      </div>

      <StateExplainer info={info} t={t} />

      {info.composite || info.gated ? (
        <div className="derived-status">
          {info.composite && info.status !== 'done' && info.status !== 'dropped' && (
            <button className="btn" onClick={() => st().setStatus([id], 'done')}>
              <Check size={14} /> Complete all {descendantsOf(st().analysis, id).filter((d) => !st().analysis.tasks.get(d)!.resolved).length} open subtasks
            </button>
          )}
          <button className="btn" onClick={() => st().setStatus([id], info.status === 'dropped' ? 'todo' : 'dropped')}>
            {info.status === 'dropped' ? <RotateCcw size={14} /> : <Ban size={14} />}
            {info.status === 'dropped' ? 'Restore' : info.composite ? 'Drop branch' : 'Drop'}
          </button>
        </div>
      ) : (
        <div className="segmented status-seg">
          {STATUS_OPTS.map((o) => (
            <button key={o.s} className={`seg-btn st-${o.s === 'todo' ? 'ready' : o.s} ${t.status === o.s ? 'active' : ''}`} onClick={() => st().setStatus([id], o.s)}>
              {o.icon}
              {o.label}
            </button>
          ))}
        </div>
      )}

      <div className="fields">
        <Field label="Priority">
          <div className="segmented prio-seg">
            {([0, 1, 2, 3, 4] as Priority[]).map((p) => (
              <button key={p} className={`seg-btn ${t.priority === p ? 'active' : ''}`} title={PRIORITY_LABEL[p]} onClick={() => update({ priority: p })}>
                {p === 0 ? '—' : <PriorityFlag p={p} />}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Due">
          <div className="date-field">
            <input type="date" value={t.due ?? ''} onChange={(e) => update({ due: e.target.value || null })} />
            {t.due && (
              <button className="icon-btn" onClick={() => update({ due: null })}>
                <X size={13} />
              </button>
            )}
          </div>
        </Field>
        <Field label="Start">
          <div className="date-field">
            <input type="date" value={t.start ?? ''} onChange={(e) => update({ start: e.target.value || null })} />
            {t.start && (
              <button className="icon-btn" onClick={() => update({ start: null })}>
                <X size={13} />
              </button>
            )}
          </div>
        </Field>
        <Field label="Estimate" hint="Effort in hours. Used for roll-ups, the plan and the critical path.">
          <div className="estimate-field">
            <input
              type="number"
              min={0}
              step={0.5}
              value={t.estimate ?? ''}
              placeholder={info.composite && info.totalEstimate ? String(info.totalEstimate) : 'hours'}
              onChange={(e) => update({ estimate: e.target.value === '' ? null : Math.max(0, Number(e.target.value)) }, `est:${id}`)}
            />
            <span className="unit">h</span>
            {info.composite && info.totalEstimate > 0 && (
              <span className="hint">
                {formatHours(info.remainingEstimate)} of {formatHours(info.totalEstimate)} left
              </span>
            )}
          </div>
        </Field>
        <Field label="Tags">
          <TagInput tags={t.tags} onChange={(tags) => update({ tags })} />
        </Field>
        <Field label="Color">
          <ColorSwatches value={t.color} onChange={(c) => update({ color: c })} />
        </Field>
      </div>

      <DescriptionEditor value={t.description} onChange={(v) => update({ description: v }, `desc:${id}`)} />

      {!info.composite && !t.milestone && <Checklist t={t} />}

      <Relationships t={t} info={info} />

      {info.warnings.length > 0 && (
        <Section title="Attention" count={info.warnings.length}>
          <div className="warnings">
            {info.warnings.map((w, i) => (
              <div key={i} className={`warning w-${w.kind}`}>
                <AlertTriangle size={13} />
                <span>{w.message}</span>
                {w.ref && <TaskRef id={w.ref} showState={false} />}
              </div>
            ))}
          </div>
        </Section>
      )}

      <div className="meta-foot">
        Created {new Date(t.createdAt).toLocaleString()}
        {t.completedAt && info.status === 'done' && <> · Completed {new Date(t.completedAt).toLocaleString()}</>}
      </div>
    </div>
  );
}

function StateExplainer({ info, t }: { info: TaskInfo; t: TaskItem }) {
  const board = useStore((s) => s.board());
  const lines: React.ReactNode[] = [];
  if (info.composite) {
    lines.push(
      <p key="c">
        Status follows its <b>{info.childIds.length}</b> subtask{info.childIds.length > 1 ? 's' : ''}
        {info.progress ? ` (${info.progress.done}/${info.progress.total} done)` : ''}.
      </p>,
    );
  }
  if (info.gated) {
    lines.push(<p key="g">Milestone: reached automatically once its {info.prereqs.length} prerequisite(s) are done.</p>);
  }
  switch (info.state) {
    case 'ready':
      lines.push(<p key="s">Nothing is in the way — this can start now.</p>);
      break;
    case 'doing':
      lines.push(<p key="s">Work is in progress.</p>);
      break;
    case 'done':
      lines.push(<p key="s">Finished. Everything waiting on it is no longer held back by it.</p>);
      break;
    case 'dropped':
      lines.push(<p key="s">Dropped — counts as resolved, so it no longer blocks anything.</p>);
      break;
    case 'blocked':
      lines.push(
        <div key="s" className="blockers">
          <span>Can’t start until these are done:</span>
          {info.blockers.map((b) => (
            <div key={b.id} className="blocker">
              <TaskRef id={b.id} />
              {b.via && <span className="via">inherited from parent “{titleOf(board.items[b.via])}”</span>}
            </div>
          ))}
        </div>,
      );
      break;
  }
  if (info.softPending.length && !info.resolved) {
    lines.push(
      <div key="soft" className="soft-line">
        Better after:{' '}
        {info.softPending.map((p) => (
          <TaskRef key={p} id={p} />
        ))}
      </div>,
    );
  }
  if (!info.resolved && info.neededBy && info.neededByFor && info.neededByFor !== info.id) {
    const d = formatDue(info.neededBy);
    lines.push(
      <div key="nb" className="soft-line">
        Needed by <b className={d?.cls}>{d?.text}</b> for <TaskRef id={info.neededByFor} showState={false} />
      </div>,
    );
  }
  if (!info.resolved && info.urgency > t.priority) {
    lines.push(
      <div key="u" className="soft-line">
        Effective priority <b>{PRIORITY_LABEL[info.urgency]}</b> — inherited from work that depends on it.
      </div>,
    );
  }
  if (info.impact > 0 && !info.resolved) {
    lines.push(
      <div key="i" className="soft-line">
        {info.impact} open task{info.impact > 1 ? 's' : ''} wait on this{info.critical ? ' · on the critical path' : ''}.
      </div>,
    );
  }
  if (info.step) lines.push(<div key="step" className="soft-line">Step {info.step} in the suggested plan.</div>);
  return (
    <div className={`state-explainer st-${info.state}`}>
      <StateBadge state={info.state} />
      {lines}
    </div>
  );
}

function TagInput({ tags, onChange }: { tags: string[]; onChange: (t: string[]) => void }) {
  const [v, setV] = useState('');
  const board = useStore((s) => s.board());
  const all = useMemo(() => {
    const s = new Set<string>();
    for (const it of Object.values(board.items)) if (isTask(it)) it.tags.forEach((x) => s.add(x));
    return [...s].filter((x) => !tags.includes(x)).sort();
  }, [board, tags]);
  const add = (raw: string) => {
    const t = raw.trim().replace(/^#/, '').replace(/\s+/g, '-').toLowerCase();
    if (t && !tags.includes(t)) onChange([...tags, t]);
    setV('');
  };
  return (
    <div className="tag-input">
      {tags.map((t) => (
        <span key={t} className="tag-chip">
          #{t}
          <button onClick={() => onChange(tags.filter((x) => x !== t))}>
            <X size={11} />
          </button>
        </span>
      ))}
      <input
        list="tag-suggestions"
        value={v}
        placeholder={tags.length ? '' : 'Add tag…'}
        onChange={(e) => {
          if (e.target.value.endsWith(',')) add(e.target.value.slice(0, -1));
          else setV(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.preventDefault(), add(v));
          if (e.key === 'Backspace' && !v && tags.length) onChange(tags.slice(0, -1));
        }}
        onBlur={() => v && add(v)}
      />
      <datalist id="tag-suggestions">
        {all.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
    </div>
  );
}

function DescriptionEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [editing, setEditing] = useState(!value);
  return (
    <Section
      title="Description"
      action={
        value ? (
          <button className="icon-btn" title={editing ? 'Preview' : 'Edit'} onClick={() => setEditing(!editing)}>
            {editing ? <Eye size={14} /> : <Pencil size={14} />}
          </button>
        ) : undefined
      }
    >
      {editing ? (
        <TextArea value={value} onChange={onChange} placeholder="Details, context, links… (Markdown)" minRows={3} />
      ) : (
        <div className="desc-preview" onDoubleClick={() => setEditing(true)} title="Double-click to edit">
          <Markdown text={value} />
        </div>
      )}
    </Section>
  );
}

function Checklist({ t }: { t: TaskItem }) {
  const update = (checklist: TaskItem['checklist']) => useStore.getState().updateItem<TaskItem>(t.id, { checklist }, `cl:${t.id}`);
  const [v, setV] = useState('');
  const done = t.checklist.filter((c) => c.done).length;
  return (
    <Section
      title="Checklist"
      count={t.checklist.length}
      hint="Small steps that don’t deserve their own task. Use subtasks for anything that has dependencies or needs its own place on the canvas."
      action={t.checklist.length ? <span className="hint">{done}/{t.checklist.length}</span> : undefined}
    >
      <div className="checklist">
        {t.checklist.map((c, i) => (
          <div key={c.id} className={`check-item ${c.done ? 'done' : ''}`}>
            <input type="checkbox" checked={c.done} onChange={() => update(t.checklist.map((x, j) => (j === i ? { ...x, done: !x.done } : x)))} />
            <input
              className="check-text"
              value={c.text}
              onChange={(e) => update(t.checklist.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))}
            />
            <button className="icon-btn" title="Promote to subtask" onClick={() => {
              const st = useStore.getState();
              update(t.checklist.filter((_, j) => j !== i));
              st.addTask({ parentId: t.id, title: c.text, patch: { status: c.done ? 'done' : 'todo' }, select: false });
            }}>
              <Network size={12} />
            </button>
            <button className="icon-btn" onClick={() => update(t.checklist.filter((_, j) => j !== i))}>
              <X size={12} />
            </button>
          </div>
        ))}
        <input
          className="check-add"
          placeholder="+ Add item"
          value={v}
          onChange={(e) => setV(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && v.trim()) {
              update([...t.checklist, { id: Math.random().toString(36).slice(2), text: v.trim(), done: false }]);
              setV('');
            }
          }}
        />
      </div>
    </Section>
  );
}

type RelKind = 'parent' | 'subtask' | 'prereq' | 'soft' | 'dependent' | 'related';

function Relationships({ t, info }: { t: TaskItem; info: TaskInfo }) {
  const [picking, setPicking] = useState<RelKind | null>(null);
  const st = useStore.getState;
  const board = useStore((s) => s.board());
  const analysis = useStore((s) => s.analysis);
  const id = t.id;

  const excludeFor = (k: RelKind): Set<ID> => {
    const ex = new Set<ID>([id]);
    if (k === 'parent') {
      descendantsOf(analysis, id).forEach((d) => ex.add(d));
      if (info.parentId) ex.add(info.parentId);
      for (const [tid, ti] of analysis.tasks) if ((board.items[tid] as TaskItem).milestone) ex.add(tid), void ti;
    }
    if (k === 'subtask') {
      info.childIds.forEach((c) => ex.add(c));
      info.ancestors.forEach((a) => ex.add(a));
    }
    if (k === 'prereq' || k === 'soft' || k === 'dependent') {
      info.ancestors.forEach((a) => ex.add(a));
      descendantsOf(analysis, id).forEach((d) => ex.add(d));
      (k === 'prereq' ? info.prereqs : k === 'soft' ? info.softPrereqs : info.dependents).forEach((x) => ex.add(x));
    }
    if (k === 'related') info.related.forEach((r) => ex.add(r));
    return ex;
  };

  const pick = (k: RelKind, v: ID | { create: string }) => {
    setPicking(null);
    if (typeof v !== 'string') {
      const title = v.create;
      if (k === 'subtask') st().addTask({ parentId: id, title, select: false });
      else if (k === 'prereq') st().addTask({ prereqOf: id, title, select: false });
      else if (k === 'dependent') st().addTask({ nextOf: id, title, select: false });
      else if (k === 'parent') {
        const pid = st().addTask({ prereqOf: undefined, title, select: false, at: { x: t.x - 40, y: t.y - 120 } });
        st().connect('subtask', pid, id);
      } else {
        const nid = st().addTask({ title, select: false, at: { x: t.x + t.w + 80, y: t.y + 60 } });
        st().connect(k === 'soft' ? 'soft' : 'relates', k === 'soft' ? nid : id, k === 'soft' ? id : nid);
      }
      st().select([id]);
      return;
    }
    switch (k) {
      case 'parent':
        st().setParent(id, v);
        break;
      case 'subtask':
        st().setParent(v, id);
        break;
      case 'prereq':
        st().connect('depends', v, id);
        break;
      case 'soft':
        st().connect('soft', v, id);
        break;
      case 'dependent':
        st().connect('depends', id, v);
        break;
      case 'related':
        st().connect('relates', id, v);
        break;
    }
    st().select([id]);
  };

  const picker = (k: RelKind, placeholder: string) =>
    picking === k ? (
      <TaskPicker exclude={excludeFor(k)} placeholder={placeholder} onPick={(v) => pick(k, v)} onClose={() => setPicking(null)} allowCreate />
    ) : null;

  const addBtn = (k: RelKind, title: string) => (
    <button className="icon-btn" title={title} onClick={() => setPicking(picking === k ? null : k)}>
      <Plus size={14} />
    </button>
  );

  const RelRow = ({ rid, onRemove, extra, removeTitle }: { rid: ID; onRemove: () => void; extra?: React.ReactNode; removeTitle: string }) => (
    <div className="rel-row">
      <TaskRef id={rid} />
      {extra}
      <span className="grow" />
      <button className="icon-btn remove" title={removeTitle} onClick={onRemove}>
        <X size={13} />
      </button>
    </div>
  );

  return (
    <>
      <Section title="Part of" action={!info.parentId ? addBtn('parent', 'Make this a subtask of…') : undefined} hint="The bigger task this is a part of. A task has at most one parent.">
        {info.parentId ? (
          <RelRow rid={info.parentId} removeTitle="Detach from parent (becomes top-level)" onRemove={() => st().setParent(id, null)} />
        ) : (
          !picking && <div className="empty-rel">Top-level task</div>
        )}
        {picker('parent', 'Choose a parent task…')}
      </Section>

      {!t.milestone && (
        <Section title="Subtasks" count={info.childIds.length} action={addBtn('subtask', 'Add an existing or new subtask')} hint="Parts of this task. The task is done when all of them are.">
          {info.childIds.map((c) => (
            <div key={c} className="rel-row">
              <SubtaskCheck id={c} />
              <TaskRef id={c} showState={false} />
              <span className="grow" />
              <button className="icon-btn remove" title="Detach (keep as separate task)" onClick={() => st().setParent(c, info.parentId)}>
                <X size={13} />
              </button>
            </div>
          ))}
          {picker('subtask', 'Find or create a subtask…')}
          <QuickAdd placeholder="+ New subtask" onAdd={(title) => st().addTask({ parentId: id, title, select: false })} />
        </Section>
      )}

      <Section title="Waits for" count={info.prereqs.length} action={addBtn('prereq', 'Add a prerequisite')} hint="Hard prerequisites: this can’t start until they’re done (or dropped).">
        {info.prereqs.map((p) => (
          <RelRow
            key={p}
            rid={p}
            removeTitle="Remove dependency"
            onRemove={() => st().removeRelation('depends', p, id)}
            extra={
              <button className="mini-btn" title="Make advisory (never blocks)" onClick={() => {
                const l = Object.values(board.links).find((x) => x.type === 'depends' && x.source === p && x.target === id);
                if (l) st().changeLinkType(l.id, 'soft');
              }}>
                soft
              </button>
            }
          />
        ))}
        {info.ancestors.length > 0 && info.blockers.some((b) => b.via) && (
          <div className="empty-rel">+ inherited from parent: {info.blockers.filter((b) => b.via).map((b) => titleOf(board.items[b.id])).join(', ')}</div>
        )}
        {picker('prereq', 'What must happen first?')}
      </Section>

      <Section title="Better after" count={info.softPrereqs.length} action={addBtn('soft', 'Add an advisory predecessor')} hint="Advisory order: shapes the plan but never blocks.">
        {info.softPrereqs.map((p) => (
          <RelRow
            key={p}
            rid={p}
            removeTitle="Remove"
            onRemove={() => st().removeRelation('soft', p, id)}
            extra={
              <button className="mini-btn" title="Make it a hard dependency" onClick={() => {
                const l = Object.values(board.links).find((x) => x.type === 'soft' && x.source === p && x.target === id);
                if (l) st().changeLinkType(l.id, 'depends');
              }}>
                hard
              </button>
            }
          />
        ))}
        {picker('soft', 'What should ideally happen first?')}
      </Section>

      <Section title="Unblocks" count={info.dependents.length} action={addBtn('dependent', 'Add a task that waits for this one')} hint="Tasks that wait for this one.">
        {info.dependents.map((d) => (
          <RelRow key={d} rid={d} removeTitle="Remove dependency" onRemove={() => st().removeRelation('depends', id, d)} />
        ))}
        {info.softDependents.map((d) => (
          <RelRow key={d} rid={d} removeTitle="Remove" extra={<span className="mini-tag">soft</span>} onRemove={() => st().removeRelation('soft', id, d)} />
        ))}
        {picker('dependent', 'What waits for this?')}
      </Section>

      <Section title="Related" count={info.related.length} action={addBtn('related', 'Relate to another task')}>
        {info.related.map((r) =>
          isTask(board.items[r]) ? (
            <RelRow key={r} rid={r} removeTitle="Remove relation" onRemove={() => st().removeRelation('relates', id, r)} />
          ) : (
            <div key={r} className="rel-row">
              <StickyNote size={12} /> <span className="ellipsis">{titleOf(board.items[r])}</span>
            </div>
          ),
        )}
        {picker('related', 'Relate to…')}
      </Section>

      <Section
        title="Notes"
        count={info.notes.length}
        action={
          <button className="icon-btn" title="Attach a new note" onClick={() => st().addNote({ x: t.x, y: t.y }, id)}>
            <Plus size={14} />
          </button>
        }
      >
        {info.notes.map((n) => {
          const note = board.items[n] as NoteItem;
          return (
            <div key={n} className={`note-preview c-${note.color ?? 'yellow'}`} onClick={() => st().select([n])}>
              <Markdown text={note.text || '*empty note*'} />
              <button
                className="icon-btn remove"
                title="Detach note"
                onClick={(e) => (e.stopPropagation(), st().removeRelation('annotates', n, id))}
              >
                <X size={13} />
              </button>
            </div>
          );
        })}
      </Section>
    </>
  );
}

function SubtaskCheck({ id }: { id: ID }) {
  const t = useStore((s) => s.board().items[id]) as TaskItem;
  const info = useStore((s) => s.analysis.tasks.get(id));
  if (!t || !info) return null;
  return <StatusCheck info={info} task={t} size={15} />;
}

function QuickAdd({ placeholder, onAdd }: { placeholder: string; onAdd: (title: string) => void }) {
  const [v, setV] = useState('');
  return (
    <input
      className="quick-add"
      placeholder={placeholder}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && v.trim()) {
          onAdd(v.trim());
          setV('');
        }
      }}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Other item kinds                                                     */
/* ------------------------------------------------------------------ */

function NotePanel({ note }: { note: NoteItem }) {
  const st = useStore.getState;
  const board = useStore((s) => s.board());
  const attached = Object.values(board.links)
    .filter((l) => l.type === 'annotates' && l.source === note.id)
    .map((l) => l.target);
  return (
    <div>
      <ItemActions id={note.id}>
        <button className="tb-btn" title="Convert to task" onClick={() => st().convert(note.id, 'task')}>
          <CheckSquare size={15} />
        </button>
      </ItemActions>
      <TextArea value={note.text} onChange={(v) => st().updateItem<NoteItem>(note.id, { text: v })} placeholder="Note text (Markdown)" minRows={6} />
      <div className="fields">
        <Field label="Color">
          <ColorSwatches value={note.color} onChange={(c) => st().updateItem(note.id, { color: c })} allowNone={false} />
        </Field>
      </div>
      <Section title="Attached to" count={attached.length} hint="Drag from the note to a task to attach it.">
        {attached.length ? attached.map((a) => (
          <div key={a} className="rel-row">
            <TaskRef id={a} />
            <span className="grow" />
            <button className="icon-btn remove" onClick={() => st().removeRelation('annotates', note.id, a)}>
              <X size={13} />
            </button>
          </div>
        )) : <div className="empty-rel">Free-floating. Connect it to a task to attach it.</div>}
      </Section>
    </div>
  );
}

function ShapePanel({ shape }: { shape: ShapeItem }) {
  const st = useStore.getState;
  const up = (p: Partial<ShapeItem>) => st().updateItem<ShapeItem>(shape.id, p);
  return (
    <div>
      <ItemActions id={shape.id}>
        <button className="tb-btn" title="Convert to task" onClick={() => st().convert(shape.id, 'task')}>
          <CheckSquare size={15} />
        </button>
      </ItemActions>
      <TextArea value={shape.text} onChange={(v) => up({ text: v })} placeholder="Label" />
      <div className="fields">
        <Field label="Shape">
          <div className="segmented wrap">
            {SHAPES.map((s) => (
              <button key={s.shape} className={`seg-btn ${shape.shape === s.shape ? 'active' : ''}`} title={s.label} onClick={() => up({ shape: s.shape })}>
                <ShapeIcon shape={s.shape} size={16} />
              </button>
            ))}
          </div>
        </Field>
        <Field label="Color">
          <ColorSwatches value={shape.color} onChange={(c) => up({ color: c })} allowNone={false} />
        </Field>
        <Field label="Border">
          <div className="segmented">
            {(['solid', 'dashed', 'dotted'] as StrokeStyle[]).map((s) => (
              <button key={s} className={`seg-btn ${shape.stroke === s ? 'active' : ''}`} onClick={() => up({ stroke: s })}>
                {s}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Text size">
          <input type="range" min={10} max={36} value={shape.fontSize} onChange={(e) => up({ fontSize: Number(e.target.value) })} />
        </Field>
      </div>
      <p className="panel-hint">Shapes are free diagram elements without task meaning. Drag from a shape’s edge to empty space to grow a flowchart.</p>
    </div>
  );
}

function FramePanel({ frame }: { frame: FrameItem }) {
  const st = useStore.getState;
  const board = useStore((s) => s.board());
  const analysis = useStore((s) => s.analysis);
  const members = Object.values(board.items).filter((i) => i.frameId === frame.id);
  const tasks = members.filter(isTask);
  const leaves = tasks.map((t) => analysis.tasks.get(t.id)!).filter((i) => !i.composite && i.status !== 'dropped');
  const done = leaves.filter((i) => i.status === 'done').length;
  return (
    <div>
      <ItemActions id={frame.id}>
        <button className="tb-btn" title="Select contents" onClick={() => st().select(members.map((m) => m.id))}>
          <Frame size={15} />
        </button>
        <button className="tb-btn" title="Arrange contents as tree" onClick={() => st().layout('tree', tasks.map((t) => t.id))}>
          <Network size={15} />
        </button>
      </ItemActions>
      <input className="title-input single" value={frame.title} placeholder="Area name" onChange={(e) => st().updateItem<FrameItem>(frame.id, { title: e.target.value })} />
      <div className="fields">
        <Field label="Color">
          <ColorSwatches value={frame.color} onChange={(c) => st().updateItem(frame.id, { color: c })} allowNone={false} />
        </Field>
      </div>
      <div className="area-stats">
        <div className="bar big">
          <span style={{ width: leaves.length ? `${(done / leaves.length) * 100}%` : 0 }} />
        </div>
        <span>
          {done}/{leaves.length} tasks done · {members.length} items
        </span>
      </div>
      <p className="panel-hint">
        Areas group related work spatially (a project, a phase, a context). Anything whose center lies inside moves with the area and appears under
        it in the list view. Areas don’t affect status — use subtasks for that.
      </p>
    </div>
  );
}

function TextPanel({ text }: { text: TextItem }) {
  const st = useStore.getState;
  const up = (p: Partial<TextItem>) => st().updateItem<TextItem>(text.id, p);
  return (
    <div>
      <ItemActions id={text.id} />
      <TextArea value={text.text} onChange={(v) => up({ text: v })} />
      <div className="fields">
        <Field label="Size">
          <input type="range" min={10} max={64} value={text.fontSize} onChange={(e) => up({ fontSize: Number(e.target.value) })} />
        </Field>
        <Field label="Bold">
          <input type="checkbox" checked={text.bold} onChange={(e) => up({ bold: e.target.checked })} />
        </Field>
        <Field label="Color">
          <ColorSwatches value={text.color} onChange={(c) => up({ color: c })} />
        </Field>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Link                                                                  */
/* ------------------------------------------------------------------ */

function LinkPanel({ id }: { id: ID }) {
  const l = useStore((s) => s.board().links[id]) as Link | undefined;
  const board = useStore((s) => s.board());
  const st = useStore.getState;
  if (!l) return null;
  const s = board.items[l.source];
  const t = board.items[l.target];
  const taskPair = isTask(s) && isTask(t);
  const types: LinkType[] = taskPair ? ['depends', 'soft', 'subtask', 'relates', 'line'] : s?.kind === 'note' || t?.kind === 'note' ? ['annotates', 'relates', 'line'] : ['line'];
  const up = (p: Partial<Link>) => st().updateLink(id, p);
  return (
    <div>
      <div className="link-ends">
        <EndRef id={l.source} />
        {l.type === 'relates' || l.type === 'line' && l.arrow === 'none' ? <ArrowLeftRight size={14} className="muted" /> : <ArrowRight size={14} className="muted" />}
        <EndRef id={l.target} />
      </div>
      <p className="link-sentence">{LINK_META[l.type].describe(titleOf(s), titleOf(t))}</p>
      <div className="link-types">
        {types.map((ty) => (
          <button key={ty} className={`link-type-card ${l.type === ty ? 'active' : ''}`} onClick={() => st().changeLinkType(id, ty)}>
            <LinkIcon type={ty} size={22} />
            <span className="lt-name">{LINK_META[ty].label}</span>
          </button>
        ))}
      </div>
      <div className="fields">
        <Field label="Label">
          <input className="text-input" value={l.label} placeholder="Optional label" onChange={(e) => up({ label: e.target.value })} />
        </Field>
        <Field label="Routing">
          <div className="segmented">
            {(['curved', 'orthogonal', 'straight'] as Routing[]).map((r) => (
              <button key={r} className={`seg-btn ${l.routing === r ? 'active' : ''}`} onClick={() => up({ routing: r })}>
                {r}
              </button>
            ))}
          </div>
        </Field>
        {l.type === 'line' && (
          <>
            <Field label="Arrows">
              <div className="segmented">
                {(['none', 'end', 'both'] as ArrowMode[]).map((a) => (
                  <button key={a} className={`seg-btn ${l.arrow === a ? 'active' : ''}`} onClick={() => up({ arrow: a })}>
                    {a}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Dashed">
              <input type="checkbox" checked={l.dashed} onChange={(e) => up({ dashed: e.target.checked })} />
            </Field>
            <Field label="Color">
              <ColorSwatches value={l.color} onChange={(c) => up({ color: c })} />
            </Field>
          </>
        )}
      </div>
      <div className="item-actions">
        {l.type !== 'annotates' && (
          <button className="btn" onClick={() => st().reverseLink(id)}>
            <ArrowLeftRight size={14} /> Reverse
          </button>
        )}
        <span className="grow" />
        <button className="btn danger" onClick={() => st().deleteLinks([id])}>
          <Trash2 size={14} /> Delete
        </button>
      </div>
    </div>
  );
}

function EndRef({ id }: { id: ID }) {
  const it = useStore((s) => s.board().items[id]);
  if (!it) return null;
  if (isTask(it)) return <TaskRef id={id} />;
  return (
    <button className="task-ref" onClick={() => useStore.getState().revealOnCanvas(id)}>
      <span className="ellipsis">{titleOf(it)}</span>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Multi-selection                                                       */
/* ------------------------------------------------------------------ */

function MultiPanel({ ids }: { ids: ID[] }) {
  const st = useStore.getState;
  const board = useStore((s) => s.board());
  const tasks = ids.filter((id) => isTask(board.items[id]));
  return (
    <div>
      <p className="panel-hint">
        {ids.length} items{tasks.length ? `, ${tasks.length} tasks` : ''}.
      </p>
      {tasks.length > 0 && (
        <>
          <Section title="Status">
            <div className="segmented status-seg">
              {STATUS_OPTS.map((o) => (
                <button key={o.s} className={`seg-btn st-${o.s === 'todo' ? 'ready' : o.s}`} onClick={() => st().setStatus(tasks, o.s)}>
                  {o.icon}
                  {o.label}
                </button>
              ))}
            </div>
          </Section>
          <Section title="Priority">
            <div className="segmented prio-seg">
              {([0, 1, 2, 3, 4] as Priority[]).map((p) => (
                <button key={p} className="seg-btn" title={PRIORITY_LABEL[p]} onClick={() => st().updateItems(tasks, { priority: p } as Partial<Item>)}>
                  {p === 0 ? '—' : <PriorityFlag p={p} />}
                </button>
              ))}
            </div>
          </Section>
          <Section title="Chain" hint="Link the selected tasks in a sequence, ordered top-to-bottom / left-to-right.">
            <button
              className="btn"
              onClick={() => {
                const ordered = [...tasks].sort((a, b) => board.items[a].y - board.items[b].y || board.items[a].x - board.items[b].x);
                for (let i = 1; i < ordered.length; i++) st().connect('depends', ordered[i - 1], ordered[i]);
              }}
            >
              <Lock size={14} /> Make a sequence (each blocks the next)
            </button>
          </Section>
        </>
      )}
      <Section title="Color">
        <ColorSwatches value={null} onChange={(c) => st().updateItems(ids, { color: c })} />
      </Section>
      <Section title="Arrange">
        <div className="align-grid">
          <button className="tb-btn" title="Align left" onClick={() => st().align(ids, 'left')}><AlignStartVertical size={16} /></button>
          <button className="tb-btn" title="Align horizontal centers" onClick={() => st().align(ids, 'hcenter')}><AlignCenterVertical size={16} /></button>
          <button className="tb-btn" title="Align right" onClick={() => st().align(ids, 'right')}><AlignEndVertical size={16} /></button>
          <button className="tb-btn" title="Align top" onClick={() => st().align(ids, 'top')}><AlignStartHorizontal size={16} /></button>
          <button className="tb-btn" title="Align vertical centers" onClick={() => st().align(ids, 'vcenter')}><AlignCenterHorizontal size={16} /></button>
          <button className="tb-btn" title="Align bottom" onClick={() => st().align(ids, 'bottom')}><AlignEndHorizontal size={16} /></button>
          <button className="tb-btn" title="Distribute horizontally" onClick={() => st().distribute(ids, 'h')}><AlignHorizontalSpaceAround size={16} /></button>
          <button className="tb-btn" title="Distribute vertically" onClick={() => st().distribute(ids, 'v')}><AlignVerticalSpaceAround size={16} /></button>
        </div>
        <div className="btn-row">
          <button className="btn" onClick={() => st().layout('tree', ids)}><Network size={14} /> Tree</button>
          <button className="btn" onClick={() => st().layout('flow', ids)}><Workflow size={14} /> Flow</button>
          <button className="btn" onClick={() => st().wrapInFrame(ids)}><Frame size={14} /> Wrap in area</button>
        </div>
      </Section>
      <div className="item-actions">
        <span className="grow" />
        <button className="btn danger" onClick={() => st().deleteItems(ids)}>
          <Trash2 size={14} /> Delete {ids.length}
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Board overview (nothing selected)                                     */
/* ------------------------------------------------------------------ */

function BoardPanel() {
  const board = useStore((s) => s.board());
  const a = useStore((s) => s.analysis);
  const st = useStore.getState;
  const s = a.stats;
  const nameRef = useRef<HTMLInputElement>(null);
  return (
    <div>
      <input ref={nameRef} className="title-input single" value={board.name} onChange={(e) => st().renameBoard(board.id, e.target.value)} />
      {s.total > 0 ? (
        <div className="stat-grid">
          <Stat n={s.ready} label="ready" cls="st-ready" />
          <Stat n={s.doing} label="in progress" cls="st-doing" />
          <Stat n={s.blocked} label="blocked" cls="st-blocked" />
          <Stat n={s.done} label="done" cls="st-done" />
          {s.overdue > 0 && <Stat n={s.overdue} label="overdue" cls="overdue" />}
          {s.remainingHours > 0 && <Stat n={formatHours(s.remainingHours)} label="estimated left" cls="" />}
        </div>
      ) : (
        <p className="panel-hint">Empty board. Double-click the canvas or press T to add your first task.</p>
      )}
      {a.next.length > 0 && (
        <Section title="Next up" count={a.next.length}>
          {a.next.slice(0, 5).map((id) => (
            <div key={id} className="rel-row">
              <SubtaskCheck id={id} />
              <TaskRef id={id} showState={false} />
            </div>
          ))}
        </Section>
      )}
      {a.cycle.size > 0 && (
        <div className="warning w-cycle">
          <AlertTriangle size={13} /> {a.cycle.size} tasks are in a circular dependency.
        </div>
      )}
      <Section title="How it works">
        <div className="legend">
          <LegendRow icon={<LinkIcon type="depends" />} name="Blocks" text="A → B: B can’t start until A is done." />
          <LegendRow icon={<LinkIcon type="soft" />} name="Better before" text="Advisory order. Shapes the plan, never blocks." />
          <LegendRow icon={<LinkIcon type="subtask" />} name="Subtask" text="B is a part of A. A is done when all parts are; if A is blocked, so are its parts." />
          <LegendRow icon={<LinkIcon type="relates" />} name="Related" text="Just a reference — no effect on status." />
          <LegendRow icon={<LinkIcon type="annotates" />} name="Note" text="A note attached to a task; shown with it in every view." />
          <LegendRow icon={<Diamond size={16} />} name="Milestone" text="A checkpoint with no work of its own, reached when its prerequisites are done." />
          <LegendRow icon={<Frame size={16} />} name="Area" text="Spatial grouping (project / phase / context). Becomes a section in the list." />
        </div>
        <div className="legend states">
          {(['ready', 'doing', 'blocked', 'done', 'dropped'] as const).map((s) => (
            <StateBadge key={s} state={s} small />
          ))}
        </div>
      </Section>
    </div>
  );
}

const Stat = ({ n, label, cls }: { n: number | string; label: string; cls: string }) => (
  <div className={`stat ${cls}`}>
    <b>{n}</b>
    <span>{label}</span>
  </div>
);

const LegendRow = ({ icon, name, text }: { icon: React.ReactNode; name: string; text: string }) => (
  <div className="legend-row">
    <span className="legend-icon">{icon}</span>
    <div>
      <b>{name}</b>
      <span>{text}</span>
    </div>
  </div>
);
