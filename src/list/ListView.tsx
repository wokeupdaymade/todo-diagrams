import {
  AlertTriangle,
  ArrowRight,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Clock,
  Crosshair,
  Diamond,
  EyeOff,
  Flame,
  ListTree,
  Lock,
  MoreHorizontal,
  Plus,
  RotateCcw,
  Search,
  StickyNote,
  Tag,
  X,
  Zap,
  ListOrdered,
  CheckCheck,
} from 'lucide-react';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { upstreamOf, type Analysis, type TaskInfo } from '../model/engine';
import { titleOf } from '../model/rules';
import type { Board, FrameItem, ID, NoteItem, TaskItem } from '../model/types';
import { isTask } from '../model/types';
import { useStore, type ListMode } from '../store/store';
import { useActivePane } from '../canvas/Canvas';
import {
  formatDue,
  formatHours,
  isTypingTarget,
  PRIORITY_LABEL,
  PriorityFlag,
  StateBadge,
  StatusCheck,
  TaskPath,
  TaskRef,
} from '../ui/common';
import { MenuItem, MenuSep, Popover } from '../ui/Popover';

const MODES: { mode: ListMode; label: string; icon: React.ReactNode; hint: string }[] = [
  { mode: 'outline', label: 'Outline', icon: <ListTree size={15} />, hint: 'All tasks as a hierarchy, grouped by area' },
  { mode: 'next', label: 'Next up', icon: <Zap size={15} />, hint: 'What you can work on right now' },
  { mode: 'plan', label: 'Plan', icon: <ListOrdered size={15} />, hint: 'Suggested step-by-step order respecting all dependencies' },
  { mode: 'waiting', label: 'Waiting', icon: <Lock size={15} />, hint: 'Blocked tasks and what they wait for' },
  { mode: 'done', label: 'Done', icon: <CheckCheck size={15} />, hint: 'Completed and dropped tasks' },
];

function matches(t: TaskItem, q: string, tag: string | null) {
  if (tag && !t.tags.includes(tag)) return false;
  if (!q) return true;
  const n = q.toLowerCase();
  return t.title.toLowerCase().includes(n) || t.description.toLowerCase().includes(n) || t.tags.some((x) => x.toLowerCase().includes(n));
}

