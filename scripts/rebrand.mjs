#!/usr/bin/env node
/**
 * Aibaton rebrand + UI pass. Runs after sync-frontend.mjs recreated src/ and
 * public/ from upstream. Idempotent.
 *
 * - User-visible strings / titles / manifest / i18n: AionUi -> Aibaton.
 * - Code license headers (Apache-2.0 §4) are PRESERVED on purpose.
 * - Internal keys (`__aionui_theme`, `AIONUI_*`, `aionui:`) are NOT renamed.
 * - `aioncore`, `AionCore`, `Aion CLI` stay (backend / agent product names).
 * - About page, sidebar header and built-in agent logo are replaced with
 *   Aibaton-specific material from overlays/.
 */

import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let changed = 0;
let patched = [];

function rewrite(path, fn, label) {
  if (!existsSync(path)) return;
  const before = readFileSync(path, 'utf8');
  const after = fn(before);
  if (after !== before) {
    writeFileSync(path, after, 'utf8');
    changed++;
    if (label) patched.push(label);
  }
}

/** Replace user-facing product names while keeping license headers intact. */
function rebrandText(s) {
  return s
    .replace(/AionUi Rust/g, 'Aibaton')
    .replace(/AionUI/g, 'Aibaton')
    .replace(/AionUi/g, 'Aibaton')
    .replace(/aionui-rust/g, 'aibaton');
}

// 1. i18n locale JSON: all 13 languages, all modules.
const locales = join(ROOT, 'src/renderer/services/i18n/locales');
for (const lang of readdirSync(locales, { withFileTypes: true })) {
  if (!lang.isDirectory()) continue;
  const dir = join(locales, lang.name);
  for (const f of readdirSync(dir)) {
    if (f.endsWith('.json')) rewrite(join(dir, f), rebrandText);
  }
}

// 2. index.html (title/meta) — keep the __aionui_theme localStorage key.
rewrite(join(ROOT, 'src/renderer/index.html'), (s) =>
  s
    .replace(/<meta name="application-name" content="AionUi" \/>/, '<meta name="application-name" content="Aibaton" />')
    .replace(/<meta name="apple-mobile-web-app-title" content="AionUi" \/>/, '<meta name="apple-mobile-web-app-title" content="Aibaton" />')
    .replace(/<title>AionUi<\/title>/, '<title>Aibaton</title>')
);

// 3. PWA manifest / SW cache name.
rewrite(join(ROOT, 'public/manifest.webmanifest'), rebrandText);
rewrite(join(ROOT, 'public/sw.js'), (s) => s.replace(/aionui-webui-v2/, 'aibaton-webui-v1'));

// 4. All src text files: product names, with protected placeholders.
const PROTECTED = [
  // Longest first: a shorter token must not consume part of a longer one.
  'Copyright 2025 AionUi (aionui.com)',
  'Copyright 2026 AionUi (aionui.com)',
  'AionUi Image Generation',
  'iOfficeAI/AionUi',
  'AionUi (aionui.com)',
  'aionui.com',
  '__aionui_',
  'AIONUI_',
  'aionui:',
  'aioncore',
  'AionCore',
  'Aion CLI',
];
const placeholder = (p) => `\u0000${Buffer.from(p).toString('base64')}\u0000`;
const files = [];
const walk = (dir) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(ts|tsx|json|html|css)$/.test(e.name)) files.push(p);
  }
};
walk(join(ROOT, 'src'));
for (const abs of files) {
  rewrite(abs, (s) => {
    let out = s;
    for (const p of PROTECTED) out = out.split(p).join(placeholder(p));
    out = out
      .replace(/AionUi Rust/g, 'Aibaton')
      .replace(/AionUi-Rust-Dev/g, 'Aibaton-Dev')
      .replace(/AionUI/g, 'Aibaton')
      .replace(/AionUi/g, 'Aibaton');
    for (const p of PROTECTED) out = out.split(placeholder(p)).join(p);
    return out;
  });
}

