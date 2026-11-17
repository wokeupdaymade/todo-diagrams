import {
  CheckSquare,
  Crosshair,
  Diamond,
  Eye,
  Frame,
  Hand,
  LayoutGrid,
  MousePointer2,
  Network,
  Shapes,
  StickyNote,
  Type,
  Workflow,
} from 'lucide-react';
import { LINK_META } from '../model/rules';
import type { LinkType } from '../model/types';
import { useStore } from '../store/store';
import { LinkIcon, ShapeIcon, SHAPES } from '../ui/icons';
import { MenuItem, MenuSep, MenuTitle, Popover } from '../ui/Popover';

const LINK_MODES: { type: LinkType; key: string; hint: string }[] = [
  { type: 'depends', key: '1', hint: 'Source must be done before target can start' },
  { type: 'soft', key: '2', hint: 'Advisory order — never blocks' },
  { type: 'subtask', key: '3', hint: 'Target becomes a part of source' },
  { type: 'relates', key: '4', hint: 'Loose association' },
  { type: 'line', key: '5', hint: 'Plain connector (no meaning)' },
];

export function CanvasToolbar({
  tool,
  setTool,
  placePoint,
}: {
  tool: 'select' | 'hand';
  setTool: (t: 'select' | 'hand') => void;
  placePoint: () => { x: number; y: number };
}) {
  const linkMode = useStore((s) => s.ui.linkMode);
  const completed = useStore((s) => s.ui.completed);
  const showCritical = useStore((s) => s.ui.showCritical);
  const showMinimap = useStore((s) => s.ui.showMinimap);
  const snapToGrid = useStore((s) => s.ui.snapToGrid);
  const focusMode = useStore((s) => s.ui.focusMode);
  const selection = useStore((s) => s.ui.selection);
  const st = useStore.getState;

  const at = () => placePoint();
  const selTask = selection.length === 1 ? st().board().items[selection[0]] : null;

  return (
    <div className="canvas-toolbar" onDoubleClick={(e) => e.stopPropagation()}>
      <div className="tb-group">
        <button className={`tb-btn ${tool === 'select' ? 'active' : ''}`} title="Select (V)" onClick={() => setTool('select')}>
          <MousePointer2 size={17} />
        </button>
        <button className={`tb-btn ${tool === 'hand' ? 'active' : ''}`} title="Pan (H) — or drag with middle/right mouse, scroll to move" onClick={() => setTool('hand')}>
          <Hand size={17} />
        </button>
      </div>
      <div className="tb-group">
        <button
          className="tb-btn labeled"
          title="New task (T, or double-click the canvas)"
          onClick={() => {
            const p = at();
            st().addTask({ at: { x: p.x - 124, y: p.y - 24 }, edit: 'canvas' });
          }}
        >
          <CheckSquare size={17} />
          <span>Task</span>
        </button>
        <button
          className="tb-btn"
          title="New milestone (M) — a checkpoint reached when its prerequisites are done"
          onClick={() => {
            const p = at();
            st().addTask({ at: { x: p.x - 100, y: p.y - 24 }, milestone: true, edit: 'canvas' });
          }}
        >
          <Diamond size={17} />
        </button>
        <button
          className="tb-btn"
          title={selTask?.kind === 'task' ? 'New note attached to the selected task (N)' : 'New note (N)'}
          onClick={() => st().addNote(at(), selTask?.kind === 'task' ? selTask.id : undefined)}
        >
          <StickyNote size={17} />
        </button>
        <Popover trigger={<Shapes size={17} />} title="Shapes (R rounded · O ellipse · D decision)">
          {(close) => (
            <div className="shape-grid">
              {SHAPES.map((s) => (
                <button
                  key={s.shape}
                  className="tb-btn"
                  title={s.label}
                  onClick={() => {
                    st().addShape(s.shape, at());
                    close();
                  }}
                >
                  <ShapeIcon shape={s.shape} />
                </button>
              ))}
            </div>
          )}
        </Popover>
        <button
          className="tb-btn"
          title="New area (A) — wraps the selection if anything is selected"
          onClick={() => (selection.length ? st().wrapInFrame(selection) : st().addFrame(at()))}
        >
          <Frame size={17} />
        </button>
        <button className="tb-btn" title="Text label (L)" onClick={() => st().addText(at())}>
          <Type size={17} />
        </button>
      </div>
      <div className="tb-group link-modes" title="What a newly drawn connection means">
        <span className="tb-label">Connect as</span>
        {LINK_MODES.map((m) => (
          <button
            key={m.type}
            className={`tb-btn link-mode lm-${m.type} ${linkMode === m.type ? 'active' : ''}`}
            title={`${LINK_META[m.type].label} (${m.key}) — ${m.hint}`}
            onClick={() => st().setUI({ linkMode: m.type })}
          >
            <LinkIcon type={m.type} />
            {linkMode === m.type && <span className="lm-name">{LINK_META[m.type].label}</span>}
          </button>
        ))}
      </div>
      <div className="tb-group">
        <Popover trigger={<LayoutGrid size={17} />} title="Auto-arrange" align="right">
          {(close) => (
            <>
              <MenuTitle>{selection.length > 1 ? `Arrange ${selection.length} selected` : 'Arrange whole board'}</MenuTitle>
              <MenuItem
                icon={<Network size={15} />}
                label="Tree (outline)"
                hint="Shift+L"
                onClick={() => {
                  st().layout('tree', selection);
                  close();
                }}
              />
              <MenuItem
                icon={<Workflow size={15} />}
                label="Flow (left → right)"
                hint="Shift+W"
                onClick={() => {
                  st().layout('flow', selection);
                  close();
                }}
              />
            </>
          )}
        </Popover>
        <button
          className={`tb-btn ${focusMode ? 'active' : ''}`}
          title="Focus mode (F): dim everything not connected to the selected task"
          onClick={() => st().setUI({ focusMode: !focusMode })}
        >
          <Crosshair size={17} />
        </button>
        <Popover trigger={<Eye size={17} />} title="View options" align="right">
          {() => (
            <>
              <MenuTitle>Completed tasks</MenuTitle>
              {(['show', 'fade', 'hide'] as const).map((c) => (
                <MenuItem key={c} label={c[0].toUpperCase() + c.slice(1)} active={completed === c} onClick={() => st().setUI({ completed: c })} />
              ))}
              <MenuSep />
              <MenuItem label="Highlight critical path" active={showCritical} onClick={() => st().setUI({ showCritical: !showCritical })} />
              <MenuItem label="Mini-map" active={showMinimap} onClick={() => st().setUI({ showMinimap: !showMinimap })} />
              <MenuItem label="Snap to grid" active={snapToGrid} onClick={() => st().setUI({ snapToGrid: !snapToGrid })} />
            </>
          )}
        </Popover>
      </div>
    </div>
  );
}
