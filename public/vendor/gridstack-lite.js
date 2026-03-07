function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function ensureLayout(layout = {}) {
  return {
    x: Number.isFinite(layout.x) ? layout.x : 0,
    y: Number.isFinite(layout.y) ? layout.y : 0,
    w: Number.isFinite(layout.w) ? layout.w : 4,
    h: Number.isFinite(layout.h) ? layout.h : 4,
    minW: Number.isFinite(layout.minW) ? layout.minW : 2,
    minH: Number.isFinite(layout.minH) ? layout.minH : 3,
  };
}

function normalizeMaxRows(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function clampLayoutBySettings(layout, settings) {
  layout.w = clamp(layout.w, layout.minW, settings.cols);
  layout.x = clamp(layout.x, 0, settings.cols - layout.w);
  const maxRows = normalizeMaxRows(settings.maxRows);
  if (maxRows) {
    layout.h = clamp(layout.h, layout.minH, maxRows);
    layout.y = clamp(layout.y, 0, Math.max(0, maxRows - layout.h));
  } else {
    layout.h = clamp(layout.h, layout.minH, 200);
    layout.y = clamp(layout.y, 0, 240);
  }
  return layout;
}

function createGridStackLibrary(container, options = {}) {
  const settings = {
    cols: options.cols || 12,
    gap: options.gap || 12,
    rowHeight: options.rowHeight || 44,
    maxRows: normalizeMaxRows(options.maxRows),
    onChange: typeof options.onChange === 'function' ? options.onChange : () => {},
  };

  container.classList.add('grid-stack');
  container.innerHTML = '';

  const gridOptions = {
    column: settings.cols,
    margin: settings.gap,
    cellHeight: settings.rowHeight,
    float: true,
    handle: '.widget-drag-handle',
    resizable: { handles: 'se' },
  };
  if (settings.maxRows) {
    gridOptions.maxRow = settings.maxRows;
  }

  const grid = window.GridStack.init(gridOptions, container);

  const items = new Map();
  let editingEnabled = false;

  function emitChange() {
    settings.onChange(
      Array.from(items.values()).map((item) => ({
        id: item.id,
        layout: { ...item.layout },
        data: item.data,
      })),
    );
  }

  grid.on('change', (_event, changedItems) => {
    for (const changed of changedItems || []) {
      const id = changed.el?.getAttribute('gs-id');
      if (!id || !items.has(id)) {
        continue;
      }

      const current = items.get(id);
      current.layout = {
        ...current.layout,
        x: Number(changed.x ?? current.layout.x),
        y: Number(changed.y ?? current.layout.y),
        w: Number(changed.w ?? current.layout.w),
        h: Number(changed.h ?? current.layout.h),
      };
      clampLayoutBySettings(current.layout, settings);
      items.set(id, current);
    }

    emitChange();
  });

  function setItems(nextItems, renderItem) {
    const nextById = new Map(nextItems.map((entry) => [entry.id, entry]));
    const sameLayout = (a, b) => (
      Number(a?.x) === Number(b?.x)
      && Number(a?.y) === Number(b?.y)
      && Number(a?.w) === Number(b?.w)
      && Number(a?.h) === Number(b?.h)
      && Number(a?.minW) === Number(b?.minW)
      && Number(a?.minH) === Number(b?.minH)
    );

    for (const id of [...items.keys()]) {
      if (nextById.has(id)) {
        continue;
      }
      const stale = container.querySelector(`[gs-id="${CSS.escape(id)}"]`);
      if (stale) {
        grid.removeWidget(stale, false);
      }
      items.delete(id);
    }

    for (const raw of nextItems) {
      const layout = ensureLayout(raw.layout);
      clampLayoutBySettings(layout, settings);
      const prepared = {
        id: raw.id,
        layout,
        data: raw,
      };

      const existingElement = container.querySelector(`[gs-id="${CSS.escape(prepared.id)}"]`);
      const existingItem = items.get(prepared.id);
      if (existingElement && existingItem) {
        existingElement.setAttribute('gs-x', String(layout.x));
        existingElement.setAttribute('gs-y', String(layout.y));
        existingElement.setAttribute('gs-w', String(layout.w));
        existingElement.setAttribute('gs-h', String(layout.h));
        existingElement.setAttribute('gs-min-w', String(layout.minW));
        existingElement.setAttribute('gs-min-h', String(layout.minH));

        const content = existingElement.querySelector('.grid-stack-item-content');
        if (content) {
          content.innerHTML = '';
          content.append(renderItem(prepared));
        }

        if (!sameLayout(existingItem.layout, layout)) {
          grid.update(existingElement, {
            x: layout.x,
            y: layout.y,
            w: layout.w,
            h: layout.h,
          });
        }

        items.set(prepared.id, prepared);
        continue;
      }

      const item = document.createElement('div');
      item.className = 'grid-stack-item';
      item.setAttribute('gs-id', prepared.id);
      item.setAttribute('gs-x', String(layout.x));
      item.setAttribute('gs-y', String(layout.y));
      item.setAttribute('gs-w', String(layout.w));
      item.setAttribute('gs-h', String(layout.h));
      item.setAttribute('gs-min-w', String(layout.minW));
      item.setAttribute('gs-min-h', String(layout.minH));

      const content = document.createElement('div');
      content.className = 'grid-stack-item-content grid-widget';
      content.append(renderItem(prepared));
      item.append(content);

      container.append(item);
      grid.makeWidget(item);
      if (typeof grid.movable === 'function') {
        grid.movable(item, editingEnabled);
      }
      if (typeof grid.resizable === 'function') {
        grid.resizable(item, editingEnabled);
      }
      items.set(prepared.id, prepared);
    }
  }

  function updateItemLayout(id, patch = {}) {
    const current = items.get(id);
    if (!current) {
      return;
    }

    current.layout = {
      ...current.layout,
      ...patch,
    };

    clampLayoutBySettings(current.layout, settings);

    const element = container.querySelector(`[gs-id="${CSS.escape(id)}"]`);
    if (element) {
      grid.update(element, {
        x: current.layout.x,
        y: current.layout.y,
        w: current.layout.w,
        h: current.layout.h,
      });
    }

    items.set(id, current);
    emitChange();
  }

  function removeItem(id) {
    const element = container.querySelector(`[gs-id="${CSS.escape(id)}"]`);
    if (element) {
      grid.removeWidget(element, false);
    }
    items.delete(id);
    emitChange();
  }

  function getItems() {
    return Array.from(items.values()).map((item) => ({
      id: item.id,
      layout: { ...item.layout },
      data: item.data,
    }));
  }

  function refresh() {
    grid.cellHeight(settings.rowHeight);
    if (typeof grid.column === 'function') {
      grid.column(settings.cols);
    }
    if (typeof grid.margin === 'function') {
      grid.margin(settings.gap);
    }
    if (grid?.engine) {
      grid.engine.maxRow = settings.maxRows || 0;
    }
    if (grid?.opts) {
      grid.opts.maxRow = settings.maxRows || 0;
    }
    for (const [id, item] of items.entries()) {
      clampLayoutBySettings(item.layout, settings);
      const element = container.querySelector(`[gs-id="${CSS.escape(id)}"]`);
      if (element) {
        grid.update(element, {
          x: item.layout.x,
          y: item.layout.y,
          w: item.layout.w,
          h: item.layout.h,
        });
      }
    }
  }

  function setBounds(bounds = {}) {
    if (Number.isFinite(bounds.cols) && bounds.cols > 0) {
      settings.cols = Number(bounds.cols);
    }
    if (Number.isFinite(bounds.gap) && bounds.gap >= 0) {
      settings.gap = Number(bounds.gap);
    }
    if (Number.isFinite(bounds.rowHeight) && bounds.rowHeight > 0) {
      settings.rowHeight = Number(bounds.rowHeight);
    }
    if ('maxRows' in bounds) {
      settings.maxRows = normalizeMaxRows(bounds.maxRows);
    }
    refresh();
  }

  function setEditing(editing) {
    editingEnabled = Boolean(editing);
    if (typeof grid.enableMove === 'function') {
      grid.enableMove(editingEnabled);
    }
    if (typeof grid.enableResize === 'function') {
      grid.enableResize(editingEnabled);
    }
    if (typeof grid.setStatic === 'function') {
      grid.setStatic(!editingEnabled);
    }
    if (typeof grid.movable === 'function' || typeof grid.resizable === 'function') {
      for (const [id] of items.entries()) {
        const element = container.querySelector(`[gs-id="${CSS.escape(id)}"]`);
        if (!element) continue;
        if (typeof grid.movable === 'function') {
          grid.movable(element, editingEnabled);
        }
        if (typeof grid.resizable === 'function') {
          grid.resizable(element, editingEnabled);
        }
      }
    }
    container.classList.toggle('editing', editingEnabled);
  }

  function destroy() {
    if (typeof grid.destroy === 'function') {
      grid.destroy(false);
    }
  }

  return {
    setItems,
    updateItemLayout,
    removeItem,
    getItems,
    refresh,
    setBounds,
    setEditing,
    destroy,
  };
}

function createFallbackGrid(container, options = {}) {
  const settings = {
    cols: options.cols || 12,
    gap: options.gap || 12,
    rowHeight: options.rowHeight || 44,
    maxRows: normalizeMaxRows(options.maxRows),
    onChange: typeof options.onChange === 'function' ? options.onChange : () => {},
  };

  const items = new Map();
  const wrappers = new Map();
  let editingEnabled = false;

  container.classList.add('gridstack-lite');
  container.style.position = 'relative';

  function gridSize() {
    const width = Math.max(container.clientWidth, 300);
    const colWidth = (width - settings.gap * (settings.cols - 1)) / settings.cols;
    return {
      width,
      colWidth,
      rowUnit: settings.rowHeight + settings.gap,
      colUnit: colWidth + settings.gap,
    };
  }

  function syncContainerHeight() {
    let maxBottom = 0;
    for (const item of items.values()) {
      const bottom = item.layout.y + item.layout.h;
      if (bottom > maxBottom) {
        maxBottom = bottom;
      }
    }

    const size = gridSize();
    const forcedRows = normalizeMaxRows(settings.maxRows);
    const rows = forcedRows || Math.max(6, maxBottom);
    container.style.height = `${Math.max(360, rows * size.rowUnit)}px`;
  }

  function applyPosition(id) {
    const item = items.get(id);
    const wrapper = wrappers.get(id);

    if (!item || !wrapper) {
      return;
    }

    const size = gridSize();
    const { x, y, w, h } = item.layout;

    const left = x * size.colUnit;
    const top = y * size.rowUnit;
    const width = w * size.colWidth + (w - 1) * settings.gap;
    const height = h * settings.rowHeight + (h - 1) * settings.gap;

    wrapper.style.left = `${left}px`;
    wrapper.style.top = `${top}px`;
    wrapper.style.width = `${Math.max(width, 80)}px`;
    wrapper.style.height = `${Math.max(height, 80)}px`;
  }

  function applyAll() {
    for (const id of items.keys()) {
      applyPosition(id);
    }
    syncContainerHeight();
  }

  function emitChange() {
    settings.onChange(
      Array.from(items.values()).map((item) => ({
        id: item.id,
        layout: { ...item.layout },
        data: item.data,
      })),
    );
  }

  function attachInteractions(id, wrapper) {
    const dragHandle = wrapper.querySelector('.widget-drag-handle');
    const resizeHandle = wrapper.querySelector('.widget-resize-handle');

    if (dragHandle) {
      dragHandle.addEventListener('pointerdown', (event) => {
        if (!editingEnabled) {
          return;
        }
        event.preventDefault();
        wrapper.setPointerCapture(event.pointerId);

        const item = items.get(id);
        if (!item) {
          return;
        }

        const startX = event.clientX;
        const startY = event.clientY;
        const start = { ...item.layout };

        function onMove(moveEvent) {
          const size = gridSize();
          const dx = moveEvent.clientX - startX;
          const dy = moveEvent.clientY - startY;

          const offsetX = Math.round(dx / size.colUnit);
          const offsetY = Math.round(dy / size.rowUnit);

          item.layout.x = clamp(start.x + offsetX, 0, settings.cols - item.layout.w);
          const maxRows = normalizeMaxRows(settings.maxRows);
          if (maxRows) {
            item.layout.y = clamp(start.y + offsetY, 0, Math.max(0, maxRows - item.layout.h));
          } else {
            item.layout.y = clamp(start.y + offsetY, 0, 240);
          }
          applyPosition(id);
          syncContainerHeight();
        }

        function onUp() {
          wrapper.removeEventListener('pointermove', onMove);
          wrapper.removeEventListener('pointerup', onUp);
          wrapper.removeEventListener('pointercancel', onUp);
          emitChange();
        }

        wrapper.addEventListener('pointermove', onMove);
        wrapper.addEventListener('pointerup', onUp);
        wrapper.addEventListener('pointercancel', onUp);
      });
    }

    if (resizeHandle) {
      resizeHandle.addEventListener('pointerdown', (event) => {
        if (!editingEnabled) {
          return;
        }
        event.preventDefault();
        resizeHandle.setPointerCapture(event.pointerId);

        const item = items.get(id);
        if (!item) {
          return;
        }

        const startX = event.clientX;
        const startY = event.clientY;
        const start = { ...item.layout };

        function onMove(moveEvent) {
          const size = gridSize();
          const dx = moveEvent.clientX - startX;
          const dy = moveEvent.clientY - startY;

          const growX = Math.round(dx / size.colUnit);
          const growY = Math.round(dy / size.rowUnit);

          item.layout.w = clamp(start.w + growX, item.layout.minW, settings.cols - item.layout.x);
          const maxRows = normalizeMaxRows(settings.maxRows);
          if (maxRows) {
            item.layout.h = clamp(start.h + growY, item.layout.minH, Math.max(item.layout.minH, maxRows - item.layout.y));
          } else {
            item.layout.h = clamp(start.h + growY, item.layout.minH, 240);
          }

          applyPosition(id);
          syncContainerHeight();
        }

        function onUp() {
          resizeHandle.removeEventListener('pointermove', onMove);
          resizeHandle.removeEventListener('pointerup', onUp);
          resizeHandle.removeEventListener('pointercancel', onUp);
          emitChange();
        }

        resizeHandle.addEventListener('pointermove', onMove);
        resizeHandle.addEventListener('pointerup', onUp);
        resizeHandle.addEventListener('pointercancel', onUp);
      });
    }
  }

  function mount(item, renderItem) {
    const wrapper = document.createElement('article');
    wrapper.className = 'grid-widget';
    wrapper.dataset.widgetId = item.id;
    wrapper.style.position = 'absolute';

    wrapper.append(renderItem(item));

    container.append(wrapper);
    wrappers.set(item.id, wrapper);
    attachInteractions(item.id, wrapper);
    applyPosition(item.id);
  }

  function setItems(nextItems, renderItem) {
    const nextById = new Map(nextItems.map((entry) => [entry.id, entry]));

    for (const id of [...items.keys()]) {
      if (nextById.has(id)) {
        continue;
      }
      items.delete(id);
      const wrapper = wrappers.get(id);
      if (wrapper) {
        wrapper.remove();
      }
      wrappers.delete(id);
    }

    for (const raw of nextItems) {
      const prepared = {
        id: raw.id,
        layout: ensureLayout(raw.layout),
        data: raw,
      };

      clampLayoutBySettings(prepared.layout, settings);
      items.set(prepared.id, prepared);

      const wrapper = wrappers.get(prepared.id);
      if (wrapper) {
        wrapper.innerHTML = '';
        wrapper.append(renderItem(prepared));
        attachInteractions(prepared.id, wrapper);
        applyPosition(prepared.id);
      } else {
        mount(prepared, renderItem);
      }
    }

    applyAll();
  }

  function updateItemLayout(id, patch = {}) {
    const item = items.get(id);
    if (!item) {
      return;
    }

    item.layout = {
      ...item.layout,
      ...patch,
    };

    clampLayoutBySettings(item.layout, settings);

    applyPosition(id);
    syncContainerHeight();
    emitChange();
  }

  function removeItem(id) {
    items.delete(id);
    const wrapper = wrappers.get(id);
    if (wrapper) {
      wrapper.remove();
    }
    wrappers.delete(id);
    syncContainerHeight();
    emitChange();
  }

  function getItems() {
    return Array.from(items.values()).map((item) => ({
      id: item.id,
      layout: { ...item.layout },
      data: item.data,
    }));
  }

  function refresh() {
    applyAll();
  }

  function setBounds(bounds = {}) {
    if (Number.isFinite(bounds.cols) && bounds.cols > 0) {
      settings.cols = Number(bounds.cols);
    }
    if (Number.isFinite(bounds.gap) && bounds.gap >= 0) {
      settings.gap = Number(bounds.gap);
    }
    if (Number.isFinite(bounds.rowHeight) && bounds.rowHeight > 0) {
      settings.rowHeight = Number(bounds.rowHeight);
    }
    if ('maxRows' in bounds) {
      settings.maxRows = normalizeMaxRows(bounds.maxRows);
    }

    for (const item of items.values()) {
      clampLayoutBySettings(item.layout, settings);
    }
    applyAll();
  }

  function setEditing(editing) {
    editingEnabled = Boolean(editing);
    container.classList.toggle('editing', editingEnabled);
  }

  window.addEventListener('resize', refresh);

  function destroy() {
    window.removeEventListener('resize', refresh);
  }

  return {
    setItems,
    updateItemLayout,
    removeItem,
    getItems,
    refresh,
    setBounds,
    setEditing,
    destroy,
  };
}

export function createGridStackLite(container, options = {}) {
  if (window.GridStack && typeof window.GridStack.init === 'function') {
    return createGridStackLibrary(container, options);
  }

  return createFallbackGrid(container, options);
}
