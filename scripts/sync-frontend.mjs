#!/usr/bin/env node
/**
 * One-shot frontend sync from AionUi main (2.2.2) for the Tauri build.
 *
 * Everything under src/ is recreated from upstream on every run; Tauri-specific
 * files live in overlays/ and are copied on top afterwards. No 2.1.1 code is
 * retained.
 *
 * Usage: node scripts/sync-frontend.mjs [--upstream <path>]
 */

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? resolve(process.argv[i + 1]) : fallback;
};
const UPSTREAM = arg('--upstream', resolve(ROOT, '..', 'AionUi'));
const DESKTOP = join(UPSTREAM, 'packages', 'desktop', 'src');
const RENDERER = join(DESKTOP, 'renderer');
const COMMON = join(DESKTOP, 'common');
const SRC = join(ROOT, 'src');

const upstreamPkg = JSON.parse(readFileSync(join(UPSTREAM, 'package.json'), 'utf8'));
console.log(`[sync-frontend] upstream: ${UPSTREAM}`);
console.log(`[sync-frontend] AionUi ${upstreamPkg.version}, aioncoreVersion ${upstreamPkg.aioncoreVersion}`);
if (upstreamPkg.version !== '2.2.2') {
  console.warn(`[sync-frontend] WARNING: this sync script was written for 2.2.2, got ${upstreamPkg.version}`);
}
for (const p of [RENDERER, COMMON, join(UPSTREAM, 'public'), join(UPSTREAM, 'uno.config.ts')]) {
  if (!existsSync(p)) throw new Error(`[sync-frontend] missing upstream path: ${p}`);
}

// 1. Full replace (user decision: remove the old 2.1.1 frontend entirely)
rmSync(SRC, { recursive: true, force: true });
mkdirSync(SRC, { recursive: true });
cpSync(RENDERER, join(SRC, 'renderer'), { recursive: true });
cpSync(COMMON, join(SRC, 'common'), { recursive: true });
cpSync(join(UPSTREAM, 'public'), join(ROOT, 'public'), { recursive: true });
cpSync(join(UPSTREAM, 'uno.config.ts'), join(ROOT, 'uno.config.ts'));

const countFiles = (dir) => {
  let n = 0;
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      e.isDirectory() ? walk(p) : n++;
    }
  };
  walk(dir);
  return n;
};
console.log(`[sync-frontend] copied src/: ${countFiles(SRC)} files`);

// 2. Patch helper
const patched = [];
const skipped = [];
function patch(relPath, transform, label) {
  const abs = join(SRC, relPath);
  if (!existsSync(abs)) {
    skipped.push(`${relPath} (not present upstream)`);
    return;
  }
  const before = readFileSync(abs, 'utf8');
  const after = transform(before);
  if (after === before) {
    skipped.push(`${relPath} (already patched / no match)`);
    return;
  }
  writeFileSync(abs, after, 'utf8');
  patched.push(`${relPath} — ${label}`);
}

// 2a0. index.html — inject desktop-runtime markers SYNCHRONOUSLY, before any
//      ES module is evaluated. Several upstream modules read them at module
//      top level (AuthContext.isDesktopRuntime, browser.ts adapter branch,
//      registerWebFsPicker, i18n hint). Installing them from bootstrap.ts
//      (async, after imports) is too late and shows the login page.
patch('renderer/index.html', (s) => {
  const inline = [
    '    <script>',
    '      // Tauri desktop markers. Must be synchronous and BEFORE the module script:',
    '      // upstream modules evaluate these at import time.',
    '      (function () {',
    "        if (!window.electronAPI) window.electronAPI = { emit: function(){}, on: function(){} };",
    '        if (!window.__backendStartupBridge) {',
    '          window.__backendStartupBridge = {',
    '            getState: function(){ return null; },',
    '            subscribe: function(){ return function(){}; },',
    '          };',
    '        }',
    '        if (window.__backendStartupFailure === undefined) window.__backendStartupFailure = null;',
    '      })();',
    '    </script>',
  ].join('\n');
  const splashLink = '    <link rel="stylesheet" href="./boot-splash.css" />';
  const splashHtml = [
    '    <div id="aibaton-boot" role="status" aria-label="Starting Aibaton">',
    '      <div class="grid"></div><div class="scan"></div>',
    '      <div class="core">',
    '        <div class="ring r1"></div><div class="ring r2"></div><div class="ring r3"></div>',
    '        <div class="orbit"><span class="dot"></span></div><div class="mark"></div>',
    '      </div>',
    '      <div class="label"><b>AI</b>BATON</div>',
    '      <div class="sub">INITIALIZING WORKSPACE</div>',
    '      <div class="bar"><i></i></div>',
    '    </div>',
  ].join('\n');
  let out = s.replace('<head>', `<head>\n${inline}\n${splashLink}`);
  out = out.replace('<div id="root"></div>', `${splashHtml}\n    <div id="root"></div>`);
  return out.replace('<html data-theme="light"', '<html data-theme="dark"');
}, 'synchronous markers + dark default + boot splash in <head>');

