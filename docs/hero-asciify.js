const HERO_SELECTOR = '[data-asciify-hero]';
const CANVAS_SELECTOR = '[data-asciify-output]';
const CELL_SIZE = 10;
const CAPTURE_INTERVAL = 125;
const FRAME_INTERVAL = 1000 / 30;
const LENS_RADIUS = 0.31;
const LENS_SOFTNESS = 0.72;
const FOLLOW_SPEED = 7;
const GLYPHS = ' .,:;irsXA253hMHGS#9B&@';

const finePointerQuery = window.matchMedia('(hover: hover) and (pointer: fine)');
const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

let stopEffect = null;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function smoothstep(min, max, value) {
  const amount = clamp((value - min) / Math.max(max - min, 0.0001), 0, 1);
  return amount * amount * (3 - 2 * amount);
}

function isTransparent(color) {
  return color === 'transparent' || /\/\s*0(?:\.0+)?\s*\)$/.test(color);
}

function overlapsRoot(rect, rootRect) {
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    rect.right > rootRect.left &&
    rect.left < rootRect.right &&
    rect.bottom > rootRect.top &&
    rect.top < rootRect.bottom
  );
}

function resolveObjectPosition(position) {
  const [x = '50%', y = '50%'] = position.split(/\s+/);
  return [resolvePositionValue(x, 'left', 'right'), resolvePositionValue(y, 'top', 'bottom')];
}

function resolvePositionValue(value, start, end) {
  if (value === start) return 0;
  if (value === end) return 1;
  if (value === 'center') return 0.5;
  if (value.endsWith('%')) return clamp(Number.parseFloat(value) / 100, 0, 1);
  return 0.5;
}

function isSafeMediaSource(element) {
  const source = element.currentSrc || element.src;
  if (!source) return false;

  try {
    const url = new URL(source, window.location.href);
    return url.origin === window.location.origin || url.protocol === 'data:' || url.protocol === 'blob:';
  } catch {
    return false;
  }
}

function paintMedia(context, element, style, rect, rootRect) {
  const drawable =
    element instanceof HTMLImageElement && element.complete && element.naturalWidth > 0
      ? element
      : element instanceof HTMLVideoElement && element.readyState >= 2
        ? element
        : null;

  if (!drawable || !isSafeMediaSource(drawable)) return;

  const sourceWidth =
    drawable instanceof HTMLImageElement ? drawable.naturalWidth : drawable.videoWidth;
  const sourceHeight =
    drawable instanceof HTMLImageElement ? drawable.naturalHeight : drawable.videoHeight;
  if (!(sourceWidth > 0 && sourceHeight > 0)) return;

  let sourceX = 0;
  let sourceY = 0;
  let cropWidth = sourceWidth;
  let cropHeight = sourceHeight;
  let targetX = rect.left - rootRect.left;
  let targetY = rect.top - rootRect.top;
  let targetWidth = rect.width;
  let targetHeight = rect.height;
  const [positionX, positionY] = resolveObjectPosition(style.objectPosition);

  if (style.objectFit === 'cover') {
    const scale = Math.max(rect.width / sourceWidth, rect.height / sourceHeight);
    cropWidth = rect.width / scale;
    cropHeight = rect.height / scale;
    sourceX = (sourceWidth - cropWidth) * positionX;
    sourceY = (sourceHeight - cropHeight) * positionY;
  } else if (style.objectFit === 'contain' || style.objectFit === 'scale-down') {
    const containScale = Math.min(
      rect.width / sourceWidth,
      rect.height / sourceHeight,
      style.objectFit === 'scale-down' ? 1 : Number.POSITIVE_INFINITY,
    );
    targetWidth = sourceWidth * containScale;
    targetHeight = sourceHeight * containScale;
    targetX += (rect.width - targetWidth) * positionX;
    targetY += (rect.height - targetHeight) * positionY;
  }

  context.save();
  context.filter = style.filter === 'none' ? 'none' : style.filter;
  try {
    context.drawImage(
      drawable,
      sourceX,
      sourceY,
      cropWidth,
      cropHeight,
      targetX,
      targetY,
      targetWidth,
      targetHeight,
    );
  } catch {
    // The live DOM remains the fallback when a media frame cannot be sampled.
  }
  context.restore();
}

