// Comprobaciones estáticas sin dependencias: sintaxis JS (inline y sw.js) y manifest válido.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];

function inlineScripts(html) {
  return [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
}

const html = readFileSync(join(root, 'index.html'), 'utf8');
inlineScripts(html).forEach((code, i) => {
  try { new vm.Script(code, { filename: `index.html<script#${i}>` }); }
  catch (e) { errors.push(`index.html script ${i}: ${e.message}`); }
});

function jsFiles(dir) {
  return readdirSync(dir).flatMap(name => {
    if (name === 'node_modules' || name.startsWith('.')) return [];
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return jsFiles(p);
    return /\.m?js$/.test(name) ? [p] : [];
  });
}
for (const f of jsFiles(root)) {
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  if (r.status !== 0) errors.push(`${f}: ${r.stderr.trim()}`);
}

try {
  const m = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
  for (const k of ['name', 'start_url', 'display', 'icons']) {
    if (!(k in m)) errors.push(`manifest.json: falta "${k}"`);
  }
} catch (e) { errors.push(`manifest.json: ${e.message}`); }

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log('check: ok');
