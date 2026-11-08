/**
 * Local IPC providers for Electron-only channels in the Tauri build.
 *
 * Aibaton 2.2.2 declares several `bridge.buildProvider` channels that had a
 * main-process provider in Electron. In Tauri, `browser.ts` installs a
 * WebSocket-backed adapter: `bridge.emit()` writes to the socket and only a
 * frame coming *back* from the socket reaches `bridge.on()`. A provider
 * registered with `bridge.buildProvider(...).provider()` is therefore never
 * invoked, and every `invoke()` on those channels hangs forever. This is why
 * system settings (close-to-tray, work/log directories, zoom, …) appeared to
 * reset on every restart: the writes never reached any persistence layer.
 *
 * `invoke()` itself resolves through `bridge.on('subscribe.callback-*')`, so
 * the fix is a local loopback adapter: emit directly into the bridge's emitter.
 * Backend WebSocket events still arrive on that same emitter, so realtime
 * subscriptions keep working.
 *
 * Installed by `renderer/tauri/bootstrap.ts` before React mounts.
 */

import { bridge } from '@/common/platform/bridge';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { configService } from '@/common/config/configService';
import { httpRequest } from '@/common/adapter/httpBridge';

let installed = false;

/**
 * Replace the WebSocket adapter with a local loopback.
 *
 * `bridge.adapter()` passes an emitter object into `config.on()`. Both the
 * original WebSocket adapter and this loopback delegate to the same
 * module-level `eventEmitter` inside `platform/bridge.ts`, so inbound backend
 * frames and locally dispatched invokes reach the same subscriptions.
 */
function installLocalBridgeAdapter(): void {
  let emitter: { emit: (name: string, data: unknown) => unknown } | null = null;
  bridge.adapter({
    emit: (name, data) => emitter?.emit(name, data),
    on: (nextEmitter) => {
      emitter = nextEmitter;
    },
  });
}

/** Exact channel names from ipcBridge.ts -> value returned by invoke(). */
const STUBS: Record<string, unknown> = {
  'open-dev-tools': false,
  'is-dev-tools-opened': false,
  'app.get-path': '',
  'app.write-renderer-log': undefined,
  'show-open': undefined,
  'skills.files.list': [],
  'skills.files.read': undefined,
  'theme:set-active': undefined,
  'theme:request-current': null,
  'notification.show': undefined,
  // placeholder — overridden below with a Web Notification implementation
  'auto-update.download': { success: false },
  'auto-update.download.cancel': { success: false },
  'auto-update.quit-and-install': undefined,
  'update.download.cancel': { success: false },
  'webui.get-status': { running: false, port: 0, allowRemote: false, localUrl: '', adminUsername: '' },
  'webui.start': { success: false },
  'webui.stop': undefined,
  'system-settings:get-pet-enabled': false,
  'system-settings:set-pet-enabled': undefined,
  'system-settings:get-pet-size': 1,
  'system-settings:set-pet-size': undefined,
  'system-settings:get-pet-dnd': false,
  'system-settings:set-pet-dnd': undefined,
  'system-settings:get-pet-confirm-enabled': false,
  'system-settings:set-pet-confirm-enabled': undefined,
};

/** Honest "not supported" response for Electron-native features. */
const unsupported = (msg: string) => ({ success: false, msg });

const CLOSE_TO_TRAY_KEY = 'system.closeToTray';