function paintText(context, element, style, rootRect) {
  const textNodes = Array.from(element.childNodes).filter(
    (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
  );
  if (textNodes.length === 0) return;

  context.fillStyle = style.color;
  context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  context.textBaseline = 'alphabetic';
  context.textAlign = style.textAlign === 'center' || style.textAlign === 'right' ? style.textAlign : 'left';
  context.direction = style.direction === 'rtl' ? 'rtl' : 'ltr';
  if ('letterSpacing' in context) {
    context.letterSpacing = style.letterSpacing === 'normal' ? '0px' : style.letterSpacing;
  }

  const transformText = (text) => {
    if (style.textTransform === 'uppercase') return text.toUpperCase();
    if (style.textTransform === 'lowercase') return text.toLowerCase();
    return text;
  };

  for (const node of textNodes) {
    const text = transformText((node.textContent || '').replace(/\s+/g, ' ').trim());
    if (!text) continue;

    const range = document.createRange();
    range.selectNodeContents(node);
    const rects = Array.from(range.getClientRects()).filter((rect) => overlapsRoot(rect, rootRect));
    if (rects.length === 0) continue;

    const totalWidth = rects.reduce((sum, rect) => sum + rect.width, 0);
    let offset = 0;

    for (let index = 0; index < rects.length; index += 1) {
      const rect = rects[index];
      const remaining = text.length - offset;
      if (remaining <= 0) break;
      const count =
        index === rects.length - 1
          ? remaining
          : Math.min(remaining, Math.max(1, Math.round((text.length * rect.width) / totalWidth)));
      const line = text.slice(offset, offset + count).trim();
      offset += count;
      if (!line) continue;

      const metrics = context.measureText(line);
      const ascent = metrics.fontBoundingBoxAscent || rect.height * 0.8;
      const descent = metrics.fontBoundingBoxDescent || rect.height * 0.2;
      const x =
        context.textAlign === 'center'
          ? rect.left - rootRect.left + rect.width / 2
          : context.textAlign === 'right'
            ? rect.right - rootRect.left
            : rect.left - rootRect.left;
      const y = rect.top - rootRect.top + (rect.height - ascent - descent) / 2 + ascent;
      context.fillText(line, x, y, Math.max(rect.width, 1));
    }
  }
}

function paintBorders(context, style, rect, rootRect) {
  const x = rect.left - rootRect.left;
  const y = rect.top - rootRect.top;
  const sides = [
    ['top', Number.parseFloat(style.borderTopWidth), style.borderTopColor],
    ['right', Number.parseFloat(style.borderRightWidth), style.borderRightColor],
    ['bottom', Number.parseFloat(style.borderBottomWidth), style.borderBottomColor],
    ['left', Number.parseFloat(style.borderLeftWidth), style.borderLeftColor],
  ];

  for (const [side, width, color] of sides) {
    if (!(width > 0) || isTransparent(color)) continue;
    context.fillStyle = color;
    if (side === 'top') context.fillRect(x, y, rect.width, width);
    if (side === 'right') context.fillRect(x + rect.width - width, y, width, rect.height);
    if (side === 'bottom') context.fillRect(x, y + rect.height - width, rect.width, width);
    if (side === 'left') context.fillRect(x, y, width, rect.height);
  }
}

function createHeroSnapshot(hero, output) {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { alpha: true });
  let width = 0;
  let height = 0;

  function capture() {
    const rootRect = hero.getBoundingClientRect();
    const captureScale = Math.min(window.devicePixelRatio || 1, 1.25);
    const nextWidth = Math.max(1, Math.round(rootRect.width * captureScale));
    const nextHeight = Math.max(1, Math.round(rootRect.height * captureScale));

    if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
      canvas.width = nextWidth;
      canvas.height = nextHeight;
    }

    width = rootRect.width;
    height = rootRect.height;
    context.setTransform(captureScale, 0, 0, captureScale, 0, 0);
    context.clearRect(0, 0, width, height);
    context.save();
    context.beginPath();
    context.rect(0, 0, width, height);
    context.clip();

    const elements = [hero, ...hero.querySelectorAll('*')];
    for (const element of elements) {
      if (!(element instanceof HTMLElement) || element === output || output.contains(element)) continue;

      const style = getComputedStyle(element);
      const opacity = Number.parseFloat(style.opacity);
      const rect = element.getBoundingClientRect();
      if (
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        opacity <= 0 ||
        !overlapsRoot(rect, rootRect)
      ) {
        continue;
      }

      context.save();
      context.globalAlpha = Number.isFinite(opacity) ? opacity : 1;
      const x = rect.left - rootRect.left;
      const y = rect.top - rootRect.top;

      if (!isTransparent(style.backgroundColor)) {
        context.fillStyle = style.backgroundColor;
        context.fillRect(x, y, rect.width, rect.height);
      }

      paintMedia(context, element, style, rect, rootRect);
      paintText(context, element, style, rootRect);
      paintBorders(context, style, rect, rootRect);
      context.restore();
    }

    context.restore();
  }

  return {
    canvas,
    capture,
    get width() {
      return width;
    },
    get height() {
      return height;
    },
  };
}