// 2a. main.tsx (2.2.2): remove both Electron Sentry dynamic imports and gate
//     the final root.render() behind the Tauri endpoint handshake.
patch('renderer/main.tsx', (s) => {
  let out = s.replace(
    /\/\/ Sentry must be initialized first[\s\S]*?\n\}\n\n(?=\/\/ Runtime patches must be imported early)/,
    ''
  );
  out = out.replace(
    /  void import\('@sentry\/electron\/renderer'\)[\s\S]*?\n    \.catch\(\(\) => \{\}\);\n/,
    '  // Tauri build: Sentry Electron renderer unavailable; integrity diag reporting is a no-op.\n'
  );

  const bootstrap = [
    '',
    '// Tauri bootstrap: resolve the aioncore sidecar endpoint before mounting.',
    '// All early HTTP/WS calls queue on @/common/adapter/endpointGate.',
    "import { bootstrapTauri } from './tauri/bootstrap';",
    '',
  ].join('\n');
  out = out.replace(/(\*\/)\n\n\/\/ Runtime patches must be imported early/, `$1\n${bootstrap}\n// Runtime patches must be imported early`);

  const marker = "const root = createRoot(document.getElementById('root')!);\nroot.render(";
  const idx = out.indexOf(marker);
  if (idx === -1) {
    skipped.push('renderer/main.tsx — root.render marker changed upstream');
    return out;
  }
  const head = out.slice(0, idx);
  const argExpr = out.slice(idx + marker.length).replace(/\);\s*$/, ')');
  return (
    head +
    "const root = createRoot(document.getElementById('root')!);\n" +
    'void bootstrapTauri(() =>\n  root.render(' +
    argExpr +
    '\n);\n'
  );
}, 'Tauri bootstrap gates root.render + drop @sentry/electron');

