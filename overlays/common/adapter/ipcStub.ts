/**
 * Answers Electron-only IPC channel names on the platform bridge.
 *
 * AionUi 2.2.2 still declares 35 `bridge.buildProvider/Emitter` channels for
 * Electron main-process features. In Tauri there is no provider, so any
 * `invoke()` waits forever. Registering one provider per channel resolves
 * them to safe defaults instead. Emitter-only channels need no provider.
 *
 * Installed by `overlays/renderer/tauri/bootstrap.ts` before React mounts.
 */

import { bridge } from '@/common/platform/bridge';
import { isTauri } from '@tauri-apps/api/core';

/** Exact channel names from ipcBridge.ts -> value returned by invoke(). */
const STUBS: Record<string, unknown> = {
  'restart-app': { success: false },
  'open-dev-tools': false,
  'is-dev-tools-opened': false,
  'app.get-path': '',
  'app.get-zoom-factor': 1,
  'app.write-renderer-log': undefined,
  'show-open': undefined,
  'skills.files.list': [],
  'theme:set-active': undefined,
  'theme:request-current': null,
  'notification.show': undefined,
  'auto-update.download': { success: false },
  'auto-update.download.cancel': { success: false },
  'auto-update.quit-and-install': undefined,
  'update.download.cancel': { success: false },
  'webui.get-status': { running: false, port: 0, allowRemote: false, localUrl: '', adminUsername: '' },
  'webui.start': { success: false },
  'webui.stop': undefined,
  'system-settings:get-close-to-tray': false,
  'system-settings:set-close-to-tray': undefined,
  'system-settings:get-pet-enabled': false,
  'system-settings:set-pet-enabled': undefined,
  'system-settings:get-pet-size': 1,
  'system-settings:set-pet-size': undefined,
  'system-settings:get-pet-dnd': false,
  'system-settings:set-pet-dnd': undefined,
  'system-settings:get-pet-confirm-enabled': false,
  'system-settings:set-pet-confirm-enabled': undefined,
};

let installed = false;

export function installIpcStubs(): void {
  if (installed) return;
  installed = true;

  for (const [name, value] of Object.entries(STUBS)) {
    bridge.buildProvider(name).provider(() => value);
  }

  // Font scaling: map the Electron zoom channel to Tauri's webview zoom.
  bridge.buildProvider<number, { factor: number }>('app.set-zoom-factor').provider(async ({ factor }) => {
    if (isTauri()) {
      const { getCurrentWebview } = await import('@tauri-apps/api/webview');
      await getCurrentWebview().setZoom(factor).catch(() => undefined);
    }
    return factor;
  });
}