function glyphColor(red, green, blue, luminance, alpha) {
  const chroma = Math.max(red, green, blue) - Math.min(red, green, blue);
  if (chroma > 38) {
    const lift = 20 + luminance * 0.08;
    return `rgb(${clamp(red + lift, 0, 255)} ${clamp(green + lift, 0, 255)} ${clamp(blue + lift, 0, 255)} / ${alpha})`;
  }

  const neutral = clamp(168 + luminance * 0.34, 168, 244);
  return `rgb(${neutral} ${neutral} ${neutral} / ${alpha})`;
}

function initHeroAsciify() {
  const hero = document.querySelector(HERO_SELECTOR);
  const output = hero?.querySelector(CANVAS_SELECTOR);
  if (!(hero instanceof HTMLElement) || !(output instanceof HTMLCanvasElement)) return () => {};

  const context = output.getContext('2d', { alpha: true, desynchronized: true });
  if (!context) return () => {};

  const snapshot = createHeroSnapshot(hero, output);
  const pixelCanvas = document.createElement('canvas');
  const pixelContext = pixelCanvas.getContext('2d', { willReadFrequently: true });
  if (!pixelContext) return () => {};

  const pointer = { x: 0, y: 0, targetX: 0, targetY: 0, active: 0, targetActive: 0 };
  let animationFrame = 0;
  let running = false;
  let intersecting = true;
  let focused = false;
  let pixelData = null;
  let columns = 0;
  let rows = 0;
  let lastTime = performance.now();
  let lastFrame = 0;
  let lastCapture = 0;

  function resize() {
    const rect = output.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (output.width !== width || output.height !== height) {
      output.width = width;
      output.height = height;
    }
    snapshot.capture();
    updatePixels();
    wake();
  }

  function updatePixels() {
    columns = Math.max(1, Math.ceil(snapshot.width / CELL_SIZE));
    rows = Math.max(1, Math.ceil(snapshot.height / CELL_SIZE));
    if (pixelCanvas.width !== columns || pixelCanvas.height !== rows) {
      pixelCanvas.width = columns;
      pixelCanvas.height = rows;
    }
    pixelContext.clearRect(0, 0, columns, rows);
    pixelContext.drawImage(snapshot.canvas, 0, 0, columns, rows);
    try {
      pixelData = pixelContext.getImageData(0, 0, columns, rows).data;
    } catch {
      pixelData = null;
    }
  }

  function updatePointer(event) {
    const rect = output.getBoundingClientRect();
    pointer.targetX = clamp(event.clientX - rect.left, 0, rect.width);
    pointer.targetY = clamp(event.clientY - rect.top, 0, rect.height);
    pointer.targetActive = focused ? 0 : 1;
    wake();
  }

  function render() {
    const rect = output.getBoundingClientRect();
    const dpr = output.width / Math.max(rect.width, 1);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, rect.width, rect.height);
    if (!pixelData || pointer.active < 0.003) return;

    const radius = rect.height * LENS_RADIUS * pointer.active;
    const innerRadius = radius * (1 - LENS_SOFTNESS);
    if (radius < 1) return;

    const backing = context.createRadialGradient(
      pointer.x,
      pointer.y,
      innerRadius,
      pointer.x,
      pointer.y,
      radius,
    );
    backing.addColorStop(0, `rgb(0 0 0 / ${0.34 * pointer.active})`);
    backing.addColorStop(0.62, `rgb(0 0 0 / ${0.18 * pointer.active})`);
    backing.addColorStop(1, 'rgb(0 0 0 / 0)');
    context.fillStyle = backing;
    context.beginPath();
    context.arc(pointer.x, pointer.y, radius, 0, Math.PI * 2);
    context.fill();

    const minColumn = clamp(Math.floor((pointer.x - radius) / CELL_SIZE), 0, columns - 1);
    const maxColumn = clamp(Math.ceil((pointer.x + radius) / CELL_SIZE), 0, columns - 1);
    const minRow = clamp(Math.floor((pointer.y - radius) / CELL_SIZE), 0, rows - 1);
    const maxRow = clamp(Math.ceil((pointer.y + radius) / CELL_SIZE), 0, rows - 1);

    context.font = `${CELL_SIZE}px "Geist Mono", ui-monospace, monospace`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';

    for (let row = minRow; row <= maxRow; row += 1) {
      for (let column = minColumn; column <= maxColumn; column += 1) {
        const x = (column + 0.5) * CELL_SIZE;
        const y = (row + 0.5) * CELL_SIZE;
        const distance = Math.hypot(x - pointer.x, y - pointer.y);
        if (distance >= radius) continue;

        const feather = (1 - smoothstep(innerRadius, radius, distance)) * pointer.active;
        if (feather < 0.035) continue;

        const index = (row * columns + column) * 4;
        const red = pixelData[index];
        const green = pixelData[index + 1];
        const blue = pixelData[index + 2];
        const sourceAlpha = pixelData[index + 3] / 255;
        const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
        const density = clamp((luminance / 255 - 0.035) * 1.26, 0, 1);
        const glyph = GLYPHS[Math.min(GLYPHS.length - 1, Math.floor(density * GLYPHS.length))];
        if (glyph === ' ' || sourceAlpha < 0.05) continue;

        const alpha = clamp(feather * sourceAlpha * 0.96, 0, 1);
        context.fillStyle = glyphColor(red, green, blue, luminance, alpha);
        context.fillText(glyph, x, y);
      }
    }
  }

  function frame(now) {
    if (!running) return;
    if (!intersecting || document.visibilityState === 'hidden') {
      running = false;
      return;
    }

    const delta = Math.min((now - lastTime) / 1000, 1 / 20);
    lastTime = now;
    const ease = 1 - Math.exp(-delta * FOLLOW_SPEED);
    pointer.x += (pointer.targetX - pointer.x) * ease;
    pointer.y += (pointer.targetY - pointer.y) * ease;
    pointer.active += (pointer.targetActive - pointer.active) * ease;

    if (pointer.active > 0.02 && now - lastCapture >= CAPTURE_INTERVAL) {
      snapshot.capture();
      updatePixels();
      lastCapture = now;
    }

    if (now - lastFrame >= FRAME_INTERVAL) {
      render();
      lastFrame = now;
    }

    const settled =
      Math.abs(pointer.targetX - pointer.x) < 0.2 &&
      Math.abs(pointer.targetY - pointer.y) < 0.2 &&
      Math.abs(pointer.targetActive - pointer.active) < 0.003;
    const keepAlive = pointer.targetActive > 0 || pointer.active > 0.003;

    if (!keepAlive && settled) {
      pointer.active = 0;
      render();
      running = false;
      return;
    }

    animationFrame = requestAnimationFrame(frame);
  }

  function wake() {
    if (running || !intersecting || document.visibilityState === 'hidden') return;
    running = true;
    lastTime = performance.now();
    animationFrame = requestAnimationFrame(frame);
  }

  function onPointerLeave() {
    pointer.targetActive = 0;
    wake();
  }

  function onFocusIn() {
    focused = true;
    pointer.targetActive = 0;
    wake();
  }

  function onFocusOut() {
    focused = false;
  }

  function onVisibilityChange() {
    if (document.visibilityState === 'hidden') {
      cancelAnimationFrame(animationFrame);
      running = false;
    } else {
      snapshot.capture();
      updatePixels();
      wake();
    }
  }

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(hero);

  const intersectionObserver = new IntersectionObserver((entries) => {
    intersecting = entries.at(-1)?.isIntersecting ?? true;
    if (intersecting) wake();
  });
  intersectionObserver.observe(hero);

  hero.addEventListener('pointermove', updatePointer, { passive: true });
  hero.addEventListener('pointerleave', onPointerLeave, { passive: true });
  hero.addEventListener('focusin', onFocusIn);
  hero.addEventListener('focusout', onFocusOut);
  document.addEventListener('visibilitychange', onVisibilityChange);
  document.fonts?.ready.then(() => {
    snapshot.capture();
    updatePixels();
    wake();
  });

  for (const media of hero.querySelectorAll('img, video')) {
    media.addEventListener('load', resize, { once: true });
    media.addEventListener('loadeddata', resize, { once: true });
  }

  resize();

  return () => {
    cancelAnimationFrame(animationFrame);
    running = false;
    resizeObserver.disconnect();
    intersectionObserver.disconnect();
    hero.removeEventListener('pointermove', updatePointer);
    hero.removeEventListener('pointerleave', onPointerLeave);
    hero.removeEventListener('focusin', onFocusIn);
    hero.removeEventListener('focusout', onFocusOut);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, output.width, output.height);
  };
}

function syncEffect() {
  const shouldRun = finePointerQuery.matches && !reducedMotionQuery.matches;
  if (shouldRun && !stopEffect) stopEffect = initHeroAsciify();
  if (!shouldRun && stopEffect) {
    stopEffect();
    stopEffect = null;
  }
}

finePointerQuery.addEventListener('change', syncEffect);
reducedMotionQuery.addEventListener('change', syncEffect);
syncEffect();
