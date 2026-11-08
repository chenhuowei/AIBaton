/**
 * Tauri native capability adapter.
 *
 * Upstream Aibaton routes several features through Electron IPC channels that
 * have no provider in this build. This module implements the same call shapes
 * with Tauri 2 APIs and is patched into `ipcBridge.ts` by sync-frontend.mjs.
 *
 * - dialog.showOpen      → @tauri-apps/plugin-dialog `open()`
 * - windowControls.*     → @tauri-apps/api/window `getCurrentWindow()`
 * - drag & drop paths    → window.electronAPI.getPathForFile (fed by a Tauri
 *                          drag-drop event listener registered here)
 */

import { open as tauriOpen } from '@tauri-apps/plugin-dialog';
import { getCurrentWindow } from '@tauri-apps/api/window';
import type { Event as TauriEvent, UnlistenFn } from '@tauri-apps/api/event';

type ShowOpenOptions = {
  title?: string;
  defaultPath?: string;
  buttonLabel?: string;
  filters?: Array<{ name: string; extensions: string[] }>;
  properties?: Array<string>;
};

type MaximizedListener = (payload: { is_maximized: boolean }) => void;

const maximizedListeners = new Set<MaximizedListener>();
let dragPathsReady = false;
let unlistenDragDrop: UnlistenFn | null = null;
let unlistenResized: UnlistenFn | null = null;

/** Convert upstream's Electron-style options into Tauri dialog options. */
function toTauriDialogOptions(options?: ShowOpenOptions) {
  const props = options?.properties ?? [];
  return {
    title: options?.title,
    defaultPath: options?.defaultPath,
    directory: props.includes('openDirectory'),
    multiple: props.includes('multiSelections'),
    filters: options?.filters?.map((f) => ({ name: f.name, extensions: f.extensions })),
  };
}

/** Native file/directory picker. Returns absolute paths or undefined on cancel. */
export async function tauriShowOpen(options?: ShowOpenOptions): Promise<string[] | undefined> {
  const result = await tauriOpen(toTauriDialogOptions(options));
  if (result === null) return undefined;
  return Array.isArray(result) ? result : [result];
}

const win = getCurrentWindow();

export const tauriWindowControls = {
  minimize: { provider: () => {}, invoke: async () => win.minimize() },
  maximize: { provider: () => {}, invoke: async () => win.maximize() },
  unmaximize: { provider: () => {}, invoke: async () => win.unmaximize() },
  close: { provider: () => {}, invoke: async () => win.close() },
  isMaximized: { provider: () => {}, invoke: async () => win.isMaximized() },
  maximizedChanged: {
    on: (listener: MaximizedListener) => {
      maximizedListeners.add(listener);
      return () => maximizedListeners.delete(listener);
    },
    emit: () => {},
  },
};

/**
 * Tauri's file drop event carries absolute paths, but WebView2 also emits a
 * regular HTML5 drop whose `File` objects have no path. Bridge the two by
 * caching the last dropped paths and exposing a `getPathForFile(file)` that
 * matches by name (same approach upstream used with webUtils).
 */
let lastDroppedPaths: string[] = [];

function basename(p: string): string {
  return p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? p;
}

export function installDragDropPathBridge(): void {
  if (dragPathsReady) return;
  dragPathsReady = true;

  const w = window as unknown as {
    electronAPI?: Record<string, unknown> & { getPathForFile?: (file: File) => string };
  };
  if (!w.electronAPI) w.electronAPI = { emit: () => undefined, on: () => undefined };
  w.electronAPI.getPathForFile = (file: File): string => {
    const match = lastDroppedPaths.find((p) => basename(p) === file.name);
    return match ?? '';
  };

  // Dynamic import keeps the module usable in a plain browser (vite preview)
  // where @tauri-apps/api/event exists but the Tauri runtime does not.
  void import('@tauri-apps/api/webview')
    .then(({ getCurrentWebview }) => {
      return getCurrentWebview().onDragDropEvent((event: TauriEvent<{ paths?: string[]; type: string }>) => {
        if (event.payload?.type === 'drop') {
          lastDroppedPaths = event.payload.paths ?? [];
        } else if (event.payload?.type === 'leave' || event.payload?.type === 'cancel') {
          lastDroppedPaths = [];
        }
      });
    })
    .then((unlisten) => {
      unlistenDragDrop = unlisten ?? null;
    })
    .catch((error) => {
      console.warn('[tauri] drag-drop bridge unavailable:', error);
    });
}

export function disposeTauriCapabilities(): void {
  unlistenDragDrop?.();
  unlistenDragDrop = null;
  unlistenResized?.();
  unlistenResized = null;
  maximizedListeners.clear();
}

/** Wire maximize-state events from the native window to bridge listeners. */
export function installWindowStateBridge(): void {
  if (unlistenResized) return;

  void win
    .onResized(() => {
      void win.isMaximized().then((is_maximized) => {
        for (const listener of maximizedListeners) listener({ is_maximized });
      });
    })
    .then((unlisten) => {
      unlistenResized = unlisten ?? null;
    })
    .catch((error) => console.warn('[tauri] window resize listener unavailable:', error));
}
