import '@xyflow/react/dist/base.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { browserStorage } from './store/persist';
import { saveUI, useStore } from './store/store';
import './styles.css';

async function boot() {
  const data = await browserStorage.load();
  useStore.getState().hydrate(data);
  if (import.meta.env.DEV) (window as unknown as { __store: typeof useStore }).__store = useStore;

  // Persist document changes (debounced) and UI preferences.
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastData = useStore.getState().data;
  let lastUI = useStore.getState().ui;
  const flush = () => {
    timer = null;
    void browserStorage.save(useStore.getState().data);
  };
  useStore.subscribe((s) => {
    if (s.data !== lastData) {
      lastData = s.data;
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, 400);
    }
    if (s.ui !== lastUI) {
      lastUI = s.ui;
      saveUI(s.ui);
    }
  });
  window.addEventListener('beforeunload', () => {
    if (timer) {
      clearTimeout(timer);
      flush();
    }
  });
  // first save so a freshly created sample board survives a reload
  void browserStorage.save(useStore.getState().data);

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void boot();
