/**
 * Platform services shim for the Tauri/browser renderer.
 *
 * AionUi 2.2.2 imports `getPlatformServices` from `@/common/platform` in a few
 * renderer modules. The real implementation is Electron/Node-specific
 * (`electron.app`, `utilityProcess`, `net.fetch`); the Tauri renderer only
 * needs the small subset below. The Rust shell owns all native work.
 */

import path from 'path';

export type IPlatformPaths = {
  getDataDir: () => string;
  getTempDir: () => string;
  getHomeDir: () => string;
  getLogsDir: () => string;
  getAppPath: () => string;
  isPackaged: () => boolean;
  getSystemPath: (name: string) => string;
  getName: () => string;
  getVersion: () => string;
  needsCliSafeSymlinks: () => boolean;
};

export type IWorkerProcess = { on: (event: string, cb: (...args: unknown[]) => void) => void };
export type IWorkerProcessFactory = { fork: () => IWorkerProcess };
export type IPowerManager = { preventSleep: () => null; allowSleep: () => void; preventDisplaySleep: () => null };
export type INotificationService = { send: () => void };
export type INetworkService = { fetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response> };

export type IPlatformServices = {
  paths: IPlatformPaths;
  worker: IWorkerProcessFactory;
  power: IPowerManager;
  notification: INotificationService;
  network: INetworkService;
};

let _services: IPlatformServices | null = null;

export function getDevAppName(): string {
  return 'AionUi-Rust-Dev';
}

export function registerPlatformServices(services: IPlatformServices): void {
  _services = services;
}

function browserServices(): IPlatformServices {
  const home = typeof navigator !== 'undefined' ? '' : '';
  return {
    paths: {
      getDataDir: () => '.',
      getTempDir: () => '.',
      getHomeDir: () => home,
      getLogsDir: () => '.',
      getAppPath: () => '.',
      isPackaged: () => false,
      getSystemPath: () => '.',
      getName: () => 'AionUi Rust',
      getVersion: () => (typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.1.0'),
      needsCliSafeSymlinks: () => false,
    },
    worker: { fork: () => ({ on: () => undefined }) },
    power: { preventSleep: () => null, allowSleep: () => undefined, preventDisplaySleep: () => null },
    notification: { send: () => undefined },
    network: { fetch: (input, init) => fetch(input, init) },
  };
}

export function getPlatformServices(): IPlatformServices {
  if (!_services) _services = browserServices();
  return _services;
}

// Kept for parity with upstream imports; unused in the Tauri renderer.
export const platformPath = path;
