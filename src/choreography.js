// Turns analysis into the event timeline the player conducts.

export const SECTIONS = {
  violins: { label: 'VIOLINS', zone: 0, color: '#e8b04b' },
  winds: { label: 'WINDS', zone: 1, color: '#7fd1b9' },
  brass: { label: 'BRASS', zone: 1, color: '#d98c5f' },
  celli: { label: 'CELLI & BASSES', zone: 2, color: '#b08948' },
  timpani: { label: 'TIMPANI', zone: 2, color: '#c25b5b' },
  tutti: { label: 'TUTTI', zone: 1, color: '#f2e6c8' },
};

// conducting pattern positions per meter, unit box (x right, y down), beat 1 first
export const PATTERNS = {
  2: [[0.5, 0.85], [0.5, 0.2]],
  3: [[0.5, 0.88], [0.82, 0.5], [0.5, 0.15]],
  4: [[0.5, 0.9], [0.2, 0.55], [0.8, 0.55], [0.5, 0.15]],
};

export function buildChoreography(a) {
  const meter = a.meter || 4;
  const beats = a.beats.map((t, i) => ({
    t, i,
    beatInBar: ((i - a.phase) % meter + meter) % meter,
    dyn: a.levelAt(a.dyn, t),
    state: 'pending', judge: null,
  }));
  let bar = 0;
  for (const b of beats) {
    b.down = b.beatInBar === 0;
    if (b.down) bar++;
    b.bar = bar;
    b.legato = a.levelAt(a.artic, b.t) < 0.3 && b.dyn > 0.15;
  }
  for (const ht of a.hits || []) { // sforzando accents land on their nearest beat
    let best = null, bd = 0.3;
    for (const b of beats) {
      const d = Math.abs(b.t - ht);
      if (d < bd) { bd = d; best = b; }
      if (b.t > ht + 0.3) break;
    }
    if (best) best.hit = true;
  }
  const phrases = (a.phrases || []).map(p => ({ ...p, state: 'pending' }));
  // the tracker lays beats through silence; judging them would punish the very
  // stillness the rest spans demand — drop them from the timeline entirely
  const rests = phrases.filter(p => p.type === 'rest');
  const playable = beats.filter(b => !rests.some(r => b.t > r.t0 && b.t < r.t1));

  const cues = a.cues.map(c => {
    const s = SECTIONS[c.section];
    return { t: c.t, section: c.section, zone: s.zone, label: s.label, color: s.color, state: 'pending' };
  });

  return {
    beats: playable, cues, meter, phrases,
    bpm: a.bpm,
    duration: a.duration,
    dynAt: t => a.levelAt(a.dyn, t),
    bandAt: (b, t) => a.levelAt(a.bands[b], t),
  };
}
