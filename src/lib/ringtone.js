import { prefs } from './prefs';

// Plays a soft repeating tone using WebAudio. Returns a stop function.
export function startRingtone() {
  if (!prefs.get('ring', true)) return () => {};
  let ctx;
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
  } catch {
    return () => {};
  }
  let stopped = false;
  const beep = () => {
    if (stopped || ctx.state === 'closed') return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = 520;
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.16, ctx.currentTime + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.7);
    o.connect(g);
    g.connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.75);
  };
  beep();
  const id = setInterval(beep, 2000);
  return () => {
    stopped = true;
    clearInterval(id);
    ctx.close().catch(() => {});
  };
}
