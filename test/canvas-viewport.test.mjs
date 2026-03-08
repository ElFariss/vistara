import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveCanvasViewportTarget } from '../public/canvasViewport.js';

test('resolveCanvasViewportTarget centers compact content bounds', () => {
  const result = resolveCanvasViewportTarget({
    stageRect: { left: 220, top: 220, width: 1280, height: 720 },
    viewportRect: { width: 780, height: 520 },
    focusRect: { left: 320, top: 260, width: 420, height: 260 },
  });

  assert.equal(result.scrollLeft, 140);
  assert.equal(result.scrollTop, 130);
});

test('resolveCanvasViewportTarget left-biases oversized content so mobile opens on usable widgets', () => {
  const result = resolveCanvasViewportTarget({
    stageRect: { left: 220, top: 220, width: 1080, height: 608 },
    viewportRect: { width: 390, height: 700 },
    focusRect: { left: 262, top: 248, width: 760, height: 330 },
  });

  assert.equal(result.scrollLeft, 238);
  assert.equal(result.scrollTop, 63);
});
