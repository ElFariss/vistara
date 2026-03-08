function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function resolveCanvasViewportTarget({
  stageRect,
  viewportRect,
  focusRect = null,
  edgeMargin = 24,
  startThreshold = 0.92,
} = {}) {
  const stage = stageRect || { left: 0, top: 0, width: 0, height: 0 };
  const viewport = viewportRect || { width: 0, height: 0 };
  const focus = focusRect || stage;

  const maxScrollLeft = Math.max(0, stage.left + stage.width - viewport.width);
  const maxScrollTop = Math.max(0, stage.top + stage.height - viewport.height);

  const wideFocus = focus.width > viewport.width * startThreshold;
  const tallFocus = focus.height > viewport.height * startThreshold;

  const rawLeft = wideFocus
    ? focus.left - edgeMargin
    : focus.left - Math.round((viewport.width - focus.width) / 2);

  const rawTop = tallFocus
    ? focus.top - edgeMargin
    : focus.top - Math.round((viewport.height - focus.height) / 2);

  return {
    scrollLeft: clamp(Math.round(rawLeft), 0, maxScrollLeft),
    scrollTop: clamp(Math.round(rawTop), 0, maxScrollTop),
  };
}
