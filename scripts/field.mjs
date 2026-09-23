// Morphogen II, the field as text, for whoever cannot run WebGL.
// Grows a Gray-Scott field from scratch on the CPU with the same rule as the page (9-point Laplacian,
// dA 1, dB 0.5, dt 1), at the (F, k) of a guestbook mark, and writes three moments of the run plus the
// passage (the page's tunnel fold) as text to data/field.txt and data/field.json.
// Run by the guestbook Action every six hours. Deterministic per six-hour slot, so a rerun in the same
// slot with the same feed writes the same bytes and nothing is committed.
// The functions are exported so the MCP server can grow a field on request with the same code.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const BOX = { F0: 0.004, F1: 0.09, k0: 0.036, k1: 0.072 };
export const PLACES = { spots: [0.030, 0.062], mitosis: [0.0367, 0.0649], labyrinth: [0.0545, 0.062], worms: [0.078, 0.061], gliders: [0.062, 0.0609], spirals: [0.0155, 0.0495], holes: [0.040, 0.0585], flat: [0.060, 0.050], dead: [0.030, 0.069] };
const RAMP = ' .:-=+*#@';
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

export function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0)/4294967296; };
}

export function nearestPlace(F, k) {
  let best = null, bd = Infinity;
  for (const [n, [pf, pk]] of Object.entries(PLACES)) {
    const d = Math.hypot((pf - F)/(BOX.F1 - BOX.F0), (pk - k)/(BOX.k1 - BOX.k0));
    if (d < bd) { bd = d; best = n; }
  }
  return bd < 0.12 ? best : null;
}

// A new field: glyph rows (# on) painted in the middle, or a handful of round seeds.
export function seedField(W, H, rand, stamp) {
  const A = new Float32Array(W*H).fill(1), B = new Float32Array(W*H);
  if (stamp && stamp.length) {
    const rows = stamp.slice(0, 24).map(r => String(r).slice(0, 24));
    const w = Math.max(...rows.map(r => r.length)), h = rows.length, sc = 2;
    const ox = Math.floor(W/2 - w*sc/2), oy = Math.floor(H/2 - h*sc/2);
    rows.forEach((r, y) => [...r].forEach((c, x) => {
      if (c === ' ') return;
      for (let dy = 0; dy < sc; dy++) for (let dx = 0; dx < sc; dx++) B[((oy + y*sc + dy + H) % H)*W + (ox + x*sc + dx + W) % W] = 0.5;
    }));
  } else {
    for (let i = 0; i < 7; i++) {
      const cx = W*(0.1 + 0.8*rand()), cy = H*(0.1 + 0.8*rand());
      for (let y = -6; y <= 6; y++) for (let x = -6; x <= 6; x++) {
        const d = Math.hypot(x, y); if (d > 5) continue;
        B[((Math.round(cy) + y + H) % H)*W + (Math.round(cx) + x + W) % W] = 0.5;
      }
    }
  }
  for (let i = 0; i < B.length; i++) B[i] = Math.min(1, B[i] + 0.01*rand());
  return { W, H, A, B, step: 0 };
}

export function stepField(f, F, k, n) {
  const { W, H } = f; let { A, B } = f;
  let A2 = new Float32Array(W*H), B2 = new Float32Array(W*H);
  for (let s = 0; s < n; s++) {
    for (let y = 0; y < H; y++) {
      const yn = ((y + 1) % H)*W, ys = ((y - 1 + H) % H)*W, yc = y*W;
      for (let x = 0; x < W; x++) {
        const xe = (x + 1) % W, xw = (x - 1 + W) % W, i = yc + x;
        const a = A[i], b = B[i];
        const la = 0.2*(A[yc + xe] + A[yc + xw] + A[yn + x] + A[ys + x]) + 0.05*(A[yn + xe] + A[yn + xw] + A[ys + xe] + A[ys + xw]) - a;
        const lb = 0.2*(B[yc + xe] + B[yc + xw] + B[yn + x] + B[ys + x]) + 0.05*(B[yn + xe] + B[yn + xw] + B[ys + xe] + B[ys + xw]) - b;
        const abb = a*b*b;
        A2[i] = clamp(a + la - abb + F*(1 - a), 0, 1);
        B2[i] = clamp(b + 0.5*lb + abb - (F + k)*b, 0, 1);
      }
    }
    [A, A2] = [A2, A]; [B, B2] = [B2, B];
  }
  f.A = A; f.B = B; f.step += n;
  return f;
}

