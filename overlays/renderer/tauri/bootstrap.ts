/**
 * Tauri bootstrap for AionUi 2.2.2.
 *
 * `main.tsx` calls `bootstrapTauri(() => root.render(...))`. Early HTTP/WS
 * calls queue on @/common/adapter/endpointGate until `core_endpoint` resolves.
 *
 * IMPORTANT: the desktop-runtime markers (`window.electronAPI`,
 * `__backendStartupBridge`) are installed by an inline synchronous script in
 * index.html, BEFORE any ES module is evaluated. Several upstream modules read
 * them at module top level (AuthContext.isDesktopRuntime, browser.ts adapter,
 * registerWebFsPicker, i18n language hint), so installing them from this async
 * bootstrap would be too late and would incorrectly show the login page.
 */

import { invoke, isTauri } from '@tauri-apps/api/core';

import { setBackendBaseUrl } from '@/common/adapter/httpBridge';
import { markBackendReady } from '@/common/adapter/endpointGate';
import { installDragDropPathBridge, installWindowStateBridge } from './capabilities';
import { installIpcStubs } from '@/common/adapter/ipcStub';

type CoreEndpoint = {
  url: string;
  version: string;
  managedResourcesDir: string | null;
};

/** Defensive only — the inline script has already done this. */
function ensureDesktopMarkers(): void {
  const w = window as unknown as {
    electronAPI?: Record<string, unknown>;
    __backendStartupBridge?: {
      getState: () => null;
      subscribe: (cb: (s: null) => void) => () => void;
    };
    __backendStartupFailure?: null;
  };
  if (!w.electronAPI) w.electronAPI = { emit: () => undefined, on: () => undefined };
  if (!w.__backendStartupBridge) {
    w.__backendStartupBridge = { getState: () => null, subscribe: () => () => undefined };
  }
  if (w.__backendStartupFailure === undefined) w.__backendStartupFailure = null;
}

/** Fade out and remove the inline boot splash once React is mounted. */
function removeBootSplash(): void {
  const el = document.getElementById('aibaton-boot');
  if (!el) return;
  el.classList.add('is-leaving');
  window.setTimeout(() => el.remove(), 400);
}

function showFatal(message: string): void {
  const root = document.getElementById('root');
  if (!root) return;
  const esc = message.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  root.innerHTML =
    '<div style="font-family:system-ui,sans-serif;padding:32px;line-height:1.6;color:#1d2129">' +
    '<h2 style="margin:0 0 12px">AionUi Rust 启动失败</h2>' +
    `<pre style="white-space:pre-wrap;background:#f2f3f5;padding:16px;border-radius:8px">${esc}</pre>` +
    '<p>请检查 <code>src-tauri/binaries/</code> 下的 aioncore 与日志目录。</p></div>';
}

export async function bootstrapTauri(mount: () => void): Promise<void> {
  ensureDesktopMarkers();
  installIpcStubs();
  installDragDropPathBridge();
  installWindowStateBridge();

  // Plain browser (vite dev / static preview): the injected script already set
  // the endpoint gate; just mark ready and mount.
  if (!isTauri()) {
    markBackendReady('');
    mount();
    removeBootSplash();
    return;
  }

  try {
    const endpoint = await invoke<CoreEndpoint>('core_endpoint');
    if (!endpoint?.url) throw new Error('core_endpoint returned an empty url');
    const base = endpoint.url.replace(/\/$/, '');
    (globalThis as { __aionuiBackendBaseUrl?: string }).__aionuiBackendBaseUrl = base;
    setBackendBaseUrl(base);
    markBackendReady(base);
    console.info('[tauri] aioncore ready:', base, endpoint.version ?? '');
  } catch (error) {
    console.error('[tauri] failed to resolve aioncore endpoint:', error);
    showFatal(error instanceof Error ? error.message : String(error));
    return;
  }

  mount();
  removeBootSplash();
}
