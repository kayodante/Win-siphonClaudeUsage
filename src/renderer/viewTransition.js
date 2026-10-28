// Crossfade between the main window's views. Only the newest switch decides
// what ends up on screen: one that lands mid-fade cancels the previous fade's
// timer and settles every view first, so a stale callback can never hide the
// view that is now selected (Claude → Codex → Claude used to leave all four
// hidden). The same discipline `switchSettingsTab` applies to its panels.

const TRANSIENT = ['position', 'top', 'left', 'width', 'pointerEvents', 'opacity', 'transform'];

export function createViewSwitcher(views, {
  fadeMs = () => 150,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  nextFrame = requestAnimationFrame
} = {}) {
  let timer = null;
  let generation = 0;

  function settle(incoming) {
    for (const view of views) {
      view.hidden = view !== incoming;
      for (const prop of TRANSIENT) view.style[prop] = '';
    }
  }

  // `onVisible` runs once `incoming` is in the layout, `onSettled` once it is
  // the only view left on screen.
  return function show(incoming, { onVisible = () => {}, onSettled = () => {} } = {}) {
    const current = ++generation;
    const interrupted = timer !== null;
    if (interrupted) {
      clearTimer(timer);
      timer = null;
    }
    const outgoing = views.find(v => !v.hidden && v !== incoming);
    const duration = fadeMs();
    if (!outgoing || interrupted || duration <= 0) {
      settle(incoming);
      onVisible();
      onSettled();
      return;
    }

    // Overlap the crossfade instead of running it twice. Parking the outgoing
    // view out of flow (.shell-scroll is position:relative) lets the incoming
    // one take its place at once, so opening a view costs one fade, not two.
    const width = outgoing.getBoundingClientRect().width;
    Object.assign(outgoing.style, {
      position: 'absolute',
      top: '0',
      left: '0',
      width: `${width}px`,
      pointerEvents: 'none',
      opacity: '0',
      transform: 'translateY(-6px)'
    });
    incoming.hidden = false;
    incoming.style.opacity = '0';
    incoming.style.transform = 'translateY(6px)';
    onVisible();

    nextFrame(() => nextFrame(() => {
      if (current !== generation) return;
      incoming.style.opacity = '';
      incoming.style.transform = '';
    }));

    timer = setTimer(() => {
      timer = null;
      settle(incoming);
      onSettled();
    }, duration);
  };
}
