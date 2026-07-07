// Animated 4×4 dot-matrix pulse rendered next to the "last updated" line.
// Self-contained: mounts into #lastUpdatedDot and drives its own rAF loop.
export function initDotMatrix() {
  const wrap = document.getElementById('lastUpdatedDot');
  if (!wrap) return;

  const N = 4;
  const CENTER = 1.5;
  const CORNERS = new Set(['0,0', '0,3', '3,0', '3,3']);
  const CYCLE_MS = 1400;

  const dots = [];
  for (let row = 0; row < N; row++) {
    for (let col = 0; col < N; col++) {
      const span = document.createElement('span');
      if (CORNERS.has(`${row},${col}`)) {
        span.className = 'dmx-dot dmx-inactive';
      } else {
        const r = Math.hypot(col - CENTER, row - CENTER);
        span.className = 'dmx-dot';
        span.dataset.zone = r < 0.8 ? 'c' : 'i';
      }
      wrap.appendChild(span);
      dots.push(span);
    }
  }

  function tick() {
    if (document.hidden) {
      requestAnimationFrame(tick);
      return;
    }

    const phase = (performance.now() % CYCLE_MS) / CYCLE_MS;
    const beat = Math.sin(phase * Math.PI * 2);
    const spike = Math.sin(phase * Math.PI * 4);
    const pulse = Math.max(0, beat) + Math.max(0, spike) * 0.55;

    for (const dot of dots) {
      const z = dot.dataset.zone;
      if (!z) continue;
      dot.style.opacity =
        z === 'c' ? Math.min(1, 0.35 + pulse * 0.95) :
        z === 'i' ? 0.16 + pulse * 0.44 :
                    0.08 + pulse * 0.08;
    }

    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}
