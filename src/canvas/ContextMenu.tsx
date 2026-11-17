import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignStartVertical,
  ArrowLeftRight,
  ArrowRight,
  Ban,
  Check,
  CheckSquare,
  ChevronsDownUp,
  ClipboardPaste,
  Copy,
  Crosshair,
  Diamond,
  Frame,
  GitBranchPlus,
  List,
  Pencil,
  Play,
  RotateCcw,
  StickyNote,
  Trash2,
  Undo2,
} from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';
import { LINK_META } from '../model/rules';
import type { ID, LinkType, TaskItem } from '../model/types';
import { COLOR_KEYS, isTask } from '../model/types';
import { useStore } from '../store/store';
import { useClickOutside } from '../ui/common';
import { LinkIcon } from '../ui/icons';
import { MenuItem, MenuSep } from '../ui/Popover';

export type MenuTarget = { kind: 'pane' } | { kind: 'node'; id: ID } | { kind: 'edge'; id: ID } | { kind: 'selection'; ids: ID[] };
export type MenuState = {
  x: number;
  y: number;
  flow: { x: number; y: number };
} & MenuTarget;

export function ContextMenu({ menu, onClose }: { menu: MenuState; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: menu.x, y: menu.y });
  useClickOutside(ref, onClose);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      x: Math.min(menu.x, window.innerWidth - r.width - 8),
      y: Math.min(menu.y, window.innerHeight - r.height - 8),
    });
  }, [menu.x, menu.y]);

  const st = useStore.getState();
  const run = (f: () => void) => () => {
    f();
    onClose();
  };
  const b = st.board();
  const a = st.analysis;

  let content: React.ReactNode = null;

  if (menu.kind === 'pane') {
    const p = menu.flow;
    content = (
      <>
        <MenuItem icon={<CheckSquare size={15} />} label="New task" hint="T" onClick={run(() => st.addTask({ at: { x: p.x - 124, y: p.y - 24 }, edit: 'canvas' }))} />
        <MenuItem icon={<Diamond size={15} />} label="New milestone" hint="M" onClick={run(() => st.addTask({ at: { x: p.x - 100, y: p.y - 24 }, milestone: true, edit: 'canvas' }))} />
        <MenuItem icon={<StickyNote size={15} />} label="New note" hint="N" onClick={run(() => st.addNote(p))} />
        <MenuItem icon={<Frame size={15} />} label="New area" hint="A" onClick={run(() => st.addFrame(p))} />
        <MenuSep />
        <MenuItem icon={<ClipboardPaste size={15} />} label="Paste here" hint="Ctrl+V" disabled={!st.clipboard} onClick={run(() => st.paste(p))} />
        <MenuItem icon={<Undo2 size={15} />} label="Undo" hint="Ctrl+Z" disabled={!st.past.length} onClick={run(() => st.undo())} />
      </>
    );
  } else if (menu.kind === 'edge') {
    const l = b.links[menu.id];
    if (!l) return null;
    const s = b.items[l.source];
    const t = b.items[l.target];
    const taskPair = isTask(s) && isTask(t);
    const types: LinkType[] = taskPair ? ['depends', 'soft', 'subtask', 'relates', 'line'] : ['relates', 'annotates', 'line'];
    content = (
      <>
        {types.map((ty) => (
          <MenuItem key={ty} icon={<LinkIcon type={ty} size={16} />} label={LINK_META[ty].label} active={l.type === ty} onClick={run(() => st.changeLinkType(l.id, ty))} />
        ))}
        <MenuSep />
        <MenuItem icon={<Pencil size={15} />} label="Edit label" onClick={run(() => st.setUI({ editingId: l.id }))} />
        {l.type !== 'annotates' && <MenuItem icon={<ArrowLeftRight size={15} />} label="Reverse direction" onClick={run(() => st.reverseLink(l.id))} />}
        <MenuItem icon={<Trash2 size={15} />} label="Delete link" hint="Del" danger onClick={run(() => st.deleteLinks([l.id]))} />
      </>
    );
  } else if (menu.kind === 'selection') {
    const ids = menu.ids;
    const tasks = ids.filter((id) => isTask(b.items[id]));
    content = (
      <>
        {tasks.length > 0 && (
          <>
            <MenuItem icon={<Check size={15} />} label={`Mark ${tasks.length} done`} onClick={run(() => st.setStatus(tasks, 'done'))} />
            <MenuItem icon={<Play size={15} />} label="Mark in progress" onClick={run(() => st.setStatus(tasks, 'doing'))} />
            <MenuItem icon={<RotateCcw size={15} />} label="Mark to do" onClick={run(() => st.setStatus(tasks, 'todo'))} />
            <MenuSep />
          </>
        )}
        <div className="menu-row">
          <button className="icon-btn" title="Align left" onClick={run(() => st.align(ids, 'left'))}><AlignStartVertical size={15} /></button>
          <button className="icon-btn" title="Align centers" onClick={run(() => st.align(ids, 'hcenter'))}><AlignCenterVertical size={15} /></button>
          <button className="icon-btn" title="Align right" onClick={run(() => st.align(ids, 'right'))}><AlignEndVertical size={15} /></button>
          <button className="icon-btn" title="Align top" onClick={run(() => st.align(ids, 'top'))}><AlignStartHorizontal size={15} /></button>
          <button className="icon-btn" title="Align middles" onClick={run(() => st.align(ids, 'vcenter'))}><AlignCenterHorizontal size={15} /></button>
          <button className="icon-btn" title="Align bottom" onClick={run(() => st.align(ids, 'bottom'))}><AlignEndHorizontal size={15} /></button>
        </div>
        <MenuItem icon={<Frame size={15} />} label="Wrap in area" hint="A" onClick={run(() => st.wrapInFrame(ids))} />
        <MenuItem icon={<Copy size={15} />} label="Duplicate" hint="Ctrl+D" onClick={run(() => st.duplicate(ids))} />
        <ColorRow ids={ids} onDone={onClose} />
        <MenuSep />
        <MenuItem icon={<Trash2 size={15} />} label={`Delete ${ids.length} items`} hint="Del" danger onClick={run(() => st.deleteItems(ids))} />
      </>
    );
  } else {
    const it = b.items[menu.id];
    if (!it) return null;
    const info = a.tasks.get(it.id);
    content = (
      <>
        {isTask(it) && info && (
          <>
            {!info.composite && !info.gated && (
              <>
                <MenuItem icon={<Check size={15} />} label={info.status === 'done' ? 'Reopen' : 'Mark done'} hint="Space" onClick={run(() => st.toggleDone([it.id]))} />
                {info.status !== 'doing' && info.status !== 'done' && (
                  <MenuItem icon={<Play size={15} />} label="Start (in progress)" hint="⇧Space" onClick={run(() => st.setStatus([it.id], 'doing'))} />
                )}
              </>
            )}
            {info.composite && info.status !== 'done' && (
              <MenuItem icon={<Check size={15} />} label="Complete all subtasks" onClick={run(() => st.setStatus([it.id], 'done'))} />
            )}
            <MenuItem
              icon={info.status === 'dropped' ? <RotateCcw size={15} /> : <Ban size={15} />}
              label={info.status === 'dropped' ? 'Restore (un-drop)' : info.composite ? 'Drop branch' : 'Drop'}
              onClick={run(() => st.setStatus([it.id], info.status === 'dropped' ? 'todo' : 'dropped'))}
            />
            <MenuSep />
            {!it.milestone && (
              <MenuItem icon={<GitBranchPlus size={15} />} label="Add subtask" hint="Tab" onClick={run(() => st.addTask({ parentId: it.id, edit: 'canvas' }))} />
            )}
            <MenuItem icon={<ArrowRight size={15} />} label="Add next step" hint="Ctrl+Enter" onClick={run(() => st.addTask({ nextOf: it.id, edit: 'canvas' }))} />
            <MenuItem icon={<ArrowRight size={15} style={{ transform: 'scaleX(-1)' }} />} label="Add prerequisite" onClick={run(() => st.addTask({ prereqOf: it.id, edit: 'canvas' }))} />
            <MenuItem icon={<StickyNote size={15} />} label="Attach note" hint="N" onClick={run(() => st.addNote(menu.flow, it.id))} />
            {info.composite && (
              <MenuItem icon={<ChevronsDownUp size={15} />} label={(it as TaskItem).collapsed ? 'Expand subtasks' : 'Collapse subtasks'} hint="C" onClick={run(() => st.toggleCollapse(it.id))} />
            )}
            <MenuSep />
            <MenuItem icon={<Crosshair size={15} />} label="Focus on this" hint="F" onClick={run(() => st.setUI({ focusMode: true, selection: [it.id] }))} />
            <MenuItem icon={<List size={15} />} label="Show in list" onClick={run(() => st.revealInList(it.id))} />
            <MenuItem
              icon={<Diamond size={15} />}
              label={it.milestone ? 'Make regular task' : 'Make milestone'}
              disabled={!it.milestone && info.childIds.length > 0}
              onClick={run(() => st.updateItem<TaskItem>(it.id, { milestone: !it.milestone, w: it.milestone ? 248 : 200 }))}
            />
          </>
        )}
        {!isTask(it) && (it.kind === 'note' || it.kind === 'shape' || it.kind === 'text') && (
          <MenuItem icon={<CheckSquare size={15} />} label="Convert to task" onClick={run(() => st.convert(it.id, 'task'))} />
        )}
        {isTask(it) && (
          <MenuItem icon={<StickyNote size={15} />} label="Convert to note" onClick={run(() => st.convert(it.id, 'note'))} />
        )}
        <MenuItem icon={<Pencil size={15} />} label="Edit text" hint="Enter" onClick={run(() => st.setUI({ editingId: it.id }))} />
        <MenuItem icon={<Copy size={15} />} label="Duplicate" hint="Ctrl+D" onClick={run(() => st.duplicate([it.id]))} />
        <ColorRow ids={[it.id]} onDone={onClose} />
        <MenuSep />
        <MenuItem icon={<Trash2 size={15} />} label="Delete" hint="Del" danger onClick={run(() => st.deleteItems([it.id]))} />
        {info?.composite && (
          <MenuItem icon={<Trash2 size={15} />} label="Delete with all subtasks" hint="⇧Del" danger onClick={run(() => st.deleteItems([it.id], { withSubtasks: true }))} />
        )}
      </>
    );
  }

  return (
    <div className="context-menu" ref={ref} style={{ left: pos.x, top: pos.y }} onContextMenu={(e) => e.preventDefault()}>
      {content}
    </div>
  );
}

function ColorRow({ ids, onDone }: { ids: ID[]; onDone: () => void }) {
  const st = useStore.getState();
  return (
    <div className="menu-row swatches">
      <button className="swatch none" title="Default" onClick={() => (st.updateItems(ids, { color: null }), onDone())} />
      {COLOR_KEYS.map((c) => (
        <button key={c} className={`swatch c-${c}`} title={c} onClick={() => (st.updateItems(ids, { color: c }), onDone())} />
      ))}
    </div>
  );
}