export function ListView() {
  const board = useStore((s) => s.board());
  const analysis = useStore((s) => s.analysis);
  const mode = useStore((s) => s.ui.listMode);
  const search = useStore((s) => s.ui.search);
  const tagFilter = useStore((s) => s.ui.tagFilter);
  const reveal = useStore((s) => s.ui.listRevealRequest);
  const setUI = useStore((s) => s.setUI);
  const activePane = useActivePane();
  const [collapsed, setCollapsed] = useState<Set<ID>>(new Set());
  const [hideDone, setHideDone] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  const allTags = useMemo(() => {
    const s = new Set<string>();
    for (const it of Object.values(board.items)) if (isTask(it)) it.tags.forEach((t) => s.add(t));
    return [...s].sort();
  }, [board]);

  // reveal: expand ancestors & scroll
  useEffect(() => {
    if (!reveal) return;
    const info = analysis.tasks.get(reveal.id);
    if (info) {
      setCollapsed((c) => {
        const n = new Set(c);
        info.ancestors.forEach((a) => n.delete(a));
        return n;
      });
    }
    const t = setTimeout(() => {
      const el = scroller.current?.querySelector(`[data-row="${reveal.id}"]`);
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el?.classList.add('flash');
      setTimeout(() => el?.classList.remove('flash'), 1200);
    }, 60);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reveal]);

  // keyboard when the list pane is active and no input focused
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = useStore.getState();
      const ui = st.ui;
      if (isTypingTarget(e.target) || ui.paletteOpen || ui.helpOpen) return;
      if (ui.view === 'canvas' || (ui.view === 'split' && activePane.current !== 'list')) return;
      const rows = [...(scroller.current?.querySelectorAll<HTMLElement>('[data-row]') ?? [])];
      const ids = rows.map((r) => r.dataset.row!);
      const cur = ui.selection.length === 1 ? ui.selection[0] : null;
      const i = cur ? ids.indexOf(cur) : -1;
      if (e.key === 'ArrowDown' || e.key === 'j') {
        e.preventDefault();
        const n = ids[Math.min(ids.length - 1, i + 1)];
        if (n) (st.select([n]), rows[ids.indexOf(n)]?.scrollIntoView({ block: 'nearest' }));
      } else if (e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault();
        const n = ids[Math.max(0, i - 1)];
        if (n) (st.select([n]), rows[ids.indexOf(n)]?.scrollIntoView({ block: 'nearest' }));
      } else if (e.key === 'Enter' && cur && st.ui.listMode === 'outline') {
        e.preventDefault();
        st.setUI({ listEditId: cur });
      } else if (e.key === 'Tab' && cur && st.ui.listMode === 'outline') {
        e.preventDefault();
        if (e.shiftKey) st.outdent(cur);
        else st.indent(cur);
      } else if (e.key === 'ArrowRight' && cur) {
        setCollapsed((c) => {
          const n = new Set(c);
          n.delete(cur);
          return n;
        });
      } else if (e.key === 'ArrowLeft' && cur) {
        setCollapsed((c) => new Set(c).add(cur));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activePane]);

  const toggle = (id: ID) =>
    setCollapsed((c) => {
      const n = new Set(c);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const counts = {
    next: analysis.next.length,
    waiting: analysis.stats.blocked,
    done: analysis.stats.done + analysis.stats.dropped,
    plan: analysis.plan.length,
  };

  return (
    <div className="list-view" onPointerDownCapture={() => (activePane.current = 'list')}>
      <div className="list-header">
        <div className="list-tabs">
          {MODES.map((m) => (
            <button key={m.mode} className={`list-tab ${mode === m.mode ? 'active' : ''}`} title={m.hint} onClick={() => setUI({ listMode: m.mode })}>
              {m.icon}
              <span>{m.label}</span>
              {m.mode !== 'outline' && <span className="count">{counts[m.mode as keyof typeof counts]}</span>}
            </button>
          ))}
        </div>
        <div className="list-filters">
          <div className="search-box">
            <Search size={14} />
            <input
              id="list-search"
              placeholder="Filter tasks…"
              value={search}
              onChange={(e) => setUI({ search: e.target.value })}
              onKeyDown={(e) => e.key === 'Escape' && ((e.target as HTMLInputElement).blur(), setUI({ search: '' }))}
            />
            {search && (
              <button className="icon-btn" onClick={() => setUI({ search: '' })}>
                <X size={13} />
              </button>
            )}
          </div>
          {allTags.length > 0 && (
            <Popover trigger={<span className="tag-filter-btn"><Tag size={14} />{tagFilter ? `#${tagFilter}` : ''}</span>} title="Filter by tag" align="right">
              {(close) => (
                <>
                  <MenuItem label="All tags" active={!tagFilter} onClick={() => (setUI({ tagFilter: null }), close())} />
                  <MenuSep />
                  {allTags.map((t) => (
                    <MenuItem key={t} label={`#${t}`} active={tagFilter === t} onClick={() => (setUI({ tagFilter: t }), close())} />
                  ))}
                </>
              )}
            </Popover>
          )}
          {mode === 'outline' && (
            <>
              <button className={`tb-btn ${hideDone ? 'active' : ''}`} title="Hide completed" onClick={() => setHideDone(!hideDone)}>
                <EyeOff size={15} />
              </button>
              <button
                className="tb-btn"
                title={collapsed.size ? 'Expand all' : 'Collapse all'}
                onClick={() =>
                  setCollapsed(collapsed.size ? new Set() : new Set([...analysis.tasks.values()].filter((i) => i.composite).map((i) => i.id)))
                }
              >
                {collapsed.size ? <ChevronsUpDown size={15} /> : <ChevronsDownUp size={15} />}
              </button>
            </>
          )}
        </div>
      </div>
      <BoardSummary analysis={analysis} />
      <div className="list-scroll" ref={scroller}>
        {mode === 'outline' && (
          <Outline board={board} analysis={analysis} collapsed={collapsed} toggle={toggle} hideDone={hideDone} q={search} tag={tagFilter} />
        )}
        {mode === 'next' && <NextUp board={board} analysis={analysis} q={search} tag={tagFilter} />}
        {mode === 'plan' && <Plan board={board} analysis={analysis} q={search} tag={tagFilter} />}
        {mode === 'waiting' && <Waiting board={board} analysis={analysis} q={search} tag={tagFilter} />}
        {mode === 'done' && <Done board={board} analysis={analysis} q={search} tag={tagFilter} />}
      </div>
    </div>
  );
}

function BoardSummary({ analysis }: { analysis: Analysis }) {
  const s = analysis.stats;
  if (!s.total) return null;
  const pct = Math.round(((s.done + s.dropped) / s.total) * 100);
  return (
    <div className="board-summary">
      <div className="summary-bar" title={`${pct}% complete`}>
        <span className="seg st-done" style={{ flex: s.done }} />
        <span className="seg st-doing" style={{ flex: s.doing }} />
        <span className="seg st-ready" style={{ flex: s.ready }} />
        <span className="seg st-blocked" style={{ flex: s.blocked }} />
      </div>
      <div className="summary-text">
        <b>{pct}%</b> · {s.doing} in progress · {s.ready} ready · {s.blocked} blocked
        {s.overdue > 0 && <span className="overdue"> · {s.overdue} overdue</span>}
        {s.remainingHours > 0 && <> · {formatHours(s.remainingHours)} left</>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Outline                                                              */
/* ------------------------------------------------------------------ */

function Outline({
  board,
  analysis,
  collapsed,
  toggle,
  hideDone,
  q,
  tag,
}: {
  board: Board;
  analysis: Analysis;
  collapsed: Set<ID>;
  toggle: (id: ID) => void;
  hideDone: boolean;
  q: string;
  tag: string | null;
}) {
  const addTask = useStore((s) => s.addTask);
  const filtering = !!q || !!tag;

  // visible set under filters: matching tasks + their ancestors
  const visible = useMemo(() => {
    if (!filtering && !hideDone) return null;
    const v = new Set<ID>();
    for (const [id, info] of analysis.tasks) {
      const t = board.items[id] as TaskItem;
      if (hideDone && info.resolved) continue;
      if (!matches(t, q, tag)) continue;
      v.add(id);
      info.ancestors.forEach((a) => v.add(a));
    }
    return v;
  }, [analysis, board, q, tag, hideDone, filtering]);

  const frames = Object.values(board.items)
    .filter((i): i is FrameItem => i.kind === 'frame')
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const sections: { frame: FrameItem | null; roots: ID[] }[] = frames.map((f) => ({ frame: f, roots: [] }));
  const loose: ID[] = [];
  for (const r of analysis.roots) {
    const t = board.items[r] as TaskItem;
    const s = sections.find((x) => x.frame?.id === t.frameId);
    if (s) s.roots.push(r);
    else loose.push(r);
  }
  const all = [...sections, { frame: null, roots: loose }].filter((s) => s.roots.length || (s.frame && !filtering));

  if (!analysis.tasks.size) {
    return (
      <div className="list-empty">
        <p>No tasks yet.</p>
        <button className="btn primary" onClick={() => addTask({ edit: 'list' })}>
          <Plus size={14} /> Add a task
        </button>
      </div>
    );
  }

  const renderRow = (id: ID, depth: number): React.ReactNode => {
    if (visible && !visible.has(id)) return null;
    const info = analysis.tasks.get(id)!;
    const open = !collapsed.has(id) || filtering;
    return (
      <div key={id} className="outline-node">
        <OutlineRow id={id} depth={depth} open={open} toggle={toggle} />
        {open && info.childIds.map((c) => renderRow(c, depth + 1))}
      </div>
    );
  };

  return (
    <div className="outline">
      {all.map((s) => (
        <section key={s.frame?.id ?? 'loose'} className="outline-section">
          <div className={`section-head ${s.frame?.color ? `c-${s.frame.color}` : ''}`}>
            <span className="section-dot" />
            <span className="section-title">{s.frame ? s.frame.title || 'Area' : frames.length ? 'Outside areas' : 'Tasks'}</span>
            <SectionProgress analysis={analysis} roots={s.roots} />
            {s.frame && (
              <button className="icon-btn" title="Show area on canvas" onClick={() => useStore.getState().revealOnCanvas(s.frame!.id)}>
                <Crosshair size={13} />
              </button>
            )}
          </div>
          {s.roots.map((r) => renderRow(r, 0))}
          {!filtering && (
            <button className="add-row" onClick={() => addTask({ frameId: s.frame?.id ?? null, edit: 'list' })}>
              <Plus size={14} /> Add task
            </button>
          )}
        </section>
      ))}
    </div>
  );
}

function SectionProgress({ analysis, roots }: { analysis: Analysis; roots: ID[] }) {
  let done = 0,
    total = 0;
  const walk = (id: ID) => {
    const i = analysis.tasks.get(id)!;
    if (i.composite) i.childIds.forEach(walk);
    else if (i.status !== 'dropped') {
      total++;
      if (i.status === 'done') done++;
    }
  };
  roots.forEach(walk);
  if (!total) return null;
  return (
    <span className="section-progress">
      <span className="bar">
        <span style={{ width: `${(done / total) * 100}%` }} />
      </span>
      {done}/{total}
    </span>
  );
}

const OutlineRow = memo(function OutlineRow({
  id,
  depth,
  open,
  toggle,
}: {
  id: ID;
  depth: number;
  open: boolean;
  toggle: (id: ID) => void;
}) {
  const t = useStore((s) => s.board().items[id]) as TaskItem;
  const info = useStore((s) => s.analysis.tasks.get(id))!;
  const selected = useStore((s) => s.ui.selection.includes(id));
  const editReq = useStore((s) => s.ui.listEditId === id);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editReq && inputRef.current) {
      inputRef.current.focus();
      const len = inputRef.current.value.length;
      inputRef.current.setSelectionRange(len, len);
      useStore.getState().setUI({ listEditId: null });
    }
  }, [editReq]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [t?.title]);

  if (!t || !info) return null;

  const focusSibling = (dir: 1 | -1) => {
    const inputs = [...document.querySelectorAll<HTMLTextAreaElement>('.outline-input')];
    const i = inputs.indexOf(inputRef.current!);
    const n = inputs[i + dir];
    if (n) {
      n.focus();
      const len = n.value.length;
      n.setSelectionRange(len, len);
    }
  };

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const st = useStore.getState();
    const el = e.currentTarget;
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      st.toggleDone([id]);
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      // split at caret like an outliner: text after the caret moves to the new task
      const before = el.value.slice(0, el.selectionStart);
      const after = el.value.slice(el.selectionEnd);
      if (after && before) st.updateItem<TaskItem>(id, { title: before.trim() });
      if (info.composite && open && !after) {
        // like an outliner: Enter on an expanded parent inserts its first child
        const nid = st.addTask({ parentId: id, edit: 'list', title: '' });
        useStore.getState().setParent(nid, id, 0);
      } else st.addTask({ after: id, edit: 'list', title: before ? after.trim() : '' });
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const ok = e.shiftKey ? st.outdent(id) : st.indent(id);
      if (ok) st.setUI({ listEditId: id });
    } else if (e.key === 'Backspace' && el.value === '' && !info.composite) {
      e.preventDefault();
      focusSibling(-1);
      st.deleteItems([id]);
    } else if (e.key === 'ArrowUp' && e.altKey) {
      e.preventDefault();
      st.moveSibling(id, -1);
      st.setUI({ listEditId: id });
    } else if (e.key === 'ArrowDown' && e.altKey) {
      e.preventDefault();
      st.moveSibling(id, 1);
      st.setUI({ listEditId: id });
    } else if (e.key === 'ArrowUp' && el.selectionStart === 0) {
      e.preventDefault();
      focusSibling(-1);
    } else if (e.key === 'ArrowDown' && el.selectionEnd === el.value.length) {
      e.preventDefault();
      focusSibling(1);
    } else if (e.key === 'Escape') {
      el.blur();
    }
  };

  const due = formatDue(t.due);
  return (
    <div
      data-row={id}
      className={`outline-row st-${info.state} ${selected ? 'selected' : ''} ${t.milestone ? 'milestone' : ''} ${info.composite ? 'composite' : ''}`}
      style={{ paddingLeft: 8 + depth * 22 }}
      onClick={(e) => {
        const st = useStore.getState();
        if (e.shiftKey || e.metaKey || e.ctrlKey) st.toggleSelect(id);
        else if (!selected) st.select([id]);
      }}
    >
      <span className="row-guides" style={{ width: depth * 22 }}>
        {Array.from({ length: depth }).map((_, i) => (
          <span key={i} className="guide" style={{ left: 8 + i * 22 + 9 }} />
        ))}
      </span>
      <button className={`row-chevron ${info.composite ? '' : 'invisible'}`} onClick={(e) => (e.stopPropagation(), toggle(id))}>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>
      {t.color && <span className={`row-color c-${t.color}`} />}
      <StatusCheck info={info} task={t} size={17} />
      {t.milestone && <Diamond size={13} className="row-milestone" />}
      <div className="row-main">
        <textarea
          ref={inputRef}
          rows={1}
          className="outline-input"
          value={t.title}
          placeholder={t.milestone ? 'Milestone' : 'Task'}
          onFocus={() => {
            const st = useStore.getState();
            if (!(st.ui.selection.length === 1 && st.ui.selection[0] === id)) st.select([id]);
          }}
          onChange={(e) => useStore.getState().updateItem<TaskItem>(id, { title: e.target.value.replace(/\n/g, ' ') })}
          onKeyDown={onKey}
        />
        <RowRelations info={info} selected={selected} />
      </div>
      <RowMeta t={t} info={info} dueText={due} />
      <RowActions id={id} info={info} />
    </div>
  );
});