export function installIpcStubs(): void {
  if (installed) return;
  installed = true;

  // Must run before any provider registration, otherwise `invoke()` still
  // sends its request to the WebSocket and never resolves.
  installLocalBridgeAdapter();

  for (const [name, value] of Object.entries(STUBS)) {
    bridge.buildProvider(name).provider(() => value);
  }

  // Font scaling: map the Electron zoom channel to Tauri's webview zoom and
  // persist it through configService, which writes to the backend DB.
  bridge.buildProvider<number, { factor: number }>('app.set-zoom-factor').provider(async ({ factor }) => {
    if (isTauri()) {
      const { getCurrentWebview } = await import('@tauri-apps/api/webview');
      await getCurrentWebview().setZoom(factor).catch(() => undefined);
    }
    await configService.set('ui.zoomFactor', factor).catch(() => undefined);
    return factor;
  });

  bridge.buildProvider<number, void>('app.get-zoom-factor').provider(async () => {
    await configService.whenReady().catch(() => undefined);
    const stored = configService.get('ui.zoomFactor');
    if (typeof stored === 'number' && stored > 0) return stored;
    // Tauri 2 exposes setZoom but no getZoom; the persisted value (or 1) is
    // therefore the authoritative starting zoom. Re-apply it on startup so a
    // fresh webview is not left at the OS default after a restart.
    return 1;
  });

  // Desktop notifications: use the Tauri notification plugin — native Windows
  // toasts with no browser permission gate. The WebView Notification API needs
  // a user gesture for requestPermission, which never fires from a background
  // stream event, so the earlier Web Notification attempt was silently denied.
  // conversation_id rides `extra`; a global onAction listener (installed
  // EAGERLY below, before the first send) emits `notification.clicked` on tap
  // so the existing conversation-jump hook keeps working.
  //
  // Click reporting REQUIRES the plugin's action listener to exist BEFORE a
  // toast is sent: the Rust side decides per-notification whether to track
  // clicks via `shared.has_listeners()` at send time. A listener registered
  // after the first send leaves that toast click-dead. So the listener is
  // installed once here, and `notification.show` awaits readiness before
  // sending.
  const notificationActionReady: Promise<void> = import('@tauri-apps/plugin-notification')
    .then(async (plugin) => {
      const unlisten = await plugin.onAction((event) => {
        const conversationId = event.notification?.extra?.conversation_id;
        if (typeof conversationId === 'string' && conversationId) {
          bridge.emit('notification.clicked', { conversation_id: conversationId });
        }
      });
      void unlisten;
    })
    .catch((err) => console.warn('[notification] onAction listener unavailable:', err));

  bridge
    .buildProvider<void, { title: string; body: string; conversation_id?: string }>('notification.show')
    .provider(async ({ title, body, conversation_id }) => {
      try {
        // Wait for the click listener before the first send (see above).
        await notificationActionReady;
        const plugin = await import('@tauri-apps/plugin-notification');
        if (!(await plugin.isPermissionGranted())) {
          const granted = await plugin.requestPermission();
          if (granted !== 'granted') return;
        }
        plugin.sendNotification({
          title,
          body,
          ...(conversation_id ? { extra: { conversation_id } } : {}),
        });
      } catch (err) {
        console.warn('[notification] native notification failed:', err);
      }
    });

  // Close-to-tray: persisted in the same `/api/settings/client` KV bag that
  // configService and SystemModalContent read. Keeping the key identical means
  // the UI shows the stored value after a restart instead of a stub default.
  bridge.buildProvider<boolean, void>('system-settings:get-close-to-tray').provider(async () => {
    // The native shell owns the close interceptor, so ask it first; the DB
    // value is the fallback for non-Tauri (static preview) contexts.
    if (isTauri()) {
      try {
        return await invoke<boolean>('get_close_to_tray');
      } catch {
        /* fall through to DB */
      }
    }
    const settings = await httpRequest<Record<string, unknown>>('GET', '/api/settings/client');
    const value = settings?.[CLOSE_TO_TRAY_KEY];
    return typeof value === 'boolean' ? value : false;
  });
  bridge.buildProvider<void, { enabled: boolean }>('system-settings:set-close-to-tray').provider(async ({ enabled }) => {
    // 1. Live native value — the close interceptor reads this on every close.
    if (isTauri()) {
      await invoke<void>('set_close_to_tray', { enabled }).catch(() => undefined);
    }
    // 2. Persisted value — read by the renderer at next boot and pushed into
    //    the shell via bootstrapRenderer.syncCloseToTrayToShell().
    configService.setLocal(CLOSE_TO_TRAY_KEY, enabled);
    await httpRequest<void>('PUT', '/api/settings/client', { [CLOSE_TO_TRAY_KEY]: enabled });
  });

  // Update check: no Electron auto-updater in Tauri, but a real version check
  // against GitHub Releases is cheap and lets the About page + notification
  // card offer the release page (browser download). Install/download channels
  // stay stubbed — users get an honest message instead of a silent no-op.
  bridge
    .buildProvider<unknown, { includePrerelease?: boolean; repo?: string }>('update.check')
    .provider(async (p) => {
      const repo = p?.repo || 'iOfficeAI/AionUi';
      try {
        const res = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=10`);
        if (!res.ok) throw new Error(`GitHub API ${res.status}`);
        const releases = (await res.json()) as Array<{
          tag_name: string;
          name?: string;
          body?: string;
          html_url: string;
          published_at?: string;
          prerelease: boolean;
          draft: boolean;
          assets?: Array<{ name: string; browser_download_url: string; size: number; content_type?: string }>;
        }>;
        const currentVersion = (globalThis as { __APP_VERSION__?: string }).__APP_VERSION__ ?? '0.0.0';
        const semverValid = (v: string | undefined) => {
          const m = (v ?? '').replace(/^v/, '').match(/\d+\.\d+\.\d+/);
          return m ? m[0] : null;
        };
        const cur = semverValid(currentVersion);
        const candidates = releases.filter((r) => !r.draft && (p?.includePrerelease ? true : !r.prerelease));
        let newest: null | {
          tagName: string;
          version: string;
          name?: string;
          body?: string;
          htmlUrl: string;
          publishedAt?: string;
          prerelease: boolean;
          draft: boolean;
          assets: Array<{ name: string; url: string; size: number; contentType?: string }>;
        } = null;
        let newer: typeof newest = null;
        const newerThan = (a: string, b: string): boolean => {
          const [x1, x2, x3] = a.split('.').map(Number);
          const [y1, y2, y3] = b.split('.').map(Number);
          return x1 > y1 || (x1 === y1 && (x2 > y2 || (x2 === y2 && x3 > y3)));
        };
        for (const r of candidates) {
          const v = semverValid(r.tag_name);
          if (!v) continue;
          const info = {
            tagName: r.tag_name,
            version: v,
            name: r.name,
            body: r.body,
            htmlUrl: r.html_url,
            publishedAt: r.published_at,
            prerelease: r.prerelease,
            draft: r.draft,
            assets: (r.assets ?? []).map((a) => ({
              name: a.name,
              url: a.browser_download_url,
              size: a.size,
              contentType: a.content_type,
            })),
          };
          if (!newest) newest = info;
          if (cur && !newer && newerThan(v, cur)) newer = info;
        }
        return {
          success: true,
          data: {
            currentVersion,
            updateAvailable: Boolean(newer),
            latest: newest ?? undefined,
          },
        };
      } catch (err) {
        return { success: false, msg: `Update check failed: ${String(err)}` };
      }
    });

  // Theme relay: Electron's main process cached the active theme so fresh
  // windows (ShadowView) could pull its decoration CSS. There is no main
  // process here — read it from configService (same source applyTheme
  // persists to) and re-emit on changes via the bridge emitter so ShadowView
  // instances update live when the user switches themes.
  const resolveActiveThemeForRelay = (): { css?: string } | null => {
    try {
      const activeId = configService.get('theme.activeId');
      const userThemes = configService.get('theme.userThemes');
      if (!activeId || !Array.isArray(userThemes)) return null;
      const theme = userThemes.find((t: { id?: string }) => t.id === activeId);
      return theme && typeof theme.css === 'string' ? { css: theme.css } : null;
    } catch {
      return null;
    }
  };
  bridge.buildProvider('theme:request-current').provider(() => resolveActiveThemeForRelay());
  // Mirror Electron's theme:changed broadcast locally: applyTheme persists to
  // configService before publishing, so any ThemeProvider-driven switch lands
  // here and every ShadowView re-reads its decoration CSS.
  let lastRelayedThemeId: string | undefined;
  configService.subscribe('theme.activeId', () => {
    const activeId = configService.get('theme.activeId');
    if (activeId === lastRelayedThemeId) return;
    lastRelayedThemeId = activeId;
    bridge.emit('theme:changed', resolveActiveThemeForRelay());
  });

  // Electron-native features with no Tauri equivalent: report "not supported"
  // instead of leaving the promise pending forever.
  bridge.buildProvider('app.get-start-on-boot-status').provider(() => ({
    success: true,
    data: { supported: false, enabled: false, isPackaged: true, platform: 'tauri' },
  }));
  bridge.buildProvider('app.set-start-on-boot').provider(() => unsupported('Start on boot is not supported in this build'));
  bridge.buildProvider('app.get-gpu-status').provider(() => ({
    success: true,
    data: { userOverride: null, autoDisabled: false, crashCount: 0, lastCrashAt: null },
  }));
  bridge.buildProvider('app.set-gpu-override').provider(() => unsupported('GPU override is not supported in this build'));
  bridge.buildProvider('app.get-cdp-status').provider(() => ({
    success: true,
    data: { enabled: false, port: null, startupEnabled: false, configEnabled: false, isDevMode: false },
  }));
  bridge.buildProvider('app.update-cdp-config').provider(() => unsupported('CDP is not supported in this build'));
  bridge.buildProvider('app.clear-browser-data').provider(() => unsupported('In-app browser data is not available in this build'));
  bridge.buildProvider('app.report-browser-webcontents-id').provider(() => ({ success: true }));
  for (const name of [
    'auto-update.check',
    'auto-update.restore-downloaded',
    'update.download',
    'update.installer-last-failure.consume',
  ]) {
    bridge.buildProvider(name).provider(() => unsupported('Auto-update is not supported in this build'));
  }

  // Persist system directory overrides to the Tauri-side config file and
  // restart the app so the sidecar picks them up on next boot.
  bridge
    .buildProvider<void, { cacheDir: string; workDir: string; logDir?: string }>('update-system-info')
    .provider(async ({ cacheDir, workDir, logDir }) => {
      if (isTauri()) {
        await invoke<void>('update_system_info', { cacheDir, workDir, logDir });
      }
    });

  bridge.buildProvider<{ restarted: boolean; manualRestartRequired: boolean }, void>('restart-app').provider(async () => {
    if (isTauri()) {
      // `app.restart()` never returns (it diverges), so do not await the
      // invoke — the webview is torn down as part of the restart.
      void invoke<void>('restart_app').catch((error) => console.warn('[tauri] restart failed:', error));
      return { restarted: true, manualRestartRequired: false };
    }
    return { restarted: false, manualRestartRequired: true };
  });
}
