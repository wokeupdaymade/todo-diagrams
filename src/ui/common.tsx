import DOMPurify from 'dompurify';
import { marked } from 'marked';
import {
  Ban,
  Check,
  CircleDashed,
  Flag,
  Lock,
  Play,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { TaskInfo, TaskState } from '../model/engine';
import type { ColorKey, ID, Priority, TaskItem } from '../model/types';
import { COLOR_KEYS } from '../model/types';
import { useStore } from '../store/store';

export const STATE_LABEL: Record<TaskState, string> = {
  ready: 'Ready',
  doing: 'In progress',
  blocked: 'Blocked',
  done: 'Done',
  dropped: 'Dropped',
};

export const PRIORITY_LABEL = ['None', 'Low', 'Medium', 'High', 'Urgent'];

export function StateBadge({ state, small }: { state: TaskState; small?: boolean }) {
  const Icon = state === 'blocked' ? Lock : state === 'doing' ? Play : state === 'done' ? Check : state === 'dropped' ? Ban : CircleDashed;
  return (
    <span className={`state-badge st-${state} ${small ? 'small' : ''}`}>
      <Icon size={small ? 10 : 12} strokeWidth={2.5} />
      {STATE_LABEL[state]}
    </span>
  );
}

/** The round status control used everywhere a task appears. */
export function StatusCheck({
  info,
  task,
  size = 18,
}: {
  info: TaskInfo;
  task: TaskItem;
  size?: number;
}) {
  const toggleDone = useStore((s) => s.toggleDone);
  const cycle = useStore((s) => s.cycleStatus);
  const derived = info.composite || info.gated;
  const title = derived
    ? info.composite
      ? `Derived from subtasks (${info.progress?.done ?? 0}/${info.progress?.total ?? 0}). Click to complete all.`
      : 'Milestone: reached when its prerequisites are done'
    : 'Click: toggle done · Shift+click: in progress';
  const ratio = info.progress?.unit === 'subtasks' ? info.progress.ratio : null;
  return (
    <button
      className={`status-check st-${info.state} ${derived ? 'derived' : ''} ${task.milestone ? 'milestone' : ''}`}
      style={{ width: size, height: size }}
      title={title}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        if (e.shiftKey && !derived) cycle(task.id);
        else toggleDone([task.id]);
      }}
    >
      {ratio !== null && info.state !== 'done' && info.state !== 'dropped' ? (
        <svg viewBox="0 0 20 20" className="ring">
          <circle cx="10" cy="10" r="7" className="ring-bg" />
          <circle
            cx="10"
            cy="10"
            r="7"
            className="ring-fg"
            strokeDasharray={`${ratio * 44} 44`}
            transform="rotate(-90 10 10)"
          />
        </svg>
      ) : info.state === 'done' ? (
        <Check size={size - 6} strokeWidth={3} />
      ) : info.state === 'dropped' ? (
        <Ban size={size - 6} strokeWidth={2.5} />
      ) : info.state === 'doing' ? (
        <span className="doing-dot" />
      ) : info.state === 'blocked' ? (
        <Lock size={size - 8} strokeWidth={2.5} />
      ) : null}
    </button>
  );
}

export function PriorityFlag({ p, showNone }: { p: Priority; showNone?: boolean }) {
  if (!p && !showNone) return null;
  return (
    <span className={`prio prio-${p}`} title={`Priority: ${PRIORITY_LABEL[p]}`}>
      <Flag size={12} strokeWidth={2.5} fill={p >= 3 ? 'currentColor' : 'none'} />
    </span>
  );
}

export function formatDue(due: string | null, today = new Date()): { text: string; cls: string } | null {
  if (!due) return null;
  const d = new Date(due + 'T00:00:00');
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const days = Math.round((d.getTime() - t0.getTime()) / 86400000);
  let text: string;
  if (days === 0) text = 'Today';
  else if (days === 1) text = 'Tomorrow';
  else if (days === -1) text = 'Yesterday';
  else if (days > 1 && days < 7) text = d.toLocaleDateString(undefined, { weekday: 'short' });
  else text = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d.getFullYear() !== today.getFullYear() ? 'numeric' : undefined });
  const cls = days < 0 ? 'overdue' : days <= 2 ? 'soon' : '';
  return { text, cls };
}

export function formatHours(h: number): string {
  if (!h) return '0h';
  if (h < 1) return `${Math.round(h * 60)}m`;
  if (h >= 8 && h % 8 === 0) return `${h / 8}d`;
  return `${Math.round(h * 10) / 10}h`;
}

export function ColorSwatches({
  value,
  onChange,
  allowNone = true,
}: {
  value: ColorKey | null;
  onChange: (c: ColorKey | null) => void;
  allowNone?: boolean;
}) {
  return (
    <div className="swatches">
      {allowNone && (
        <button className={`swatch none ${value === null ? 'active' : ''}`} title="Default" onClick={() => onChange(null)} />
      )}
      {COLOR_KEYS.map((c) => (
        <button
          key={c}
          className={`swatch c-${c} ${value === c ? 'active' : ''}`}
          title={c}
          onClick={() => onChange(c)}
        />
      ))}
    </div>
  );
}

