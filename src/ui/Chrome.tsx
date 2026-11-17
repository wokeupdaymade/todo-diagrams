import {
  Columns2,
  Copy,
  Download,
  FileJson,
  HelpCircle,
  LayoutDashboard,
  List,
  Moon,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightOpen,
  Pencil,
  Plus,
  Redo2,
  Search,
  Sparkles,
  Sun,
  Trash2,
  Undo2,
  Upload,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { titleOf } from '../model/rules';
import { isTask, type ID } from '../model/types';
import { downloadJSON, pickJSONFile } from '../store/persist';
import { useStore, type View } from '../store/store';
import { MenuItem, MenuSep, Popover } from './Popover';

/* ---------------- Sidebar ---------------- */

export function Sidebar() {
  const data = useStore((s) => s.data);
  const analysis = useStore((s) => s.analysis);
  const st = useStore.getState;
  const [renaming, setRenaming] = useState<ID | null>(null);
  const theme = useStore((s) => s.ui.theme);

  return (
    <aside className="sidebar">
      <div className="brand">
        <svg width="22" height="22" viewBox="0 0 32 32">
          <rect x="2" y="4" width="12" height="9" rx="2" fill="var(--accent)" />
          <rect x="18" y="19" width="12" height="9" rx="2" fill="var(--st-done)" />
          <path d="M14 8.5h4a2 2 0 0 1 2 2V19" stroke="var(--text-3)" strokeWidth="2" fill="none" />
        </svg>
        <span>Todo Diagrams</span>
        <span className="grow" />
        <button className="icon-btn" title="Hide sidebar" onClick={() => st().setUI({ sidebarOpen: false })}>
          <PanelLeftClose size={16} />
        </button>
      </div>
      <div className="side-head">
        <span>Boards</span>
        <span className="grow" />
        <Popover trigger={<Plus size={15} />} title="New board" align="right">
          {(close) => (
            <>
              <MenuItem icon={<Plus size={14} />} label="Empty board" onClick={() => (st().createBoard('Untitled board'), close())} />
              <MenuItem icon={<Sparkles size={14} />} label="Example project" onClick={() => (st().createBoard(undefined, true), close())} />
            </>
          )}
        </Popover>
      </div>
      <nav className="board-list">
        {data.boardOrder.map((id) => {
          const b = data.boards[id];
          if (!b) return null;
          const active = id === data.activeBoardId;
          const count = Object.values(b.items).filter(isTask).length;
          return (
            <div key={id} className={`board-item ${active ? 'active' : ''}`} onClick={() => st().switchBoard(id)} onDoubleClick={() => setRenaming(id)}>
              <LayoutDashboard size={15} />
              {renaming === id ? (
                <input
                  autoFocus
                  defaultValue={b.name}
                  onBlur={(e) => (st().renameBoard(id, e.target.value || 'Untitled board'), setRenaming(null))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    if (e.key === 'Escape') setRenaming(null);
                  }}
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <span className="ellipsis grow">{b.name}</span>
              )}
              {active && analysis.stats.total > 0 ? (
                <span className="board-progress" title={`${analysis.stats.done}/${analysis.stats.total} done`}>
                  {Math.round(((analysis.stats.done + analysis.stats.dropped) / analysis.stats.total) * 100)}%
                </span>
              ) : (
                <span className="board-count">{count || ''}</span>
              )}
              <div onClick={(e) => e.stopPropagation()} className="board-more">
                <Popover trigger={<MoreHorizontal size={14} />} align="right">
                  {(close) => (
                    <>
                      <MenuItem icon={<Pencil size={14} />} label="Rename" onClick={() => (setRenaming(id), close())} />
                      <MenuItem icon={<Copy size={14} />} label="Duplicate" onClick={() => (st().duplicateBoard(id), close())} />
                      <MenuItem icon={<Download size={14} />} label="Export as JSON" onClick={() => (downloadJSON(`${slug(b.name)}.json`, b), close())} />
                      <MenuSep />
                      <MenuItem
                        icon={<Trash2 size={14} />}
                        label="Delete board"
                        danger
                        onClick={() => {
                          close();
                          if (confirm(`Delete “${b.name}”? This can’t be undone (export it first if unsure).`)) st().deleteBoard(id);
                        }}
                      />
                    </>
                  )}
                </Popover>
              </div>
            </div>
          );
        })}
      </nav>
      <div className="side-foot">
        <button className="side-btn" onClick={() => downloadJSON(`todo-diagrams-backup-${new Date().toISOString().slice(0, 10)}.json`, st().data)}>
          <FileJson size={15} /> Export all
        </button>
        <button
          className="side-btn"
          onClick={() =>
            pickJSONFile()
              .then((d) => st().importData(d))
              .catch(() => undefined)
          }
        >
          <Upload size={15} /> Import
        </button>
        <div className="side-row">
          <button className="side-btn" onClick={() => st().setUI({ theme: theme === 'dark' ? 'light' : 'dark' })}>
            {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />} {theme === 'dark' ? 'Light' : 'Dark'}
          </button>
          <button className="side-btn" onClick={() => st().setUI({ helpOpen: true })}>
            <HelpCircle size={15} /> Help
          </button>
        </div>
        <div className="save-note">Saved locally in this browser</div>
      </div>
    </aside>
  );
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'board';

/* ---------------- Top bar ---------------- */

const VIEWS: { v: View; label: string; icon: React.ReactNode; key: string }[] = [
  { v: 'canvas', label: 'Canvas', icon: <LayoutDashboard size={15} />, key: 'Alt+1' },
  { v: 'split', label: 'Split', icon: <Columns2 size={15} />, key: 'Alt+2' },
  { v: 'list', label: 'List', icon: <List size={15} />, key: 'Alt+3' },
];

export function TopBar() {
  const view = useStore((s) => s.ui.view);
  const sidebarOpen = useStore((s) => s.ui.sidebarOpen);
  const inspectorOpen = useStore((s) => s.ui.inspectorOpen);
  const boardName = useStore((s) => s.board().name);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const st = useStore.getState;
  return (
    <header className="topbar">
      {!sidebarOpen && (
        <button className="icon-btn" title="Show sidebar" onClick={() => st().setUI({ sidebarOpen: true })}>
          <PanelLeftOpen size={17} />
        </button>
      )}
      <span className="board-name ellipsis">{boardName}</span>
      <div className="view-switch">
        {VIEWS.map((x) => (
          <button key={x.v} className={`vs-btn ${view === x.v ? 'active' : ''}`} title={`${x.label} (${x.key})`} onClick={() => st().setUI({ view: x.v })}>
            {x.icon}
            <span>{x.label}</span>
          </button>
        ))}
      </div>
      <span className="grow" />
      <button className="search-trigger" onClick={() => st().setUI({ paletteOpen: true })}>
        <Search size={14} />
        <span>Jump to…</span>
        <kbd>Ctrl K</kbd>
      </button>
      <button className="icon-btn" title="Undo (Ctrl+Z)" disabled={!canUndo} onClick={() => st().undo()}>
        <Undo2 size={17} />
      </button>
      <button className="icon-btn" title="Redo (Ctrl+Shift+Z)" disabled={!canRedo} onClick={() => st().redo()}>
        <Redo2 size={17} />
      </button>
      {!inspectorOpen && (
        <button className="icon-btn" title="Show details panel" onClick={() => st().setUI({ inspectorOpen: true })}>
          <PanelRightOpen size={17} />
        </button>
      )}
    </header>
  );
}

/* ---------------- Command palette ---------------- */

interface Cmd {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
  kind: 'item' | 'cmd';
  state?: string;
}

export function CommandPalette() {
  const open = useStore((s) => s.ui.paletteOpen);
  const board = useStore((s) => s.board());
  const analysis = useStore((s) => s.analysis);
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const st = useStore.getState;
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setQ('');
      setHi(0);
    }
  }, [open]);

  const results = useMemo<Cmd[]>(() => {
    if (!open) return [];
    const close = () => st().setUI({ paletteOpen: false });
    const cmds: Cmd[] = [
      { id: 'c-task', label: 'New task', hint: 'T', kind: 'cmd', run: () => (close(), st().addTask({ edit: st().ui.view === 'list' ? 'list' : 'canvas' })) },
      { id: 'c-canvas', label: 'Switch to canvas', hint: 'Alt+1', kind: 'cmd', run: () => (close(), st().setUI({ view: 'canvas' })) },
      { id: 'c-split', label: 'Switch to split view', hint: 'Alt+2', kind: 'cmd', run: () => (close(), st().setUI({ view: 'split' })) },
      { id: 'c-list', label: 'Switch to list', hint: 'Alt+3', kind: 'cmd', run: () => (close(), st().setUI({ view: 'list' })) },
      { id: 'c-next', label: 'Show next actions', kind: 'cmd', run: () => (close(), st().setUI({ view: st().ui.view === 'canvas' ? 'split' : st().ui.view, listMode: 'next' })) },
      { id: 'c-plan', label: 'Show suggested plan', kind: 'cmd', run: () => (close(), st().setUI({ view: st().ui.view === 'canvas' ? 'split' : st().ui.view, listMode: 'plan' })) },
      { id: 'c-tree', label: 'Arrange board as tree', hint: 'Shift+L', kind: 'cmd', run: () => (close(), st().layout('tree')) },
      { id: 'c-flow', label: 'Arrange board as flow', hint: 'Shift+W', kind: 'cmd', run: () => (close(), st().layout('flow')) },
      { id: 'c-crit', label: 'Toggle critical path', kind: 'cmd', run: () => (close(), st().setUI({ showCritical: !st().ui.showCritical })) },
      { id: 'c-theme', label: 'Toggle dark mode', kind: 'cmd', run: () => (close(), st().setUI({ theme: st().ui.theme === 'dark' ? 'light' : 'dark' })) },
      { id: 'c-help', label: 'Keyboard shortcuts & help', hint: '?', kind: 'cmd', run: () => st().setUI({ paletteOpen: false, helpOpen: true }) },
    ];
    for (const b of st().data.boardOrder) {
      const bd = st().data.boards[b];
      if (bd && b !== board.id) cmds.push({ id: `b-${b}`, label: `Open board: ${bd.name}`, kind: 'cmd', run: () => (close(), st().switchBoard(b)) });
    }
    const n = q.trim().toLowerCase();
    const items: Cmd[] = Object.values(board.items)
      .filter((i) => i.kind !== 'text' || n)
      .map((i) => ({
        id: i.id,
        label: titleOf(i),
        hint: i.kind === 'task' ? (i.milestone ? 'milestone' : 'task') : i.kind === 'frame' ? 'area' : i.kind,
        kind: 'item' as const,
        state: analysis.tasks.get(i.id)?.state,
        run: () => {
          close();
          if (st().ui.view === 'list' && i.kind === 'task') st().revealInList(i.id);
          else st().revealOnCanvas(i.id);
        },
      }));
    const score = (c: Cmd) => {
      if (!n) return c.kind === 'item' ? 1 : 0;
      const l = c.label.toLowerCase();
      if (l.startsWith(n)) return 3;
      if (l.includes(n)) return 2;
      // fuzzy subsequence
      let j = 0;
      for (const ch of l) if (ch === n[j]) j++;
      return j === n.length ? 1 : -1;
    };
    return [...items, ...cmds]
      .map((c) => ({ c, s: score(c) }))
      .filter((x) => x.s > 0 || (!n && x.c.kind === 'cmd'))
      .sort((a, b) => b.s - a.s)
      .slice(0, 40)
      .map((x) => x.c);
  }, [open, q, board, analysis, st]);

  useEffect(() => {
    listRef.current?.querySelector('.hi')?.scrollIntoView({ block: 'nearest' });
  }, [hi]);

  if (!open) return null;
  return (
    <div className="overlay" onMouseDown={() => st().setUI({ paletteOpen: false })}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()}>
        <div className="palette-input">
          <Search size={16} />
          <input
            autoFocus
            value={q}
            placeholder="Jump to a task, note, area… or run a command"
            onChange={(e) => (setQ(e.target.value), setHi(0))}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') (e.preventDefault(), setHi((h) => Math.min(results.length - 1, h + 1)));
              if (e.key === 'ArrowUp') (e.preventDefault(), setHi((h) => Math.max(0, h - 1)));
              if (e.key === 'Enter') results[hi]?.run();
              if (e.key === 'Escape') st().setUI({ paletteOpen: false });
            }}
          />
        </div>
        <div className="palette-list" ref={listRef}>
          {results.map((r, i) => (
            <button key={r.id} className={`palette-item ${i === hi ? 'hi' : ''}`} onMouseEnter={() => setHi(i)} onClick={() => r.run()}>
              {r.state ? <span className={`dot st-${r.state}`} /> : <span className={`dot ${r.kind === 'cmd' ? 'cmd' : ''}`} />}
              <span className="grow ellipsis">{r.label}</span>
              {r.hint && <span className="menu-hint">{r.hint}</span>}
            </button>
          ))}
          {!results.length && <div className="picker-empty">No results</div>}
        </div>
      </div>
    </div>
  );
}

