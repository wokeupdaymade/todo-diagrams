/**
 * Storage adapter. Today: IndexedDB in the browser (with a localStorage fallback).
 * The interface is deliberately tiny so a file- or server-backed adapter can be
 * dropped in later without touching the rest of the app.
 */
import { get, set } from 'idb-keyval';
import type { AppData } from '../model/types';

export interface StorageAdapter {
  load(): Promise<AppData | null>;
  save(data: AppData): Promise<void>;
}

const KEY = 'todo-diagrams:data:v1';

export const browserStorage: StorageAdapter = {
  async load() {
    try {
      const d = await get<AppData>(KEY);
      if (d) return d;
    } catch {
      /* fall through */
    }
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? (JSON.parse(raw) as AppData) : null;
    } catch {
      return null;
    }
  },
  async save(data) {
    try {
      await set(KEY, data);
    } catch {
      try {
        localStorage.setItem(KEY, JSON.stringify(data));
      } catch {
        /* ignore */
      }
    }
  },
};

export function downloadJSON(filename: string, value: unknown) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function pickJSONFile(): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = () => {
      const f = input.files?.[0];
      if (!f) return reject(new Error('No file'));
      f.text()
        .then((t) => resolve(JSON.parse(t)))
        .catch(reject);
    };
    input.click();
  });
}
