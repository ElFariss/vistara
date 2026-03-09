import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const indexHtml = fs.readFileSync(
  path.join(process.cwd(), 'public', 'index.html'),
  'utf8',
);

test('spa shell exposes route-level headings for landing, auth, context, and workspace surfaces', () => {
  assert.match(indexHtml, /<h1 class="landing-welcome-title">Ngobrol dengan data bisnis tanpa ribet teknis\.<\/h1>/);
  assert.match(indexHtml, /<h1>Masuk ke Workspace<\/h1>/);
  assert.match(indexHtml, /<h1>Lengkapi Konteks Bisnis<\/h1>/);
  assert.match(indexHtml, /id="workspaceTitle" class="sr-only">Workspace analitik Vistara<\/h1>/);
  assert.match(indexHtml, /id="canvasTitle" class="sr-only">Dashboard canvas<\/h1>/);
});

test('upload affordances use semantic buttons and password fields include visibility toggles', () => {
  assert.match(indexHtml, /<button id="gateUploadPickerBtn" type="button" class="ghost attach-btn gate-upload-btn">Pilih Dataset<\/button>/);
  assert.match(indexHtml, /<button id="chatFileBtn" class="ghost attach-btn attach-btn-compact" type="button"/);
  assert.match(indexHtml, /<button id="loginPasswordToggle" class="ghost password-toggle" type="button"/);
  assert.match(indexHtml, /<button id="registerPasswordToggle" class="ghost password-toggle" type="button"/);
});

test('settings copy uses user-facing assistant language and softer reset wording', () => {
  assert.match(indexHtml, />Profil<\/button>/);
  assert.match(indexHtml, />Asisten<\/button>/);
  assert.match(indexHtml, /Kembalikan Saran Awal/);
  assert.doesNotMatch(indexHtml, />Agent<\/button>/);
  assert.doesNotMatch(indexHtml, /Reset Default/);
});
