/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Safe localStorage helpers.
 *
 * localStorage access and JSON parsing can throw in several real situations:
 *   - Storage is disabled / in private mode / quota exceeded
 *   - A user or another tool wrote malformed JSON
 *   - A key that previously held an object now holds a primitive
 *
 * These helpers never throw: they return the provided default on any failure.
 */

export function safeStorageGet<T>(key: string, defaultValue: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return defaultValue;
    return JSON.parse(raw) as T;
  } catch {
    return defaultValue;
  }
}

export function safeStorageSet<T>(key: string, value: T): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function safeStorageRemove(key: string): boolean {
  try {
    localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
