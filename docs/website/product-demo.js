export const DEMO_STATE_IDS = Object.freeze(['ok', 'warn', 'high', 'critical', 'depleted']);
export const DEMO_INTERVAL_MS = 2000;

export function nextDemoIndex(currentIndex, total = DEMO_STATE_IDS.length) {
  return (currentIndex + 1) % total;
}

export function shouldDemoAutoplay({
  imagesReady,
  inView,
  pageVisible,
  reducedMotion,
  hovered,
  focused,
  manuallyPaused
}) {
  return imagesReady && inView && pageVisible && !reducedMotion && !hovered && !focused && !manuallyPaused;
}

export function initProductDemo(root, { intervalMs = DEMO_INTERVAL_MS } = {}) {
  if (!root) return { selectState() {}, stop() {}, disconnect() {} };

  const documentRef = root.ownerDocument;
  const controls = [...root.querySelectorAll('[data-demo-state]')];
  const panels = [...root.querySelectorAll('[data-demo-panel]')];
  if (!controls.length || controls.length !== panels.length) {
    return { selectState() {}, stop() {}, disconnect() {} };
  }

  const windowRef = documentRef.defaultView;
  const mediaQuery = windowRef.matchMedia?.('(prefers-reduced-motion: reduce)');
  const flags = {
    imagesReady: false,
    inView: false,
    pageVisible: documentRef.visibilityState !== 'hidden',
    reducedMotion: mediaQuery?.matches ?? false,
    hovered: false,
    focused: false,
    manuallyPaused: false
  };
  let activeIndex = 0;
  let timerId = null;
  let disconnected = false;
  let observer = null;

  function stop() {
    if (timerId !== null) windowRef.clearTimeout(timerId);
    timerId = null;
  }

  function syncTimer() {
    stop();
    if (disconnected || !shouldDemoAutoplay(flags)) return;
    timerId = windowRef.setTimeout(() => {
      selectState(nextDemoIndex(activeIndex, controls.length));
    }, intervalMs);
  }

  function selectState(index, { manual = false } = {}) {
    if (!Number.isFinite(index)) return;

    activeIndex = ((Math.trunc(index) % controls.length) + controls.length) % controls.length;
    const stateId = controls[activeIndex].dataset.demoState;
    controls.forEach((control, controlIndex) => {
      const active = controlIndex === activeIndex;
      control.setAttribute('aria-pressed', String(active));
      control.dataset.active = String(active);
    });
    panels.forEach((panel, panelIndex) => {
      const active = panelIndex === activeIndex;
      panel.dataset.active = String(active);
      panel.setAttribute('aria-hidden', String(!active));
    });
    root.dataset.state = stateId;
    if (manual) flags.manuallyPaused = true;
    syncTimer();
  }

  function onControlClick(event) {
    selectState(controls.indexOf(event.currentTarget), { manual: true });
  }
  function onMouseEnter() {
    flags.hovered = true;
    syncTimer();
  }
  function onMouseLeave() {
    flags.hovered = false;
    syncTimer();
  }
  function onFocusIn() {
    flags.focused = true;
    syncTimer();
  }
  function onFocusOut(event) {
    flags.focused = root.contains(event.relatedTarget);
    syncTimer();
  }
  function onVisibilityChange() {
    flags.pageVisible = documentRef.visibilityState !== 'hidden';
    syncTimer();
  }
  function onMotionChange(event) {
    flags.reducedMotion = event.matches;
    syncTimer();
  }

  controls.forEach(control => control.addEventListener('click', onControlClick));
  root.addEventListener('mouseenter', onMouseEnter);
  root.addEventListener('mouseleave', onMouseLeave);
  root.addEventListener('focusin', onFocusIn);
  root.addEventListener('focusout', onFocusOut);
  documentRef.addEventListener('visibilitychange', onVisibilityChange);
  if (typeof mediaQuery?.addEventListener === 'function') {
    mediaQuery.addEventListener('change', onMotionChange);
  } else if (typeof mediaQuery?.addListener === 'function') {
    mediaQuery.addListener(onMotionChange);
  }

  if (typeof windowRef.IntersectionObserver === 'function') {
    observer = new windowRef.IntersectionObserver(entries => {
      const entry = entries.find(candidate => candidate.target === root);
      flags.inView = Boolean(entry?.isIntersecting && entry.intersectionRatio >= 0.45);
      syncTimer();
    }, { threshold: 0.45 });
    observer.observe(root);
  }

  selectState(activeIndex);
  Promise.all(panels.map(panel => {
    const image = panel.querySelector('img');
    return typeof image?.decode === 'function' ? image.decode().catch(() => undefined) : Promise.resolve();
  })).then(() => {
    if (disconnected) return;
    flags.imagesReady = true;
    syncTimer();
  });

  function disconnect() {
    disconnected = true;
    stop();
    observer?.disconnect();
    controls.forEach(control => control.removeEventListener('click', onControlClick));
    root.removeEventListener('mouseenter', onMouseEnter);
    root.removeEventListener('mouseleave', onMouseLeave);
    root.removeEventListener('focusin', onFocusIn);
    root.removeEventListener('focusout', onFocusOut);
    documentRef.removeEventListener('visibilitychange', onVisibilityChange);
    if (typeof mediaQuery?.removeEventListener === 'function') {
      mediaQuery.removeEventListener('change', onMotionChange);
    } else if (typeof mediaQuery?.removeListener === 'function') {
      mediaQuery.removeListener(onMotionChange);
    }
  }

  return { selectState, stop, disconnect };
}

export function initMobileMenu(menu) {
  if (!menu) return { disconnect() {} };

  const documentRef = menu.ownerDocument;
  const summary = menu.querySelector('summary');
  let disconnected = false;

  function focusSummary() {
    summary?.focus?.();
  }

  function onClick(event) {
    if (
      event.defaultPrevented
      || (event.button ?? 0) !== 0
      || event.altKey
      || event.ctrlKey
      || event.metaKey
      || event.shiftKey
    ) {
      return;
    }

    const link = event.target?.closest?.('a[href^="#"]');
    const href = link?.getAttribute?.('href');
    if (!href || href.length < 2) return;

    menu.open = false;
    const destination = documentRef?.getElementById?.(href.slice(1));

    if (typeof destination?.focus === 'function') {
      destination.focus({ preventScroll: true });
    } else {
      focusSummary();
    }
  }

  function onKeyDown(event) {
    if (event.key !== 'Escape' || !menu.open) return;

    event.preventDefault();
    menu.open = false;
    focusSummary();
  }

  menu.addEventListener('click', onClick);
  documentRef?.addEventListener?.('keydown', onKeyDown);

  return {
    disconnect() {
      if (disconnected) return;

      disconnected = true;
      menu.removeEventListener('click', onClick);
      documentRef?.removeEventListener?.('keydown', onKeyDown);
    }
  };
}

if (typeof document !== 'undefined') {
  initProductDemo(document.querySelector('[data-product-demo]'));
  initMobileMenu(document.querySelector('[data-mobile-menu]'));
}