// 5. About page: replace the upstream App Info section with AibatonAbout.
rewrite(
  join(ROOT, 'src/renderer/components/settings/SettingsModal/contents/AboutModalContent.tsx'),
  (s) => {
    let out = s;
    if (!out.includes('AibatonAbout')) {
      out = out.replace(
        "import FeedbackReportModal from './FeedbackReportModal';",
        "import FeedbackReportModal from './FeedbackReportModal';\nimport AibatonAbout from './AibatonAbout';"
      );
      // Replace App Info + Divider + Links sections with one component.
      // Anchor on the LinkSection's closing brace followed by the two
      // container divs, so the outer structure stays balanced.
      out = out.replace(
        /\{\/\* App Info Section \*\/[\s\S]*?\{\/\* Links Section \*\/[\s\S]*?\n          <\/div>\n        <\/div>/,
        '<AibatonAbout />\n        </div>'
      );
    }
    return out;
  },
  'About page -> AibatonAbout'
);

// 6. Sidebar header: remove outer title bar, use compact Aibaton header.
rewrite(
  join(ROOT, 'src/renderer/components/layout/Layout.tsx'),
  (s) => {
    let out = s;
    if (!out.includes('SidebarHeader')) {
      out = out.replace(
        "import Titlebar from '@/renderer/components/layout/Titlebar';",
        "import SidebarHeader from '@/renderer/components/layout/SidebarHeader';"
      );
      out = out.replace(/\s*<Titlebar workspaceAvailable=\{workspaceAvailable\} \/>/, '');
      out = out.replace(
        /<ArcoLayout\.Header[\s\S]*?<\/ArcoLayout\.Header>/,
        [
          '<SidebarHeader',
          '            collapsed={collapsed}',
          '            onBrandClick={handleBrandHome}',
          "            backLabel={t('common.back', { defaultValue: 'Back to Chat' })}",
          '            showBack={isSettingsRoute}',
          '          />',
        ].join('\n')
      );
    }
    return out;
  },
  'outer titlebar removed + Aibaton sidebar header'
);

// 7. Built-in Aion CLI agent logo -> Aibaton brand mark.
//      Two paths exist: the SWR logo map (agentLogo.ts) and the direct
//      assistant avatar resolver (assistantAvatar.ts), which preset pills use.
rewrite(
  join(ROOT, 'src/renderer/utils/model/agentLogo.ts'),
  (s) => {
    if (s.includes('aibatonLogo')) return s;
    let out = s.replace(
      "import { resolveBackendAssetUrl } from '@/renderer/utils/platform';",
      "import { resolveBackendAssetUrl } from '@/renderer/utils/platform';\nimport aibatonLogo from '@renderer/assets/logos/brand/app.png';"
    );
    out = out.replace('      const map: AgentLogoMap = {};', '      const map: AgentLogoMap = { aionrs: aibatonLogo };');
    return out;
  },
  'aionrs logo map -> Aibaton'
);
rewrite(
  join(ROOT, 'src/renderer/utils/model/assistantAvatar.ts'),
  (s) => {
    if (s.includes('aibatonLogo')) return s;
    let out = s.replace(
      "import { resolveBackendAssetUrl } from '@/renderer/utils/platform';",
      "import { resolveBackendAssetUrl } from '@/renderer/utils/platform';\nimport aibatonLogo from '@renderer/assets/logos/brand/app.png';"
    );
    out = out.replace(
      '  const resolved = resolveBackendAssetUrl(value) ?? value;',
      "  // Upstream embeds `/api/assets/logos/brand/aion.svg` for the built-in\n  // Aion CLI agent. Use the Aibaton brand mark everywhere it appears.\n  if (value.includes('/logos/brand/aion.svg')) {\n    return { kind: 'image', value: aibatonLogo };\n  }\n  const resolved = resolveBackendAssetUrl(value) ?? value;"
    );
    return out;
  },
  'assistant avatar aion.svg -> Aibaton'
);

console.log(`[rebrand] rewrote ${changed} files`);
for (const p of patched) console.log(`  + ${p}`);