marked.setOptions({ breaks: true, gfm: true });

export function Markdown({ text, className }: { text: string; className?: string }) {
  const html = useMemo(() => DOMPurify.sanitize(marked.parse(text || '', { async: false }) as string), [text]);
  return (
    <div
      className={`md ${className ?? ''}`}
      dangerouslySetInnerHTML={{ __html: html }}
      onClick={(e) => {
        const a = (e.target as HTMLElement).closest('a');
        if (a) {
          e.preventDefault();
          window.open(a.getAttribute('href') ?? '', '_blank', 'noopener');
        }
      }}
    />
  );
}

/** A search-as-you-type task picker used to add relationships. */
export function TaskPicker({
  exclude,
  placeholder,
  onPick,
  onClose,
  allowCreate,
}: {
  exclude: Set<ID>;
  placeholder: string;
  onPick: (id: ID | { create: string }) => void;
  onClose: () => void;
  allowCreate?: boolean;
}) {
  const board = useStore((s) => s.board());
  const analysis = useStore((s) => s.analysis);
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);
  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return Object.values(board.items)
      .filter((i): i is TaskItem => i.kind === 'task' && !exclude.has(i.id))
      .filter((t) => !needle || t.title.toLowerCase().includes(needle))
      .sort((a, b) => (analysis.tasks.get(a.id)?.resolved ? 1 : 0) - (analysis.tasks.get(b.id)?.resolved ? 1 : 0) || a.title.localeCompare(b.title))
      .slice(0, 12);
  }, [q, board, exclude, analysis]);
  const total = results.length + (allowCreate && q.trim() ? 1 : 0);
  const pick = (i: number) => {
    if (i < results.length) onPick(results[i].id);
    else if (allowCreate && q.trim()) onPick({ create: q.trim() });
  };
  return (
    <div className="picker" onKeyDown={(e) => e.stopPropagation()}>
      <input
        ref={ref}
        value={q}
        placeholder={placeholder}
        onChange={(e) => {
          setQ(e.target.value);
          setHi(0);
        }}
        onBlur={() => setTimeout(onClose, 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') (setHi((h) => Math.min(total - 1, h + 1)), e.preventDefault());
          else if (e.key === 'ArrowUp') (setHi((h) => Math.max(0, h - 1)), e.preventDefault());
          else if (e.key === 'Enter') (pick(hi), e.preventDefault());
          else if (e.key === 'Escape') onClose();
        }}
      />
      <div className="picker-list">
        {results.map((t, i) => {
          const info = analysis.tasks.get(t.id)!;
          return (
            <button
              key={t.id}
              className={`picker-item ${i === hi ? 'hi' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setHi(i)}
              onClick={() => pick(i)}
            >
              <span className={`dot st-${info.state}`} />
              <span className="grow ellipsis">{t.title || 'Untitled task'}</span>
              <TaskPath id={t.id} />
            </button>
          );
        })}
        {allowCreate && q.trim() && (
          <button
            className={`picker-item create ${hi === results.length ? 'hi' : ''}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => pick(results.length)}
          >
            + Create “{q.trim()}”
          </button>
        )}
        {!results.length && !(allowCreate && q.trim()) && <div className="picker-empty">No matching tasks</div>}
      </div>
    </div>
  );
}

/** Breadcrumb of ancestors: "Project › Phase" */
export function TaskPath({ id, max = 2 }: { id: ID; max?: number }) {
  const board = useStore((s) => s.board());
  const info = useStore((s) => s.analysis.tasks.get(id));
  if (!info || !info.ancestors.length) return null;
  const names = info.ancestors
    .slice(0, max)
    .reverse()
    .map((a) => (board.items[a] as TaskItem)?.title || 'Untitled');
  return <span className="task-path ellipsis">{(info.ancestors.length > max ? '… › ' : '') + names.join(' › ')}</span>;
}

/** Clickable reference to a task: selects it (and reveals it in the current view). */
export function TaskRef({ id, children, showState = true }: { id: ID; children?: ReactNode; showState?: boolean }) {
  const t = useStore((s) => s.board().items[id]) as TaskItem | undefined;
  const info = useStore((s) => s.analysis.tasks.get(id));
  const view = useStore((s) => s.ui.view);
  const reveal = useStore((s) => s.revealOnCanvas);
  const revealList = useStore((s) => s.revealInList);
  if (!t) return null;
  return (
    <button
      className="task-ref"
      title="Select"
      onClick={(e) => {
        e.stopPropagation();
        if (view === 'list') revealList(id);
        else reveal(id);
      }}
    >
      {showState && info && <span className={`dot st-${info.state}`} />}
      <span className="ellipsis">{t.title || 'Untitled task'}</span>
      {children}
    </button>
  );
}

export function useClickOutside(ref: React.RefObject<HTMLElement | null>, onOut: () => void, active = true) {
  useEffect(() => {
    if (!active) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onOut();
    };
    document.addEventListener('mousedown', h, true);
    return () => document.removeEventListener('mousedown', h, true);
  }, [ref, onOut, active]);
}

export const isTypingTarget = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  if (!el) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable;
};