/* ---------------- Help ---------------- */

const SHORTCUTS: [string, [string, string][]][] = [
  [
    'Create (canvas)',
    [
      ['Double-click / T', 'New task'],
      ['M', 'New milestone'],
      ['N', 'New note (attached to selected task)'],
      ['R · O · D', 'Rounded box · ellipse · decision shape'],
      ['A', 'New area (wraps selection)'],
      ['L', 'Text label'],
      ['Drag from edge dot', 'Connect; drop on empty space to create a connected task'],
    ],
  ],
  [
    'With a task selected',
    [
      ['Tab', 'Add subtask'],
      ['Ctrl+Enter', 'Add next step (blocked by this one)'],
      ['Shift+Enter', 'Add sibling'],
      ['Enter', 'Rename'],
      ['Space', 'Toggle done'],
      ['Shift+Space', 'Start / stop progress'],
      ['C', 'Collapse / expand subtasks'],
      ['F', 'Focus mode (dim unrelated)'],
      ['Del · Shift+Del', 'Delete · delete with subtasks'],
    ],
  ],
  [
    'Connections',
    [
      ['1', 'Blocks — must finish first'],
      ['2', 'Better before — advisory'],
      ['3', 'Subtask — is a part of'],
      ['4', 'Related'],
      ['5', 'Plain line'],
      ['Double-click link', 'Edit label'],
    ],
  ],
  [
    'Canvas',
    [
      ['Drag empty space', 'Select area'],
      ['Scroll / middle-drag / H', 'Pan'],
      ['Ctrl+scroll / pinch', 'Zoom'],
      ['Shift+1 · Shift+2', 'Fit all · zoom to selection'],
      ['Shift+L · Shift+W', 'Arrange as tree · flow'],
      ['Arrows (Shift)', 'Nudge'],
      ['Ctrl+C / V / D', 'Copy / paste / duplicate'],
    ],
  ],
  [
    'List (outline)',
    [
      ['Enter', 'New task below (splits at the cursor)'],
      ['Tab · Shift+Tab', 'Indent (make subtask) · outdent'],
      ['Alt+↑ / ↓', 'Reorder'],
      ['↑ / ↓', 'Move between rows'],
      ['Ctrl+Enter', 'Toggle done'],
      ['Backspace on empty', 'Delete row'],
    ],
  ],
  [
    'Everywhere',
    [
      ['Ctrl+K', 'Jump to / commands'],
      ['Ctrl+Z · Ctrl+Shift+Z', 'Undo · redo'],
      ['Alt+1 / 2 / 3', 'Canvas / split / list'],
      ['Esc', 'Clear selection'],
      ['?', 'This help'],
    ],
  ],
];

