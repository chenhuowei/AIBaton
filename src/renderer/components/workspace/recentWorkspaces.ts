/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

export const DEFAULT_RECENT_WS_KEY = 'aionui:recent-workspaces';
const MAX_RECENT_WORKSPACES = 5;

import { safeStorageGet, safeStorageSet } from '@renderer/utils/storage';

export const getRecentWorkspaces = (storageKey: string = DEFAULT_RECENT_WS_KEY): string[] =>
  safeStorageGet<string[]>(storageKey, []);

export const addRecentWorkspace = (path: string, storageKey: string = DEFAULT_RECENT_WS_KEY): void => {
  const prev = getRecentWorkspaces(storageKey);
  const next = [path, ...prev.filter((item) => item !== path)].slice(0, MAX_RECENT_WORKSPACES);
  safeStorageSet(storageKey, next);
};
