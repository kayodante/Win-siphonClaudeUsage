// Crossfade between the main window's views. Only the newest switch decides
// what ends up on screen: a stale timer or frame can never hide the view that
// is now selected (Claude → Codex → Claude used to leave all four hidden).
// A switch that lands mid-fade does not snap: the view that was arriving
// leaves from wherever its fade had reached, and CSS transitions retarget from
// the on-screen value. The same discipline `switchSettingsTab` applies.

const TRANSIENT = ['position', 'top', 'left', 'width', 'pointerEvents', 'opacity', 'transform'];

export function createViewSwitcher(views, {
  fadeMs = () => 150,
  // Vertical travel of the crossfade; 0 under reduced motion (opacity only).
  shiftPx = () => 6,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  nextFrame = requestAnimationFrame
} = {}) {
  let timer = null;
  let generation = 0;
  let arriving = null;

  function clear(view) {
    for (const prop of TRANSIENT) view.style[prop] = '';
  }

  function settle(incoming) {
    arriving = null;
    for (const view of views) {
      view.hidden = view !== incoming;
      clear(view);
    }
  }

  // `onVisible` runs once `incoming` is in the layout, `onSettled` once it is
  // the only view left on screen. `direction` is 1 when the destination sits
  // after the origin (further down the rail, or Settings) and -1 going back:
  // content leaves and arrives along the same axis it would travel.
  return function show(incoming, { onVisible = () => {}, onSettled = () => {}, direction = 1 } = {}) {
    const interrupted = timer !== null;
    if (interrupted) {
      clearTimer(timer);
      timer = null;
    }
    const duration = fadeMs();
    const finish = () => {
      timer = setTimer(() => {
        timer = null;
        settle(incoming);
        onSettled();
      }, duration);
    };

    // A repeat call for the view already arriving (a data refresh mid-fade)
    // lets its fade run on.
    if (interrupted && incoming === arriving) {
      onVisible();
      finish();
      return;
    }

    const current = ++generation;
    const outgoing = interrupted ? arriving : views.find(v => !v.hidden && v !== incoming);
    if (!outgoing || duration <= 0) {
      settle(incoming);
      onVisible();
      onSettled();
      return;
    }

    for (const view of views) {
      if (view !== outgoing && view !== incoming) {
        view.hidden = true;
        clear(view);
      }
    }

    // Overlap the crossfade instead of running it twice. Parking the outgoing
    // view out of flow (.shell-scroll is position:relative) at the spot it
    // occupies lets the incoming one take its place at once.
    const shift = shiftPx() * direction;
    Object.assign(outgoing.style, {
      position: 'absolute',
      top: `${outgoing.offsetTop || 0}px`,
      left: `${outgoing.offsetLeft || 0}px`,
      width: `${outgoing.getBoundingClientRect().width}px`,
      pointerEvents: 'none',
      opacity: '0',
      transform: `translateY(${-shift}px)`
    });
    incoming.hidden = false;
    Object.assign(incoming.style, {
      position: '', top: '', left: '', width: '', pointerEvents: '',
      opacity: '0',
      transform: `translateY(${shift}px)`
    });
    arriving = incoming;
    onVisible();

    nextFrame(() => nextFrame(() => {
      if (current !== generation) return;
      incoming.style.opacity = '';
      incoming.style.transform = '';
    }));

    finish();
  };
}