export function HelpOverlay() {
  const open = useStore((s) => s.ui.helpOpen);
  if (!open) return null;
  const close = () => useStore.getState().setUI({ helpOpen: false });
  return (
    <div className="overlay" onMouseDown={close}>
      <div className="help" onMouseDown={(e) => e.stopPropagation()}>
        <div className="help-head">
          <h2>How Todo Diagrams works</h2>
          <button className="icon-btn" onClick={close}>
            <X size={18} />
          </button>
        </div>
        <div className="help-model">
          <p>
            Every board is one model shown two ways: a <b>canvas</b> where you place and connect things, and a <b>list</b> that reads the same
            tasks as an outline, a to-do list of what’s actionable, and a step-by-step plan.
          </p>
          <ul>
            <li>
              <b>Subtask</b> links build a hierarchy. A parent’s status comes from its parts; if a parent is blocked, all its parts are too; waiting
              for a parent means waiting for all its parts.
            </li>
            <li>
              <b>Blocks</b> links are finish-to-start dependencies. A task is <i>blocked</i> while any prerequisite (its own or an ancestor’s) is
              unfinished. Dropped tasks count as resolved.
            </li>
            <li>
              <b>Better before</b> links order the plan without blocking. <b>Related</b> and <b>notes</b> carry context only.
            </li>
            <li>
              <b>Milestones</b> are reached automatically when their prerequisites are done. <b>Areas</b> group things spatially and become
              sections in the list.
            </li>
            <li>
              Prerequisites inherit urgency and deadlines from what waits on them, so the <i>Next up</i> list surfaces the work that matters.
              Circular dependencies are prevented.
            </li>
          </ul>
        </div>
        <div className="help-grid">
          {SHORTCUTS.map(([title, rows]) => (
            <div key={title} className="help-col">
              <h3>{title}</h3>
              {rows.map(([k, v]) => (
                <div key={k} className="help-row">
                  <kbd>{k}</kbd>
                  <span>{v}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------------- Toasts ---------------- */

export function Toasts() {
  const toasts = useStore((s) => s.ui.toasts);
  const dismiss = useStore((s) => s.dismissToast);
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <ToastItem key={t.id} id={t.id} kind={t.kind} text={t.text} action={t.action} onDismiss={dismiss} />
      ))}
    </div>
  );
}

function ToastItem({
  id,
  kind,
  text,
  action,
  onDismiss,
}: {
  id: string;
  kind: string;
  text: string;
  action?: { label: string; run: () => void };
  onDismiss: (id: string) => void;
}) {
  useEffect(() => {
    const t = setTimeout(() => onDismiss(id), kind === 'error' ? 6500 : 4000);
    return () => clearTimeout(t);
  }, [id, kind, onDismiss]);
  return (
    <div className={`toast toast-${kind}`}>
      <span>{text}</span>
      {action && (
        <button
          className="toast-action"
          onClick={() => {
            action.run();
            onDismiss(id);
          }}
        >
          {action.label}
        </button>
      )}
      <button className="icon-btn" onClick={() => onDismiss(id)}>
        <X size={13} />
      </button>
    </div>
  );
}