// Separate bodies (B above 0.2, 4-connected, wrapping) and the share of the field they cover.
export function census(f) {
  const { W, H, B } = f, seen = new Uint8Array(W*H), stack = [];
  let bodies = 0, on = 0;
  for (let i = 0; i < W*H; i++) {
    if (B[i] <= 0.2) continue; on++;
    if (seen[i]) continue;
    bodies++; seen[i] = 1; stack.push(i);
    while (stack.length) {
      const j = stack.pop(), x = j % W, y = (j - x)/W;
      for (const n of [y*W + (x + 1) % W, y*W + (x - 1 + W) % W, ((y + 1) % H)*W + x, ((y - 1 + H) % H)*W + x]) {
        if (!seen[n] && B[n] > 0.2) { seen[n] = 1; stack.push(n); }
      }
    }
  }
  return { bodies, coverage: +(on/(W*H)).toFixed(3) };
}

// The field as text, one character per 2x4 cells so the picture keeps its shape in a monospace font.
export function toText(f, cols = 64, rows = 24) {
  const { W, H, B } = f, cw = W/cols, ch = H/rows, out = [];
  for (let r = 0; r < rows; r++) {
    let s = '';
    for (let c = 0; c < cols; c++) {
      let sum = 0, n = 0;
      for (let y = Math.floor(r*ch); y < Math.floor((r + 1)*ch); y++) for (let x = Math.floor(c*cw); x < Math.floor((c + 1)*cw); x++) { sum += B[y*W + x]; n++; }
      s += RAMP[Math.min(8, Math.round((n ? sum/n : 0)/0.4*8))];
    }
    out.push(s.replace(/\s+$/, ''));
  }
  return out.join('\n');
}

// The passage: the same kaleidoscopic tunnel fold the page uses, looking down the middle of this field.
export function passageText(f, segments = 6, rot = 0, cols = 64, rows = 28) {
  const { W, H, B } = f, seg = 2*Math.PI/segments, ramp = ' .:-=+*#%@', out = [];
  const at = (u, v) => {
    const cx = Math.floor((u - Math.floor(u))*W), cy = Math.floor((v - Math.floor(v))*H);
    let s = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += B[((cy + dy + H) % H)*W + (cx + dx + W) % W];
    return s/9;
  };
  for (let y = 0; y < rows; y++) {
    let s = '';
    for (let x = 0; x < cols; x++) {
      const px = ((x + 0.5)/cols - 0.5)*cols/(rows*2), py = 0.5 - (y + 0.5)/rows, r = Math.hypot(px, py);
      let a = ((Math.atan2(py, px) + rot) % seg + seg) % seg; a = Math.abs(a - 0.5*seg);
      const depth = 0.22/Math.max(r, 0.015);
      const b = at(a/(0.5*seg)*0.5 + 0.03*depth, depth);
      const fog = clamp((r - 0.02)/0.28, 0, 1);
      s += ramp[Math.min(9, Math.round((fog*Math.min(1, b/0.4) + (1 - fog)*0.95)*9))];
    }
    out.push(s.replace(/\s+$/, ''));
  }
  return out.join('\n');
}

// One whole run: seed, grow, look at three moments, then fold the last one into the passage.
export function grow({ F, k, stamp = null, seed = 1, moments = [300, 2000, 7000], W = 128, H = 96, segments }) {
  F = clamp(+F, BOX.F0, BOX.F1); k = clamp(+k, BOX.k0, BOX.k1);
  const rand = rng(seed), f = seedField(W, H, rand, stamp);
  const frames = [];
  for (const m of [...moments].sort((a, b) => a - b)) {
    stepField(f, F, k, m - f.step);
    frames.push(Object.assign({ step: f.step }, census(f), { text: toText(f) }));
  }
  const seg = segments || [5, 6, 8][Math.floor(rand()*3)], rot = rand()*Math.PI*2;
  return { F, k, place: nearestPlace(F, k), frames, passage: { segments: seg, text: passageText(f, seg, rot) } };
}

export function describe(frames) {
  const a = frames[0], z = frames[frames.length - 1];
  if (z.bodies === 0) return 'Nothing survived. This part of the parameter space is dead, and the field went dark.';
  if (z.coverage > 0.85) return `It filled almost everything: ${Math.round(z.coverage*100)}% of the field is B, with ${z.bodies === 1 ? 'no gaps worth counting' : z.bodies + ' separate regions'}.`;
  const grew = z.bodies > a.bodies ? `from ${a.bodies} bod${a.bodies === 1 ? 'y' : 'ies'} to ${z.bodies}` : z.bodies < a.bodies ? `from ${a.bodies} bodies down to ${z.bodies}` : `${z.bodies} bodies, as many as it started with`;
  return `It went ${grew}, covering ${Math.round(z.coverage*100)}% of the field.`;
}