function RowRelations({ info, selected }: { info: TaskInfo; selected: boolean }) {
  const board = useStore((s) => s.board());
  const notes = info.notes.map((n) => board.items[n] as NoteItem).filter(Boolean);
  // In the outline, inherited blockers are already visible on the ancestor row — only show own blockers.
  const own = info.blockers.filter((b) => !b.via);
  const inheritedOnly = info.state === 'blocked' && !own.length;
  const showBlockers = info.state === 'blocked' && own.length > 0;
  const showSoft = info.softPending.length > 0 && !info.resolved;
  const showUnblocks = selected && info.dependents.length > 0;
  if (!showBlockers && !showSoft && !showUnblocks && !(selected && notes.length) && !(selected && inheritedOnly)) return null;
  return (
    <div className="row-relations">
      {showBlockers && (
        <span className="rel blocked">
          <Lock size={11} /> after
          {own.slice(0, 3).map((b) => (
            <TaskRef key={b.id} id={b.id} />
          ))}
          {own.length > 3 && <span>+{own.length - 3}</span>}
        </span>
      )}
      {selected && inheritedOnly && (
        <span className="rel blocked">
          <Lock size={11} /> waits with its parent for
          {info.blockers.slice(0, 2).map((b) => (
            <TaskRef key={b.id} id={b.id} />
          ))}
        </span>
      )}
      {showSoft && (
        <span className="rel soft">
          better after
          {info.softPending.slice(0, 2).map((b) => (
            <TaskRef key={b} id={b} />
          ))}
        </span>
      )}
      {showUnblocks && (
        <span className="rel unblocks">
          <ArrowRight size={11} /> unblocks
          {info.dependents.slice(0, 3).map((d) => (
            <TaskRef key={d} id={d} />
          ))}
          {info.dependents.length > 3 && <span>+{info.dependents.length - 3}</span>}
        </span>
      )}
      {selected &&
        notes.map((n) => (
          <span key={n.id} className="rel note" title={n.text}>
            <StickyNote size={11} /> {n.text.split('\n')[0].replace(/[*_#`]/g, '').slice(0, 80)}
          </span>
        ))}
    </div>
  );
}

function RowMeta({ t, info, dueText }: { t: TaskItem; info: TaskInfo; dueText: ReturnType<typeof formatDue> }) {
  return (
    <div className="row-meta">
      {info.warnings.length > 0 && !info.resolved && (
        <span className="meta-warn" title={info.warnings.map((w) => w.message).join('\n')}>
          <AlertTriangle size={13} />
        </span>
      )}
      {info.notes.length > 0 && (
        <span className="meta-chip subtle" title={`${info.notes.length} note(s)`}>
          <StickyNote size={11} />
          {info.notes.length}
        </span>
      )}
      {t.tags.map((tag) => (
        <span key={tag} className="meta-tag">
          #{tag}
        </span>
      ))}
      {info.impact > 0 && !info.resolved && (
        <span className="meta-chip subtle" title={`${info.impact} open task(s) wait on this`}>
          <ArrowRight size={11} />
          {info.impact}
        </span>
      )}
      {info.progress && (
        <span className="meta-progress" title={`${info.progress.done}/${info.progress.total} ${info.progress.unit}`}>
          <span className="bar">
            <span style={{ width: `${info.progress.ratio * 100}%` }} />
          </span>
          {info.progress.done}/{info.progress.total}
        </span>
      )}
      {info.remainingEstimate > 0 && <span className="meta-chip subtle">{formatHours(info.remainingEstimate)}</span>}
      {dueText && (
        <span className={`meta-chip due ${info.resolved ? '' : dueText.cls}`}>
          <Clock size={11} /> {dueText.text}
        </span>
      )}
      <PriorityFlag p={t.priority} />
      {(info.state === 'doing' || info.state === 'blocked') && <StateBadge state={info.state} small />}
    </div>
  );
}

function RowActions({ id, info }: { id: ID; info: TaskInfo }) {
  const st = useStore.getState;
  return (
    <div className="row-actions" onClick={(e) => e.stopPropagation()}>
      <button className="icon-btn" title="Show on canvas" onClick={() => st().revealOnCanvas(id)}>
        <Crosshair size={14} />
      </button>
      <Popover trigger={<MoreHorizontal size={14} />} align="right" className="row-more">
        {(close) => (
          <>
            {!(st().board().items[id] as TaskItem).milestone && (
              <MenuItem label="Add subtask" hint="Tab" onClick={() => (st().addTask({ parentId: id, edit: 'list' }), close())} />
            )}
            <MenuItem label="Add next step" onClick={() => (st().addTask({ nextOf: id, edit: 'list' }), close())} />
            <MenuItem label="Add prerequisite" onClick={() => (st().addTask({ prereqOf: id, edit: 'list' }), close())} />
            <MenuSep />
            {!info.composite && !info.gated && <MenuItem label="Start (in progress)" onClick={() => (st().setStatus([id], 'doing'), close())} />}
            <MenuItem
              label={info.status === 'dropped' ? 'Restore' : 'Drop'}
              onClick={() => (st().setStatus([id], info.status === 'dropped' ? 'todo' : 'dropped'), close())}
            />
            {info.parentId && <MenuItem label="Move out of parent" hint="⇧Tab" onClick={() => (st().outdent(id), close())} />}
            <MenuSep />
            <MenuItem label="Delete" danger onClick={() => (st().deleteItems([id]), close())} />
            {info.composite && <MenuItem label="Delete with subtasks" danger onClick={() => (st().deleteItems([id], { withSubtasks: true }), close())} />}
          </>
        )}
      </Popover>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Flat task row used by the other modes                                */
/* ------------------------------------------------------------------ */

function FlatRow({ id, lead, children }: { id: ID; lead?: React.ReactNode; children?: React.ReactNode }) {
  const t = useStore((s) => s.board().items[id]) as TaskItem;
  const info = useStore((s) => s.analysis.tasks.get(id))!;
  const selected = useStore((s) => s.ui.selection.includes(id));
  if (!t || !info) return null;
  const due = formatDue(t.due);
  return (
    <div
      data-row={id}
      className={`flat-row st-${info.state} ${selected ? 'selected' : ''}`}
      onClick={() => useStore.getState().select([id])}
      onDoubleClick={() => useStore.getState().revealOnCanvas(id)}
    >
      {lead}
      <StatusCheck info={info} task={t} size={17} />
      <div className="row-main">
        <div className="flat-title">
          {t.milestone && <Diamond size={12} className="row-milestone" />}
          <span className={t.title ? '' : 'placeholder'}>{t.title || 'Untitled task'}</span>
          <TaskPath id={id} />
        </div>
        {children && <div className="row-relations">{children}</div>}
      </div>
      <RowMeta t={t} info={info} dueText={due} />
      <div className="row-actions">
        <button className="icon-btn" title="Show on canvas" onClick={(e) => (e.stopPropagation(), useStore.getState().revealOnCanvas(id))}>
          <Crosshair size={14} />
        </button>
      </div>
    </div>
  );
}

type ModeProps = { board: Board; analysis: Analysis; q: string; tag: string | null };

const filterIds = (ids: ID[], board: Board, q: string, tag: string | null) =>
  ids.filter((id) => matches(board.items[id] as TaskItem, q, tag));

function Why({ info, board }: { info: TaskInfo; board: Board }) {
  const t = board.items[info.id] as TaskItem;
  const parts: React.ReactNode[] = [];
  if (info.urgency > t.priority && info.urgency >= 3)
    parts.push(
      <span key="u" className="rel why">
        <Flame size={11} /> {PRIORITY_LABEL[info.urgency].toLowerCase()} — something important waits on it
      </span>,
    );
  if (info.neededBy && info.neededByFor && info.neededByFor !== info.id) {
    const d = formatDue(info.neededBy);
    parts.push(
      <span key="n" className={`rel why ${d?.cls ?? ''}`}>
        <Clock size={11} /> needed by {d?.text} for <TaskRef id={info.neededByFor} showState={false} />
      </span>,
    );
  }
  if (info.impact > 0)
    parts.push(
      <span key="i" className="rel unblocks">
        <ArrowRight size={11} /> unblocks {info.impact} task{info.impact > 1 ? 's' : ''}
      </span>,
    );
  if (info.critical)
    parts.push(
      <span key="c" className="rel critical">
        on the critical path
      </span>,
    );
  return <>{parts}</>;
}

function NextUp({ board, analysis, q, tag }: ModeProps) {
  const ids = filterIds(analysis.next, board, q, tag);
  const doing = ids.filter((id) => analysis.tasks.get(id)!.state === 'doing');
  const ready = ids.filter((id) => analysis.tasks.get(id)!.state === 'ready');
  if (!ids.length)
    return (
      <div className="list-empty">
        <p>{analysis.stats.open ? 'Nothing is actionable right now — everything open is waiting on something.' : 'Nothing left to do. 🎉'}</p>
      </div>
    );
  return (
    <div className="flat-list">
      {doing.length > 0 && <div className="group-head">In progress · {doing.length}</div>}
      {doing.map((id) => (
        <FlatRow key={id} id={id}>
          <Why info={analysis.tasks.get(id)!} board={board} />
        </FlatRow>
      ))}
      {ready.length > 0 && (
        <div className="group-head">
          Ready to start · {ready.length}
          <span className="group-hint">ordered by urgency, deadline and how much they unblock</span>
        </div>
      )}
      {ready.map((id) => (
        <FlatRow key={id} id={id}>
          <Why info={analysis.tasks.get(id)!} board={board} />
        </FlatRow>
      ))}
    </div>
  );
}

function Plan({ board, analysis, q, tag }: ModeProps) {
  // milestones as dividers after the last step they depend on
  const dividers = useMemo(() => {
    const m = new Map<number, ID[]>();
    for (const [id, info] of analysis.tasks) {
      const t = board.items[id] as TaskItem;
      if (!t.milestone || info.resolved) continue;
      const ups = upstreamOf(analysis, id);
      let last = 0;
      for (const u of ups) last = Math.max(last, analysis.tasks.get(u)?.step ?? 0);
      const arr = m.get(last) ?? [];
      arr.push(id);
      m.set(last, arr);
    }
    return m;
  }, [analysis, board]);

  const ids = new Set(filterIds(analysis.plan, board, q, tag));
  if (!analysis.plan.length) return <div className="list-empty"><p>No open tasks — nothing to plan.</p></div>;
  let cumulative = 0;
  const rows: React.ReactNode[] = [];
  const pushDividers = (step: number) =>
    (dividers.get(step) ?? []).forEach((m) =>
      rows.push(
        <div key={`ms-${m}`} className="plan-milestone" onClick={() => useStore.getState().select([m])}>
          <Diamond size={13} /> {titleOf(board.items[m])}
          <span className="group-hint">milestone reached{cumulative ? ` · ~${formatHours(cumulative)} of work from now` : ''}</span>
        </div>,
      ),
    );
  pushDividers(0);
  for (const id of analysis.plan) {
    const info = analysis.tasks.get(id)!;
    cumulative += info.remainingEstimate;
    if (ids.has(id)) {
      const openPrereqs = [...info.blockers.map((b) => b.id), ...info.softPending];
      rows.push(
        <FlatRow key={id} id={id} lead={<span className="step-no">{info.step}</span>}>
          {openPrereqs.length > 0 && (
            <span className={`rel ${info.blockers.length ? 'blocked' : 'soft'}`}>
              after
              {openPrereqs.slice(0, 3).map((p) => (
                <TaskRef key={p} id={p} />
              ))}
              {openPrereqs.length > 3 && <span>+{openPrereqs.length - 3}</span>}
            </span>
          )}
          {info.critical && <span className="rel critical">critical path</span>}
        </FlatRow>,
      );
    }
    pushDividers(info.step!);
  }
  return (
    <div className="flat-list plan">
      <div className="group-head">
        Suggested order · {analysis.plan.length} steps
        {analysis.stats.remainingHours > 0 && <> · ~{formatHours(analysis.stats.remainingHours)}</>}
        <span className="group-hint">respects every dependency; within that, in-progress, urgent and unblocking work first</span>
      </div>
      {rows}
    </div>
  );
}

function Waiting({ board, analysis, q, tag }: ModeProps) {
  const blocked = filterIds(
    [...analysis.tasks.values()].filter((i) => i.state === 'blocked' && !i.composite).map((i) => i.id),
    board,
    q,
    tag,
  ).sort((a, b) => (analysis.tasks.get(a)!.step ?? 0) - (analysis.tasks.get(b)!.step ?? 0));
  const startedBlocked = [...analysis.tasks.values()].filter((i) => i.warnings.some((w) => w.kind === 'started-blocked')).map((i) => i.id);

  // biggest bottlenecks: unresolved tasks that block the most
  const bottlenecks = [...analysis.tasks.values()]
    .filter((i) => !i.resolved && i.impact > 0 && !i.composite && (i.state === 'ready' || i.state === 'doing'))
    .sort((a, b) => b.impact - a.impact)
    .slice(0, 3);

  if (!blocked.length && !startedBlocked.length) return <div className="list-empty"><p>Nothing is blocked. 👍</p></div>;
  return (
    <div className="flat-list">
      {bottlenecks.length > 0 && (
        <div className="bottlenecks">
          <span className="group-hint">Biggest unblockers:</span>
          {bottlenecks.map((b) => (
            <TaskRef key={b.id} id={b.id}>
              <span className="via"> → {b.impact}</span>
            </TaskRef>
          ))}
        </div>
      )}
      <div className="group-head">Blocked · {blocked.length}</div>
      {blocked.map((id) => {
        const info = analysis.tasks.get(id)!;
        return (
          <FlatRow key={id} id={id}>
            <span className="rel blocked">
              <Lock size={11} /> waiting on
              {info.blockers.map((b) => (
                <TaskRef key={b.id} id={b.id}>
                  {b.via && <span className="via"> (inherited from {titleOf(board.items[b.via])})</span>}
                </TaskRef>
              ))}
            </span>
          </FlatRow>
        );
      })}
      {startedBlocked.length > 0 && (
        <>
          <div className="group-head">Started before prerequisites were done · {startedBlocked.length}</div>
          {startedBlocked.map((id) => (
            <FlatRow key={id} id={id}>
              <span className="rel blocked">
                still open:
                {analysis.tasks.get(id)!.blockers.map((b) => (
                  <TaskRef key={b.id} id={b.id} />
                ))}
              </span>
            </FlatRow>
          ))}
        </>
      )}
    </div>
  );
}

function Done({ board, analysis, q, tag }: ModeProps) {
  const ids = filterIds(
    [...analysis.tasks.values()].filter((i) => i.resolved && !i.composite).map((i) => i.id),
    board,
    q,
    tag,
  ).sort((a, b) => ((board.items[b] as TaskItem).completedAt ?? 0) - ((board.items[a] as TaskItem).completedAt ?? 0));
  if (!ids.length) return <div className="list-empty"><p>Nothing completed yet.</p></div>;
  return (
    <div className="flat-list">
      {ids.map((id) => {
        const t = board.items[id] as TaskItem;
        const info = analysis.tasks.get(id)!;
        return (
          <FlatRow key={id} id={id}>
            <span className="rel">
              {info.status === 'dropped' ? 'dropped' : t.completedAt ? `done ${new Date(t.completedAt).toLocaleDateString()}` : 'done'}
              {!info.gated && (
                <button className="link-btn" onClick={(e) => (e.stopPropagation(), useStore.getState().setStatus([id], 'todo'))}>
                  <RotateCcw size={11} /> reopen
                </button>
              )}
            </span>
          </FlatRow>
        );
      })}
    </div>
  );
}
