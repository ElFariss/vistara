function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function resolveCanvasViewportTarget({
  stageRect,
  viewportRect,
  focusRect = null,
} = {}) {
  const stage = stageRect || { left: 0, top: 0, width: 0, height: 0 };
  const viewport = viewportRect || { width: 0, height: 0, scrollWidth: 0, scrollHeight: 0 };
  const focus = focusRect || stage;

  const worldWidth = viewport.scrollWidth || (stage.left * 2 + stage.width);
  const worldHeight = viewport.scrollHeight || (stage.top * 2 + stage.height);

  const maxScrollLeft = Math.max(0, worldWidth - viewport.width);
  const maxScrollTop = Math.max(0, worldHeight - viewport.height);

  const centeredLeft = focus.left + Math.max(0, focus.width / 2) - viewport.width / 2;
  const centeredTop = focus.top + Math.max(0, focus.height / 2) - viewport.height / 2;

  return {
    scrollLeft: clamp(Math.round(centeredLeft), 0, maxScrollLeft),
    scrollTop: clamp(Math.round(centeredTop), 0, maxScrollTop),
  };
}
