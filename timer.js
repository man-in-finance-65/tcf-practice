// Timers: the 60-minute Huberman session timer and a generic countdown used for
// per-question limits and the EE writing limit.

export function formatTime(totalSeconds) {
  const s = Math.max(0, Math.ceil(totalSeconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Calls onTick(secondsLeft) about 4×/s and onDone() once at zero.
 * Uses wall-clock time rather than counting ticks, so background-tab throttling
 * can't make a 50 s question last longer than 50 s.
 * Returns stop().
 */
export function startCountdown(seconds, onTick, onDone) {
  const end = Date.now() + seconds * 1000;
  let finished = false;
  const tick = () => {
    const left = (end - Date.now()) / 1000;
    onTick(Math.max(0, left));
    if (left <= 0 && !finished) {
      finished = true;
      clearInterval(id);
      onDone?.();
    }
  };
  const id = setInterval(tick, 250);
  tick();
  return () => { finished = true; clearInterval(id); };
}

// ---------- Huberman session timer ----------

const SESSION_SECONDS = 60 * 60;
const PHASES = [
  { from: 0, to: 5, name: 'Focus', detail: '0–5 min · settle in, one task only' },
  { from: 5, to: 50, name: 'Practice', detail: '5–50 min · deliberate practice' },
  { from: 50, to: 60, name: 'Memory test', detail: '50–60 min · recall without notes' },
];

let sessionEnd = null; // module state = lives for the page, survives mode switches

/** Starts the 60-minute session if it isn't running yet; later calls are no-ops. */
export function startHuberman() {
  if (sessionEnd) return;
  sessionEnd = Date.now() + SESSION_SECONDS * 1000;
  const panel = document.getElementById('huberman');
  panel.hidden = false;
  panel.innerHTML = `
    <div class="hb-clock" aria-label="Session time left"></div>
    <div class="hb-detail">
      <h3>Huberman session</h3>
      <ol class="hb-phases">${PHASES.map((p) => `<li><strong>${p.name}</strong><span>${p.detail}</span></li>`).join('')}</ol>
    </div>`;
  const clock = panel.querySelector('.hb-clock');
  const items = panel.querySelectorAll('.hb-phases li');

  startCountdown(SESSION_SECONDS, (left) => {
    clock.textContent = left > 0 ? formatTime(left) : 'Done';
    const elapsedMin = (SESSION_SECONDS - left) / 60;
    items.forEach((li, i) => {
      li.classList.toggle('active', left > 0 && elapsedMin >= PHASES[i].from && elapsedMin < PHASES[i].to);
      li.classList.toggle('past', elapsedMin >= PHASES[i].to);
    });
  }, () => {
    panel.classList.add('finished');
    panel.querySelector('h3').textContent = 'Session terminée';
  });
}
