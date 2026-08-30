type Cue = "event" | "half" | "end" | "alert";

let audio: AudioContext | null = null;

/** Must be called from within a user gesture (e.g. the first tap) to allow later beeps. */
export function unlockAudio(): void {
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    audio ??= new Ctor();
    if (audio.state === "suspended") void audio.resume();
  } catch {
    /* ignored */
  }
}

const VIBRATION: Record<Cue, number | number[]> = {
  event: 25,
  half: [90, 60, 90],
  end: [140, 90, 140, 90, 200],
  alert: [70, 50, 70, 50, 70],
};

const TONE: Record<Cue, { freq: number; beeps: number }> = {
  event: { freq: 660, beeps: 1 },
  half: { freq: 520, beeps: 2 },
  end: { freq: 400, beeps: 3 },
  alert: { freq: 880, beeps: 3 },
};

function beep(ctx: AudioContext, freq: number, beeps: number): void {
  const now = ctx.currentTime;
  for (let index = 0; index < beeps; index += 1) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const start = now + index * 0.28;
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.22, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.22);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + 0.24);
  }
}

/** Fire haptic feedback (always) and, when `sound` is enabled and audio is unlocked, a short tone. */
export function cue(kind: Cue, sound: boolean): void {
  try {
    navigator.vibrate?.(VIBRATION[kind]);
  } catch {
    /* ignored */
  }
  if (sound && audio && audio.state === "running") {
    try {
      const { freq, beeps } = TONE[kind];
      beep(audio, freq, beeps);
    } catch {
      /* ignored */
    }
  }
}
