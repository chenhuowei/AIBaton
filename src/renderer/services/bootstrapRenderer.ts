/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { configService } from '@/common/config/configService';
import { ipcBridge } from '@/common';
import { httpRequest } from '@/common/adapter/httpBridge';
import { isTauri } from '@tauri-apps/api/core';

type BootstrapLogger = (message?: unknown, ...optionalParams: unknown[]) => void;

/**
 * Push the persisted close-to-tray value into the native shell.
 *
 * The Tauri close interceptor reads a native flag, and the shell cannot read
 * the backend DB itself (the sidecar is still booting when the window opens).
 * So the renderer — the only party that can wait for `/health` — syncs the
 * persisted value once during bootstrap, before the user can possibly close
 * the window. A failure is non-fatal: the interceptor then stays at the
 * default (no hide-to-tray), matching a fresh install.
 */
async function syncCloseToTrayToShell(): Promise<void> {
  if (!isTauri()) return;
  try {
    const stored = configService.get('system.closeToTray');
    await ipcBridge.systemSettings.setCloseToTray.invoke({ enabled: stored === true });
  } catch (err) {
    console.warn('[bootstrap] close-to-tray sync failed:', err);
  }
}

/**
 * One-shot default agent catalog: enable only the agents that resolve fast on
 * a stock machine (claude / codex / pi) and disable the rest of the builtin
 * list. Every other builtin either needs an installed CLI or is an npx bridge
 * whose startup `--version` probe downloads a package from npm — 12 of those
 * probes dominated backend boot time (measured 14.5 s). This runs only when
 * the default-catalog flag is unset, so a user who deliberately enables other
 * agents keeps their choice; the flag lives in the same client-KV bag.
 */
const DEFAULT_AGENTS_FLAG = 'agents.defaultCatalogApplied';
const DEFAULT_ENABLED_AGENTS = ['claude', 'codex', 'pi'];

async function applyDefaultAgentCatalog(): Promise<void> {
  try {
    const bag = await httpRequest<Record<string, unknown>>('GET', '/api/settings/client');
    if (bag?.[DEFAULT_AGENTS_FLAG]) return;
    const agents = await ipcBridge.acpConversation.getManagedAgents.invoke();
    await Promise.all(
      agents
        .filter((a) => a.agent_source === 'builtin')
        .map((a) =>
          ipcBridge.acpConversation.setAgentEnabled
            .invoke({ id: a.id, enabled: DEFAULT_ENABLED_AGENTS.includes(a.backend ?? '') })
            .catch(() => undefined)
        )
    );
    await httpRequest<void>('PUT', '/api/settings/client', { [DEFAULT_AGENTS_FLAG]: true });
  } catch (err) {
    console.warn('[bootstrap] default agent catalog failed:', err);
  }
}

/**
 * Wait for renderer config initialization without coupling app bootstrap to
 * business data prefetches such as `/api/agents`.
 */
export async function bootstrapRendererConfig(logError: BootstrapLogger = console.error): Promise<void> {
  await configService.initialize().catch((err) => {
    logError('Failed to initialize config:', err);
  });
  await syncCloseToTrayToShell();
  await applyDefaultAgentCatalog();
}
