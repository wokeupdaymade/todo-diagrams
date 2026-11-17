import { ReactFlowProvider } from '@xyflow/react';
import { useEffect } from 'react';
import { Canvas } from './canvas/Canvas';
import { Inspector } from './inspector/Inspector';
import { ListView } from './list/ListView';
import { isTask } from './model/types';
import { useStore } from './store/store';
import { CommandPalette, HelpOverlay, Sidebar, Toasts, TopBar } from './ui/Chrome';
import { isTypingTarget } from './ui/common';

/** Shortcuts that work the same in every view. View-specific keys live in Canvas / ListView. */
function useGlobalShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = useStore.getState();
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === 'k') {
        e.preventDefault();
        st.setUI({ paletteOpen: !st.ui.paletteOpen });
        return;
      }
      if (isTypingTarget(e.target)) return;
      // a focused toolbar/inspector button must not also "click" on Space/Enter
      if ((e.key === ' ' || e.key === 'Enter') && (e.target as HTMLElement)?.tagName === 'BUTTON') (e.target as HTMLElement).blur();
      if (mod && k === 'z') {
        e.preventDefault();
        if (e.shiftKey) st.redo();
        else st.undo();
        return;
      }
      if (mod && k === 'y') {
        e.preventDefault();
        st.redo();
        return;
      }
      if (mod && k === 'a') {
        e.preventDefault();
        st.selectAll();
        return;
      }
      if (st.ui.paletteOpen) return;
      if (e.key === 'Escape') {
        if (st.ui.helpOpen) st.setUI({ helpOpen: false });
        else if (st.ui.editingId) st.setUI({ editingId: null });
        else if (st.ui.focusMode) st.setUI({ focusMode: false });
        else st.clearSelection();
        return;
      }
      if (e.key === '?') {
        st.setUI({ helpOpen: !st.ui.helpOpen });
        return;
      }
      if (e.altKey && ['1', '2', '3'].includes(e.key)) {
        e.preventDefault();
        st.setUI({ view: (['canvas', 'split', 'list'] as const)[Number(e.key) - 1] });
        return;
      }
      if (e.altKey && e.code?.startsWith('Digit')) {
        const n = Number(e.code.slice(5));
        if (n >= 1 && n <= 3) {
          e.preventDefault();
          st.setUI({ view: (['canvas', 'split', 'list'] as const)[n - 1] });
          return;
        }
      }
      if (st.ui.helpOpen) return;
      const sel = st.ui.selection;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (sel.length) {
          e.preventDefault();
          st.deleteItems(sel, { withSubtasks: e.shiftKey });
        } else if (st.ui.selectedLinks.length) {
          e.preventDefault();
          st.deleteLinks(st.ui.selectedLinks);
        }
        return;
      }
      if (e.key === ' ' && sel.length) {
        const tasks = sel.filter((id) => isTask(st.board().items[id]));
        if (!tasks.length) return;
        e.preventDefault();
        if (e.shiftKey) {
          for (const id of tasks) {
            const info = st.analysis.tasks.get(id);
            if (!info || info.composite || info.gated) continue;
            st.setStatus([id], info.status === 'doing' ? 'todo' : 'doing');
          }
        } else st.toggleDone(tasks);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

export function App() {
  const loaded = useStore((s) => s.loaded);
  const view = useStore((s) => s.ui.view);
  const sidebarOpen = useStore((s) => s.ui.sidebarOpen);
  const inspectorOpen = useStore((s) => s.ui.inspectorOpen);
  const theme = useStore((s) => s.ui.theme);
  useGlobalShortcuts();

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  if (!loaded) return <div className="loading">Loading…</div>;

  return (
    <ReactFlowProvider>
      <div className={`app ${sidebarOpen ? 'with-sidebar' : ''} ${inspectorOpen ? 'with-inspector' : ''}`}>
        {sidebarOpen && <Sidebar />}
        <main className="main">
          <TopBar />
          <div className={`workspace view-${view}`}>
            {view !== 'canvas' && <ListView />}
            {view !== 'list' && <Canvas />}
          </div>
        </main>
        {inspectorOpen && <Inspector />}
        <CommandPalette />
        <HelpOverlay />
        <Toasts />
      </div>
    </ReactFlowProvider>
  );
}
