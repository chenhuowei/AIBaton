/**
 * Backend endpoint readiness gate (globalThis, no cross-layer import cycle).
 *
 * AionUi 2.2.2 fires `configService.initialize()` and opens the platform
 * WebSocket during module evaluation. Those calls must queue until Tauri's
 * `invoke('core_endpoint')` resolves; otherwise they hit the WebView origin.
 */

type Gate = {
  promise: Promise<void>;
  resolve: () => void;
  ready: boolean;
  baseUrl: string;
};

const KEY = '__aionuiBackendGate';

function getGate(): Gate {
  const g = globalThis as unknown as { [KEY]?: Gate };
  if (!g[KEY]) {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => {
      resolve = r;
    });
    g[KEY] = { promise, resolve, ready: false, baseUrl: '' };
  }
  return g[KEY]!;
}

/** Resolve the gate with the sidecar origin; unblocks all queued requests. */
export function markBackendReady(baseUrl: string): void {
  const gate = getGate();
  gate.baseUrl = baseUrl.replace(/\/$/, '');
  gate.ready = true;
  gate.resolve();
}

/** Await the sidecar endpoint before any backend request. */
export async function waitForBackend(): Promise<void> {
  await getGate().promise;
}

export function backendBaseUrlNow(): string {
  return getGate().baseUrl;
}

export function isBackendReady(): boolean {
  return getGate().ready;
}
