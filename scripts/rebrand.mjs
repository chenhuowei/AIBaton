#!/usr/bin/env node
/**
 * Aibaton rebrand pass. Runs after sync-frontend.mjs has recreated src/ +
 * public/ from upstream. Idempotent.
 *
 * Rules:
 * - User-visible strings / titles / manifest / i18n: AionUi -> Aibaton.
 * - Code license headers (Apache-2.0 §4) are PRESERVED on purpose.
 * - Internal keys (`__aionui_theme`, `AIONUI_*` env, `aionui:` storage keys)
 *   are NOT renamed: they are data-format identifiers, changing them would
 *   orphan persisted settings.
 * - `aioncore` (backend binary/API) and `Aion CLI` (agent product) stay.
 */

import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let changed = 0;

function rewrite(path, fn) {
  if (!existsSync(path)) return;
  const before = readFileSync(path, 'utf8');
  const after = fn(before);
  if (after !== before) {
    writeFileSync(path, after, 'utf8');
    changed++;
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
    if (!f.endsWith('.json')) continue;
    rewrite(join(dir, f), rebrandText);
  }
}

// 2. index.html (title/meta) — keep the __aionui_theme localStorage key.
rewrite(join(ROOT, 'src/renderer/index.html'), (s) =>
  s
    .replace(/<meta name="application-name" content="AionUi" \/>/, '<meta name="application-name" content="Aibaton" />')
    .replace(/<meta name="apple-mobile-web-app-title" content="AionUi" \/>/, '<meta name="apple-mobile-web-app-title" content="Aibaton" />')
    .replace(/<title>AionUi<\/title>/, '<title>Aibaton</title>')
);

// 3. PWA manifest (kept for now as a static asset, registration removed).
rewrite(join(ROOT, 'public/manifest.webmanifest'), rebrandText);
rewrite(join(ROOT, 'public/sw.js'), (s) => s.replace(/aionui-webui-v2/, 'aibaton-webui-v1'));

// 4. Hardcoded product strings across the renderer/common layer.
//      Protect: license headers, upstream GitHub/wiki/release URLs, the
//      aionui.com domain (kept as an upstream attribution link), internal
//      identifiers (`__aionui_*`, `AIONUI_*`, `aionui:` storage keys, aioncore,
//      Aion CLI). Only user-visible product names are rebranded.
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

const PRODUCT_FILES = [];
// Walk all src files; the PROTECTED placeholders keep license headers, upstream
// URLs, internal keys and data-format constants byte-identical.
const walkSrc = (dir) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walkSrc(p);
    else if (/\.(ts|tsx|json|html|css)$/.test(e.name)) PRODUCT_FILES.push(p);
  }
};
walkSrc(join(ROOT, 'src'));

for (const abs of PRODUCT_FILES) {
  rewrite(abs, (s) => {
    let out = s;
    for (const p of PROTECTED) {
      out = out.split(p).join(`\u0000${Buffer.from(p).toString('base64')}\u0000`);
    }
    out = out.replace(/AionUi Rust/g, 'Aibaton').replace(/AionUi-Rust-Dev/g, 'Aibaton-Dev').replace(/AionUI/g, 'Aibaton').replace(/AionUi/g, 'Aibaton');
    for (const p of PROTECTED) {
      out = out.split(`\u0000${Buffer.from(p).toString('base64')}\u0000`).join(p);
    }
    return out;
  });
}

// 5. About page: product name, links, and inject DataDirRow.
rewrite(join(ROOT, 'src/renderer/components/settings/SettingsModal/contents/AboutModalContent.tsx'), (s) => {
  let out = s;
  // Product title
  out = out.replace(/(\s+)AionUi(\s*)<\/Typography\.Title>/, '$1Aibaton$2</Typography.Title>');
  // Neutralize upstream outbound links (no AionUi branding / no dead links).
  out = out.replace("url: 'https://github.com/iOfficeAI/AionUi/wiki',", "url: 'https://github.com/iOfficeAI/AionUi/wiki',"); // keep wiki (upstream docs, not branding)
  out = out.replace("url: 'https://github.com/iOfficeAI/AionUi/releases',", "url: 'https://github.com/iOfficeAI/AionUi/releases',");
  out = out.replace("url: 'https://www.aionui.com',", "url: 'https://www.aionui.com',");
  out = out.replace("openLink('https://github.com/iOfficeAI/AionUi')", "openLink('https://github.com/iOfficeAI/AionUi')");
  // Add DataDirRow import + render inside the App Info section, right after
  // the version badge block (anchor: the Github <div> that follows it).
  if (!out.includes('DataDirRow')) {
    out = out.replace(
      "import FeedbackReportModal from './FeedbackReportModal';",
      "import FeedbackReportModal from './FeedbackReportModal';\nimport DataDirRow from './DataDirRow';"
    );
    out = out.replace(
      /(<\/div>\s*\{\/\* Check Update Section \*\/)/,
      '<DataDirRow />\n            $1'
    );
  }
  return out;
});

console.log(`[rebrand] rewrote ${changed} files`);