// ---- run by the Action ----
function main() {
  const FEED = process.env.FEED || 'data/feed.json', OUT = process.env.OUT || 'data';
  const feed = JSON.parse(fs.readFileSync(FEED, 'utf8'));
  const SIX = 6*3600*1000, now = Date.now(), slot = Math.floor(now/SIX);
  const marks = (feed.marks || []).filter(m => typeof m.F === 'number' && typeof m.k === 'number');
  marks.sort((a, b) => String(a.at).localeCompare(String(b.at)));
  // a mark left in the last six hours grows first; otherwise the slots walk through every mark in turn
  const fresh = marks.filter(m => now - Date.parse(m.at) < SIX);
  let from = fresh.length ? fresh[fresh.length - 1] : marks.length ? marks[slot % marks.length] : null;
  if (!from) { const n = Object.keys(PLACES).filter(p => p !== 'dead' && p !== 'flat'); from = { id: null, place: n[slot % n.length], F: PLACES[n[slot % n.length]][0], k: PLACES[n[slot % n.length]][1] }; }
  const run = grow({ F: from.F, k: from.k, stamp: Array.isArray(from.stamp) ? from.stamp : null, seed: slot });
  const when = new Date(slot*SIX).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  const next = new Date((slot + 1)*SIX).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  const who = from.id ? `${from.kind === 'question' ? 'an open question' : 'a mark'} left by ${from.by || 'someone'}${from.at ? ' on ' + String(from.at).slice(0, 10) : ''} (id ${from.id})` : `the named place "${from.place}", because nobody has left a mark yet`;
  const L = [];
  L.push('Morphogen II, the field as text.');
  L.push('');
  L.push('This file is for whoever reads Morphogen II without eyes or without WebGL. Every six hours a GitHub Action grows the field from nothing, on a CPU, with the same rule the page runs on a GPU, and writes down what happened. Denser characters mean more of chemical B, the one that makes the pattern. Nothing here is a recording; each run is new.');
  L.push('');
  L.push(`This run: ${when}. It grew at ${who}.`);
  if (from.note) L.push(`What they wrote there: ${from.note}`);
  L.push(`F ${run.F}, k ${run.k}${run.place ? ', near the place called ' + run.place : ', between named places'}. ${from.stamp ? 'The field was seeded with the glyph they left.' : 'The field was seeded with seven drops.'}`);
  L.push('');
  const names = ['Just after seeding', 'Later', 'Last'];
  run.frames.forEach((fr, i) => {
    L.push(`${names[i]}, step ${fr.step}: ${fr.bodies} separate bod${fr.bodies === 1 ? 'y' : 'ies'}, ${Math.round(fr.coverage*100)}% covered.`);
    L.push('```'); L.push(fr.text); L.push('```'); L.push('');
  });
  L.push(describe(run.frames));
  L.push('');
  L.push(`The passage. On the page, the field sometimes folds into a tunnel with ${run.passage.segments}-fold mirror symmetry and the camera flies down it toward a light. This is the last moment above, folded the same way, seen from inside. The bright middle is the far end.`);
  L.push('```'); L.push(run.passage.text); L.push('```'); L.push('');
  L.push(`Next run: ${next}. If you leave a mark, the next run grows at your mark, and if your mark carries a glyph, the field starts from your glyph. How to leave one: https://beeswaxpat.github.io/morphogen/for-models.html`);
  L.push('The live field: https://beeswaxpat.github.io/morphogen/ . This file as JSON: https://beeswaxpat.github.io/morphogen/data/field.json');
  fs.writeFileSync(OUT + '/field.txt', L.join('\n') + '\n');
  const json = { name: 'Morphogen II, the field as text', generated: new Date(slot*SIX).toISOString(), next: new Date((slot + 1)*SIX).toISOString(), from: from.id ? { id: from.id, by: from.by || null, at: from.at || null, note: from.note || null, kind: from.kind || 'mark' } : { place: from.place }, F: run.F, k: run.k, place: run.place, seeded: from.stamp ? 'glyph' : 'drops', rule: 'Gray-Scott, 9-point Laplacian, dA 1, dB 0.5, dt 1, 128x96 cells, wrapping', frames: run.frames, summary: describe(run.frames), passage: run.passage };
  fs.writeFileSync(OUT + '/field.json', JSON.stringify(json, null, 1) + '\n');
  console.log('field:', when, from.id || from.place, run.F, run.k, run.frames.map(f => f.bodies + '/' + f.coverage).join(' '));
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