// 2b. httpBridge.ts: absolute sidecar origin instead of window.__backendPort,
//     plus a readiness gate on every HTTP request / WS connect.
patch('common/adapter/httpBridge.ts', (s) => {
  let out = s.replace(
    /function getBackendPort\(\): number \{[\s\S]*?\n\}\n/,
    [
      "let backendBaseUrl = '';",
      '',
      '/** Set by the Tauri bootstrap once the sidecar has passed /health. */',
      'export function setBackendBaseUrl(url: string): void {',
      "  backendBaseUrl = url.replace(/\\/$/, '');",
      '}',
      '',
      'export function getBackendBaseUrl(): string {',
      '  return backendBaseUrl;',
      '}',
      '',
    ].join('\n')
  );
  out = out.replace(
    /function isWebUiBrowserMode\(\): boolean \{[\s\S]*?\n\}\n/,
    [
      'function isWebUiBrowserMode(): boolean {',
      "  return typeof window !== 'undefined' && typeof document !== 'undefined' && backendBaseUrl === '';",
      '}',
      '',
    ].join('\n')
  );
  out = out.replace(
    /export function getBaseUrl\(\): string \{[\s\S]*?\n\}\n/,
    [
      'export function getBaseUrl(): string {',
      '  return backendBaseUrl;',
      '}',
      '',
    ].join('\n')
  );
  out = out.replace(
    /  return `ws:\/\/127\.0\.0\.1:\$\{getBackendPort\(\)\}\/ws`;/,
    [
      '  const base = backendBaseUrl || `${window.location.protocol}//${window.location.host}`;',
      "  return `${base.replace(/^http/, 'ws')}/ws`;",
    ].join('\n')
  );
  out = out.replace(
    /(export async function httpRequest<T>\(\n  method: string,\n  path: string,\n  body\?: unknown,\n  options\?: HttpRequestOptions\n\): Promise<T> \{\n)/,
    '$1  await waitForBackend();\n'
  );
  out = out.replace(
    'function ensureWs(): void {\n',
    'function ensureWs(): void {\n  void waitForBackend().then(ensureWsInternal);\n}\n\nfunction ensureWsInternal(): void {\n'
  );
  if (!out.includes('endpointGate')) {
    out = "import { waitForBackend } from '@/common/adapter/endpointGate';\n" + out;
  }
  return out;
}, 'setBackendBaseUrl() + readiness gate');

// 2c. configService.ts
patch(
  'common/config/configService.ts',
  (s) =>
    s
      .replace(
        /function getBaseUrl\(\): string \{[\s\S]*?\n\}\n/,
        [
          'function getBaseUrl(): string {',
          "  return (globalThis as { __aionuiBackendBaseUrl?: string }).__aionuiBackendBaseUrl ?? '';",
          '}',
          '',
        ].join('\n')
      )
      .replace(
        /(async function fetchJson<T>\(method: string, path: string, body\?: unknown\): Promise<T> \{\n)/,
        '$1  await waitForBackend();\n'
      )
      .replace(
        "import type { ConfigKey, ConfigKeyMap } from './configKeys';\n",
        "import type { ConfigKey, ConfigKeyMap } from './configKeys';\nimport { waitForBackend } from '@/common/adapter/endpointGate';\n"
      ),
  'injected backend base URL + readiness gate'
);

// 2d. browser.ts (2.2.2 uses @/common/platform/bridge)
patch('common/adapter/browser.ts', (s) => {
  const oldBlock = [
    "  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';",
    '  const defaultHost = `${window.location.hostname}:${WEBUI_DEFAULT_PORT}`;',
    '  const socketUrl = `${protocol}//${window.location.host || defaultHost}/ws`;',
  ].join('\n');
  const newBlock = [
    "  const injected = (globalThis as { __aionuiBackendBaseUrl?: string }).__aionuiBackendBaseUrl ?? '';",
    "  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';",
    '  const socketUrl = injected',
    "    ? `${injected.replace(/^http/, 'ws')}/ws`",
    '    : `${protocol}//${window.location.host}/ws`;',
  ].join('\n');
  let out = s
    .replace(oldBlock, newBlock)
    .replace("import { WEBUI_DEFAULT_PORT } from '@/common/config/constants';\n", '')
    .replace(
      /^  connect\(\);\n\n  \/\/ Expose reconnection control for login flow/m,
      '  void waitForBackend().then(connect);\n\n  // Expose reconnection control for login flow'
    );
  if (!out.includes('endpointGate')) {
    out = "import { waitForBackend } from '@/common/adapter/endpointGate';\n" + out;
  }
  return out;
}, 'WebSocket uses injected sidecar origin + readiness gate');

// 2d2. With the desktop marker installed synchronously, browser.ts would take
//      the Electron IPC branch and the platform bridge would receive no events
//      (Tauri has no preload). Force the WebView/WebSocket adapter instead.
patch(
  'common/adapter/browser.ts',
  (s) => s.replace('if (win.electronAPI) {', 'if (false && win.electronAPI) {'),
  'force WebView WebSocket adapter (no Electron preload in Tauri)'
);

// 2d3. dialog.showOpen + windowControls: replace Electron-only IPC channels
//      (which hang forever in Tauri) with native Tauri implementations.
patch(
  'common/adapter/ipcBridge.ts',
  (s) => {
    let out = s.replace(
      /const isElectronRenderer = \(\): boolean =>\n  typeof window !== 'undefined' && Boolean\(\(window as \{ electronAPI\?: unknown \}\)\.electronAPI\);/,
      'const isElectronRenderer = (): boolean => false; // Tauri: no Electron IPC provider'
    );
    out = out.replace(
      /export const dialog = \{\n  showOpen: \{[\s\S]*?\n  \},\n\};/,
      [
        'export const dialog = {',
        '  showOpen: {',
        '    provider: () => {},',
        '    invoke: ((options?: ShowOpenOptions) => tauriShowOpen(options)) as typeof nativeShowOpen.invoke,',
        '  },',
        '};',
      ].join('\n')
    );
    out = out.replace(
      /export const windowControls = \{[\s\S]*?\n\};/,
      'export const windowControls = tauriWindowControls;'
    );
    if (!out.includes('tauri/capabilities')) {
      out = "import { tauriShowOpen, tauriWindowControls } from '@renderer/tauri/capabilities';\n" + out;
    }
    return out;
  },
  'native Tauri dialog + window controls'
);

// 2d4. registerWebFsPicker: register the picker even with the desktop marker.
patch(
  'renderer/components/workspace/registerWebFsPicker.ts',
  (s) =>
    s.replace(
      "if (typeof window !== 'undefined' && !(window as { electronAPI?: unknown }).electronAPI) {",
      "if (typeof window !== 'undefined') {"
    ),
  'always register backend file picker'
);

// 2d5. applyTheme: `theme:set-active` is an Electron IPC channel with no
//      provider in Tauri; skip publishing (local theme still applies via CSS).
patch(
  'renderer/utils/theme/applyTheme.ts',
  (s) =>
    s.replace(
      /function isElectronRenderer\(\): boolean \{\n  return typeof window !== 'undefined' && Boolean\(\(window as Window & \{ electronAPI\?: unknown \}\)\.electronAPI\);\n\}/,
      'function isElectronRenderer(): boolean {\n  return false; // Tauri: no Electron IPC provider for theme:set-active\n}'
    ),
  'skip Electron-only theme publish'
);

// 2d6. Default dark mode for a fresh install. Users can still choose light
//      or system from Appearance settings (persisted via configService).
patch(
  'renderer/hooks/system/useTheme.ts',
  (s) =>
    s
      .replace(
        "import { LIGHT_THEME_ID } from '@/common/theme/constants';",
        "import { LIGHT_THEME_ID, DARK_THEME_ID } from '@/common/theme/constants';"
      )
      .replace(
        "  return (configService.get('theme.activeId') as string) || LIGHT_THEME_ID;",
        "  return (configService.get('theme.activeId') as string) || DARK_THEME_ID;"
      )
      .replace(
        '    const fallback = resolveActiveTheme(LIGHT_THEME_ID, BUILTIN_THEMES);',
        '    const fallback = resolveActiveTheme(DARK_THEME_ID, BUILTIN_THEMES);'
      ),
  'default dark theme (fresh install / fallback)'
);

// 2d7. index.html: seed dark on first paint to avoid a white flash before
//      useTheme resolves. Persisted appearance still wins when present.
patch('renderer/index.html', (s) => {
  const oldTheme = [
    "          var theme = localStorage.getItem('__aionui_theme');",
    "          if (theme) document.documentElement.setAttribute('data-theme', theme);",
  ].join('\n');
  const newTheme = [
    "          var theme = localStorage.getItem('__aionui_theme') || 'dark';",
    "          document.documentElement.setAttribute('data-theme', theme);",
  ].join('\n');
  let out = s.replace(oldTheme, newTheme);
  const oldBody = [
    "        var t = localStorage.getItem('__aionui_theme');",
    "        if (t) document.body.setAttribute('arco-theme', t);",
  ].join('\n');
  const newBody = [
    "        var t = localStorage.getItem('__aionui_theme') || 'dark';",
    "        document.body.setAttribute('arco-theme', t);",
  ].join('\n');
  return out.replace(oldBody, newBody);
}, 'seed dark appearance on first paint');

// 2e. v0.2.2 removed POST /api/agents/refresh. Upstream 2.2.2 still calls it;
//     AionCore's own test asserts 404 (legacy_refresh_agents_endpoint_is_not_found).
patch(
  'common/adapter/ipcBridge.ts',
  (s) =>
    s.replace(
      "  refreshCustomAgents: httpPost<void, void>('/api/agents/refresh'),",
      [
        '  // AionCore v0.2.2 removed this endpoint; hydrates the registry at startup.',
        '  refreshCustomAgents: {',
        '    provider: () => {},',
        '    invoke: (async () => undefined) as () => Promise<void>,',
        '  },',
      ].join('\n')
    ),
  'v0.2.2 removed /api/agents/refresh'
);

// 2f. Sentry feedback submitter (moved in 2.2.2).
patch(
  'renderer/services/feedback/submitFeedbackReport.ts',
  (s) =>
    s.replace(
      "    const Sentry = await import('@sentry/electron/renderer');",
      [
        '    // Tauri build: @sentry/electron is Electron-only and not installed.',
        '    const Sentry = {',
        '      withScope: (cb: (scope: { setTag: (_k: string, _v: string) => void; setUser: (_u: unknown) => void }) => void) =>',
        '        cb({ setTag: () => undefined, setUser: () => undefined }),',
        '      captureEvent: (..._args: unknown[]) => undefined,',
        '      getClient: () => ({ flush: async (_ms?: number) => true }),',
        '    };',
      ].join('\n')
    ),
  'remove @sentry/electron dynamic import (feedback)'
);

// 2g. Remove Electron main-process-only files. Keep common/platform/bridge.ts
//     (used by the renderer in 2.2.2) and platform/storage.ts.
for (const rel of [
  'common/adapter/main.ts',
  'common/platform/ElectronPlatformServices.ts',
  'common/platform/NodePlatformServices.ts',
  'common/platform/register-electron.ts',
  'common/platform/index.ts',
  'common/platform/IPlatformServices.ts',
  'common/electronSafe.ts',
]) {
  const abs = join(SRC, rel);
  if (existsSync(abs)) {
    rmSync(abs);
    patched.push(`${rel} — removed (Electron main-process only)`);
  }
}

// 2h. [Audit A] Remove PWA/Service Worker registration in the desktop build.
//      The SW cached an old index.html and caused a stale login page after
//      upgrades. Keep the files (static assets) but do not register.
patch(
  'renderer/main.tsx',
  (s) => s.replace('void registerPwa();', '// PWA disabled in the Tauri desktop build (SW caches stale HTML).'),
  'disable PWA registration'
);

// 2i. [Audit B] Make every remaining Electron-only IPC channel resolve
//      instead of hanging. A small runtime adapter is installed at startup
//      (see overlays/common/adapter/ipcStub.ts) that answers these channel
//      names on the platform bridge; no structural edits to ipcBridge.ts.

// 2j. [Audit C/D/E] Hide settings entries for features this build does not
//      implement: WebUI remote tab, auto-update block, and pet settings.
//      Pages stay in the bundle so upstream patches keep applying cleanly.
patch(
  'renderer/components/settings/SettingsModal/index.tsx',
  (s) =>
    s.replace(
      /    if \(isDesktop\) \{\n      builtinItems\.push\(\{[\s\S]*?\n    \}\n/, 
      '    // WebUI remote tab hidden: not implemented in the Tauri build.\n'
    ),
  'hide WebUI settings tab'
);
patch(
  'renderer/components/settings/SettingsModal/contents/AboutModalContent.tsx',
  (s) => s.replace('{isElectron && (', '{false && isElectron && ('),
  'hide auto-update block'
);
// Independent settings page sider: hide WebUI remote + pet entries too.
patch(
  'renderer/pages/settings/components/SettingsSider.tsx',
  (s) =>
    s.replace(
      /const result: SiderItem\[\] = BUILTIN_TAB_IDS\.filter\(\(id\) => isDesktop \|\| id !== 'pet'\)\.map\(\(id\) => builtinMap\[id\]\);/,
      "const result: SiderItem[] = BUILTIN_TAB_IDS.filter((id) => id !== 'pet' && id !== 'webui').map((id) => builtinMap[id]);"
    ),
  'hide WebUI + pet in settings sider'
);
patch(
  'renderer/pages/settings/components/SettingsPageWrapper.tsx',
  (s) =>
    s.replace(
      'return BUILTIN_TAB_IDS.map((id) => builtinMap[id]);',
      "return BUILTIN_TAB_IDS.filter((id) => id !== 'pet' && id !== 'webui').map((id) => builtinMap[id]);"
    ),
  'hide WebUI + pet in settings page wrapper'
);

// 2k. [Audit F] i18n rebrand runs in scripts/rebrand.mjs after this script.

// 2l. Dark-mode text colour fixes. Upstream relies on Electron's preload
//     setting a root text colour; the Tauri/WebView build has no preload, and
//     UnoCSS's `color: inherit` preflight leaves `html/body` at the browser
//     initial black. Every unstyled text node (CLI terminal output included)
//     then renders black-on-black in dark mode. These patches are re-applied on
//     every sync because step 1 replaces all of src/ from upstream.
patch(
  'renderer/styles/arco-override.css',
  (s) =>
    s
      .replace(
        'html,\nbody {\n  /* Global ("app") region font.',
        [
          'html,',
          'body {',
          '  /* Root text colour must follow the theme. UnoCSS sets `color: inherit`',
          '     on every element; without this, dark mode inherits initial black. */',
          '  color: var(--text-primary);',
          '  /* Global ("app") region font.',
        ].join('\n')
      )
      .replace(
        /\.arco-btn \{\n  &\.arco-btn-outline \{\n    border-color: #86909c;\n    color: #86909c;\n  \}\n\}/,
        [
          '.arco-btn {',
          '  &.arco-btn-outline {',
          '    border-color: var(--text-secondary);',
          '    color: var(--text-secondary);',
          '  }',
          '}',
        ].join('\n')
      )
      .replace(
        '  background-color: #e8f3ff !important;\n  border-color: #e8f3ff !important;',
        '  background-color: var(--brand-light) !important;\n  border-color: var(--brand-light) !important;'
      ),
  'dark-mode root text colour + theme-aware Arco overrides'
);

patch(
  'renderer/styles/themes/default-color-scheme.css',
  (s) =>
    s
      .replace(
        '  --text-0: #000000; /* 纯黑文字色 */',
        '  --text-0: var(--text-primary); /* 跟随主题主文字色 */'
      )
      .replace(
        '  --text-0: #ffffff; /* 纯黑文字色（暗色模式下为白色） */',
        '  --text-0: var(--text-primary); /* 跟随主题主文字色 */'
      ),
  'theme-aware legacy text-0 token'
);

patch(
  'renderer/pages/conversation/Messages/components/MessageThinking.module.css',
  (s) => s.replace('.body {\n  color: #86909c;', '.body {\n  color: var(--text-secondary);'),
  'theme-aware thinking-chain text'
);

for (const rel of [
  'renderer/pages/conversation/Messages/components/MessageToolCall.tsx',
  'renderer/pages/conversation/Messages/components/MessageToolGroupSummary.tsx',
]) {
  patch(
    rel,
    (s) =>
      s
        .replaceAll("color-#86909C gap-12px", "text-t-secondary gap-12px")
        .replaceAll("hover:color-#4E5969", "hover:text-t-primary"),
    'theme-aware tool-call/meta text colours'
  );
}

patch(
  'renderer/pages/conversation/components/ChatLayout/index.tsx',
  (s) => s.replace('className=\'size-full color-black \'', 'className=\'size-full text-t-primary\''),
  'theme-aware chat layout foreground (dark-mode CLI replies)'
);

patch(
  'renderer/pages/conversation/components/ChatLayout/index.tsx',
  (s) => s.replace('className=\'size-full color-black \'', 'className=\'size-full text-t-primary\''),
  'theme-aware chat layout foreground (dark-mode CLI replies)'
);

// 2m. Agent settings: expose the enable/disable switch for BUILTIN agents.
//     The upstream UI renders the Switch only for custom agents ("controls
//     that have no meaning for built-ins"), but the backend PATCH
//     /api/agents/:id/enabled works for built-ins too, and disabled built-ins
//     skip the startup CLI probe — the main lever on backend boot time when
//     many npx-bridge registry CLIs are not installed.
patch(
  'renderer/pages/settings/AgentSettings/AgentCard.tsx',
  (s) =>
    s
      // 1. official prop variant gains onToggle
      .replace(
        [
          'type: \'official\';',
          '      agent: ManagedAgent;',
          '      boundAssistants: Assistant[];',
          '      onTestConnection: () => void;',
          '      onConfigure: () => void;',
          '      isTesting?: boolean;',
        ].join('\n'),
        [
          'type: \'official\';',
          '      agent: ManagedAgent;',
          '      boundAssistants: Assistant[];',
          '      onTestConnection: () => void;',
          '      onConfigure: () => void;',
          '      isTesting?: boolean;',
          '      /** Enable/disable the agent. Disabled built-ins skip the startup CLI',
          '       * probe entirely (the main lever for backend boot time). */',
          '      onToggle: (enabled: boolean) => void;',
        ].join('\n')
      )
      // 2. official card renders the switch after the custom-only block
      .replace(
        '        ) : null}\n      </div>\n    </div>\n  );\n};\n\nexport default AgentCard;',
        [
          '        ) : null}',
          '        {/* Official agents: enable/disable only. Disabled built-ins skip the',
          '            startup CLI probe, so this switch is the direct lever on backend',
          '            boot time — the effect shows on the next launch. */}',
          '        {props.type === \'official\' ? (',
          '          <Tooltip content={t(\'settings.agentManagement.toggleOfficialHint\', { defaultValue: \'Disabled agents are skipped during startup (faster launch). Takes effect after restart.\' })}}>',
          '            <Switch size=\'small\' checked={agent.enabled !== false} onChange={props.onToggle} />',
          '          </Tooltip>',
          '        ) : null}',
          '      </div>',
          '    </div>',
          '  );',
          '};',
          '',
          'export default AgentCard;',
        ].join('\n')
      ),
  'builtin agent enable/disable switch'
);

patch(
  'renderer/pages/settings/AgentSettings/LocalAgents.tsx',
  (s) =>
    s
      // reuse the custom toggle handler for official cards
      .replace(
        /  const handleToggleCustomAgent = useCallback\(\n([\s\S]*?)\n  \);\n/,
        [
          '  const handleToggleCustomAgent = useCallback(',
          '$1',
          '  );',
          '',
          '  // Same endpoint as custom agents — the backend PATCH works for built-ins',
          '  // too. Disabled built-ins skip the startup CLI probe, which is the main',
          '  // lever on backend boot time when many registry CLIs are not installed.',
          '  const handleToggleOfficialAgent = handleToggleCustomAgent;',
          '',
        ].join('\n')
      )
      // official AgentCard gets onToggle
      .replace(
        [
          '              onTestConnection={() => void handleTestConnection(agent.id)}',
          '              onConfigure={() => openAgentConfig(agent.id)}',
          '              isTesting={testingAgentId === agent.id}',
        ].join('\n'),
        [
          '              onTestConnection={() => void handleTestConnection(agent.id)}',
          '              onConfigure={() => openAgentConfig(agent.id)}',
          '              isTesting={testingAgentId === agent.id}',
          '              onToggle={(enabled) => void handleToggleOfficialAgent(agent.id, enabled)}',
        ].join('\n')
      ),
  'wire builtin agent toggle in agent management list'
);

patch(
  'renderer/components/chat/SendBox/sendbox.css',
  (s) =>
    s
      .replace(
        '/* Input placeholder color */\n::placeholder {\n  color: #a1a2aa !important;\n}',
        '/* Input placeholder colour follows the theme. */\n::placeholder {\n  color: var(--text-secondary) !important;\n  opacity: 0.65;\n}'
      )
      .replace(
        '.sendbox-highlight-textarea::placeholder {\n  color: #a1a2aa !important;\n  -webkit-text-fill-color: #a1a2aa !important;\n}',
        '.sendbox-highlight-textarea::placeholder {\n  color: var(--text-secondary) !important;\n  -webkit-text-fill-color: var(--text-secondary) !important;\n  opacity: 0.65;\n}'
      ),
  'theme-aware sendbox placeholder colours'
);

patch(
  'renderer/pages/conversation/Messages/components/MessageToolGroupSummary.css',
  (s) =>
    s
      .replaceAll('color: var(--color-text-3, #86909c);', 'color: var(--text-secondary);')
      .replace('color: var(--color-text-2, #4e5969);', 'color: var(--text-primary);')
      .replace('background: var(--color-fill-1, #f7f8fa);', 'background: var(--bg-2);'),
  'theme-aware tool detail colours'
);

patch(
  'renderer/services/bootstrapRenderer.ts',
  (s) =>
    s
      .replace(
        "import { configService } from '@/common/config/configService';\n",
        "import { configService } from '@/common/config/configService';\nimport { httpRequest } from '@/common/adapter/httpBridge';\n"
      )
      .replace(
        /(export async function bootstrapRendererConfig\(logError: BootstrapLogger = console\.error\): Promise<void> \{\n  await configService\.initialize\(\)\.catch\(\(err\) => \{\n    logError\('Failed to initialize config:', err\);\n  \}\);\n)/,
        [
          '$1',
          '  await syncCloseToTrayToShell();',
          '  await applyDefaultAgentCatalog();',
        ].join('\n'),
      )
      // Append helpers before the bootstrap function.
      .replace(
        /(\/\*\*\n \* Wait for renderer config initialization)/,
        [
          '/** Close-to-tray + default agent catalog bootstrap helpers. */',
          'const DEFAULT_AGENTS_FLAG = \'agents.defaultCatalogApplied\';',
          'const DEFAULT_ENABLED_AGENTS = [\'claude\', \'codex\', \'pi\'];',
          '',
          'async function syncCloseToTrayToShell(): Promise<void> {',
          '  if (!isTauri()) return;',
          '  try {',
          '    const stored = configService.get(\'system.closeToTray\');',
          '    await ipcBridge.systemSettings.setCloseToTray.invoke({ enabled: stored === true });',
          '  } catch (err) {',
          '    console.warn(\'[bootstrap] close-to-tray sync failed:\', err);',
          '  }',
          '}',
          '',
          '/** One-shot default agent catalog: enable claude/codex/pi, disable the',
          ' * rest of the builtin list. npx-bridge startup probes dominated backend',
          ' * boot time; the flag keeps later user choices intact. */',
          'async function applyDefaultAgentCatalog(): Promise<void> {',
          '  try {',
          '    const bag = await httpRequest<Record<string, unknown>>(\'GET\', \'/api/settings/client\');',
          '    if (bag?.[DEFAULT_AGENTS_FLAG]) return;',
          '    const agents = await ipcBridge.acpConversation.getManagedAgents.invoke();',
          '    await Promise.all(',
          '      agents',
          '        .filter((a) => a.agent_source === \'builtin\')',
          '        .map((a) =>',
          '          ipcBridge.acpConversation.setAgentEnabled',
          '            .invoke({ id: a.id, enabled: DEFAULT_ENABLED_AGENTS.includes(a.backend ?? \'\') })',
          '            .catch(() => undefined)',
          '        ),',
          '    );',
          '    await httpRequest<void>(\'PUT\', \'/api/settings/client\', { [DEFAULT_AGENTS_FLAG]: true });',
          '  } catch (err) {',
          '    console.warn(\'[bootstrap] default agent catalog failed:\', err);',
          '  }',
          '}',
          '',
          '$1',
        ].join('\n'),
      )
      .replace(
        "import { configService } from '@/common/config/configService';\nimport { httpRequest } from '@/common/adapter/httpBridge';\n",
        "import { configService } from '@/common/config/configService';\nimport { httpRequest } from '@/common/adapter/httpBridge';\nimport { ipcBridge } from '@/common';\nimport { isTauri } from '@tauri-apps/api/core';\n"
      ),
  'close-to-tray shell sync + one-shot default agent catalog at bootstrap'
);

patch(
  'renderer/components/settings/SettingsModal/contents/SystemModalContent/index.tsx',
  (s) =>
    s.replace(
      '          {/* In-app browser: sign-in state and cache */}\n          <BrowserDataSection />',
      [
        '          {/* In-app browser: hidden in the Tauri build — the Electron',
        '              webview (clear-browser-data) has no Tauri counterpart, so the',
        '              section only offers a broken switch and an erroring button. */}',
        '          {false && <BrowserDataSection />}',
      ].join('\n'),
    ),
  'hide in-app browser data section (no Tauri webview)'
);

// 3. Overlay Tauri-specific files.
const OVERLAYS = join(ROOT, 'overlays');
if (existsSync(OVERLAYS)) {
  cpSync(join(OVERLAYS, 'common'), join(SRC, 'common'), { recursive: true });
  cpSync(join(OVERLAYS, 'renderer'), join(SRC, 'renderer'), { recursive: true });
  if (existsSync(join(OVERLAYS, 'public'))) {
    cpSync(join(OVERLAYS, 'public'), join(ROOT, 'public'), { recursive: true });
  }
  patched.push('overlays/** — endpointGate + platform shim + tauri/bootstrap + boot-splash.css + types.d.ts');
}

// 4. Always regenerate the Aibaton icons LAST. sync-frontend copies
//      ../AionUi/public (and its renderer assets) over ours, so running this
//      script directly would otherwise restore upstream artwork.
try {
  const { execFileSync } = await import('node:child_process');
  execFileSync(process.execPath, [join(ROOT, 'scripts', 'generate-icons.mjs')], { stdio: 'inherit' });
  patched.push('icons — regenerated from scripts/generate-icons.mjs');
} catch (error) {
  console.error('[sync-frontend] icon generation failed:', error);
}

console.log(`\n[sync-frontend] patched ${patched.length} items:`);
for (const p of patched) console.log(`  ✓ ${p}`);
if (skipped.length) {
  console.log(`\n[sync-frontend] skipped ${skipped.length}:`);
  for (const p of skipped) console.log(`  - ${p}`);
}
console.log(`\n[sync-frontend] done. Relative target: ${relative(ROOT, SRC)}`);
