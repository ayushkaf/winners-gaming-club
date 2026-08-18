// public/js/art.js — procedural vector art shared by the marketing site and
// the play page. Same original symbol designs as the Toro Math Lab research
// build (layer-based paths, no external assets, no raster images) — upgraded
// with a uniform gloss/shading system: every non-trivial fill in every symbol
// is auto-converted from a flat color into a light-to-dark gradient along one
// consistent light direction, plus a shared drop-shadow and hand-placed
// specular highlights on the rounder/metallic symbols. One lighting model
// applied everywhere reads as a coherent, polished style rather than 15
// one-off illustrations.
export const HORN = '#e8b64c', HIDE = '#7a2e1d', HIDE2 = '#5c2115', WOOD = '#9c6b3f', WOOD2 = '#7a5230';

// ---------------------------------------------------------------- color math
function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbToHex([r, g, b]) {
  return '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}
function lighten(hex, amt) {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex([r + (255 - r) * amt, g + (255 - g) * amt, b + (255 - b) * amt]);
}
function darken(hex, amt) {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex([r * (1 - amt), g * (1 - amt), b * (1 - amt)]);
}
// One fixed light direction (upper-left) shared by every gradient in every
// symbol, in the same 0-100 viewBox space every layer is authored in — this
// is what makes the auto-glossed shapes read as "lit the same way" instead of
// a grab-bag of unrelated shading choices.
const LIGHT = [15, 8, 80, 92];

// Wraps every sizable flat-color fill in a layer array with a light->base->
// dark gradient. Text and small accent details (circles under radius 5 —
// eyes, nail holes, rowel-center dots) are deliberately left flat; gradients
// on tiny shapes just read as noise.
function autoGlossy(layers) {
  return layers.map((l) => {
    if (l.t !== undefined) return l;
    if (l.c && l.c[2] < 5) return l;
    if (typeof l.fill !== 'string' || l.fill.startsWith('rgba')) return l;
    return { ...l, grad: [[0, lighten(l.fill, 0.55)], [0.55, l.fill], [1, darken(l.fill, 0.32)]] };
  });
}
// A small warm specular pop for the rounder/metallic symbols — appended
// after autoGlossy so it stays a flat translucent highlight, not gradiented.
const shine = (cx, cy, r) => ({ c: [cx, cy, r], fill: 'rgba(255,255,255,0.5)' });

export const ART = {
  bull: [
    { d: 'M33 30 C22 28 14 20 12 9 C21 14 30 16 37 23 Z', fill: HORN },
    { d: 'M67 30 C78 28 86 20 88 9 C79 14 70 16 63 23 Z', fill: HORN },
    { d: 'M50 20 C41 20 34 25 31 32 L28 45 C26 58 33 70 42 76 L46 83 C48 86 52 86 54 83 L58 76 C67 70 74 58 72 45 L69 32 C66 25 59 20 50 20 Z', fill: HIDE },
    { d: 'M42 76 L46 83 C48 86 52 86 54 83 L58 76 C55 71 45 71 42 76 Z', fill: HIDE2 },
    { c: [41, 44, 3.5], fill: '#ffe9c9' }, { c: [59, 44, 3.5], fill: '#ffe9c9' },
    { c: [45, 70, 2.4], fill: '#3a130b' }, { c: [55, 70, 2.4], fill: '#3a130b' },
  ],
  gate: [
    { d: 'M18 24 h9 v56 h-9 Z', fill: WOOD }, { d: 'M73 24 h9 v56 h-9 Z', fill: WOOD },
    { d: 'M12 32 h76 v8 h-76 Z', fill: WOOD2 }, { d: 'M12 50 h76 v8 h-76 Z', fill: WOOD2 },
    { d: 'M12 68 h76 v8 h-76 Z', fill: WOOD2 },
    { d: 'M45 12 l5 -6 l5 6 l-2 8 h-6 Z', fill: HORN },
  ],
  coin: [
    { c: [50, 50, 38], fill: '#c9922a' }, { c: [50, 50, 33], fill: '#f5c542' },
    { c: [50, 50, 26], fill: '#ffd977' },
    { t: '$', x: 50, y: 63, s: 38, fill: '#8a5a10', w: 900 },
  ],
  horseshoe: [
    { d: 'M32 22 C20 34 18 52 27 66 C32 74 39 79 46 81 L49 71 C43 68 37 62 34 54 C31 44 34 34 41 28 Z', fill: HORN },
    { d: 'M68 22 C80 34 82 52 73 66 C68 74 61 79 54 81 L51 71 C57 68 63 62 66 54 C69 44 66 34 59 28 Z', fill: HORN },
    { c: [36, 30, 2.5], fill: '#8a5a10' }, { c: [64, 30, 2.5], fill: '#8a5a10' },
    { c: [30, 48, 2.5], fill: '#8a5a10' }, { c: [70, 48, 2.5], fill: '#8a5a10' },
    { c: [40, 70, 2.5], fill: '#8a5a10' }, { c: [60, 70, 2.5], fill: '#8a5a10' },
  ],
  cactus: [
    { d: 'M44 30 a6 6 0 0 1 12 0 v52 h-12 Z', fill: '#4e8f45' },
    { d: 'M26 42 a5 5 0 0 1 10 0 v10 a4 4 0 0 0 4 4 h4 v10 h-6 a12 12 0 0 1 -12 -12 Z', fill: '#437c3b' },
    { d: 'M74 36 a5 5 0 0 0 -10 0 v14 a4 4 0 0 1 -4 4 h-4 v10 h6 a12 12 0 0 0 12 -12 Z', fill: '#437c3b' },
    { c: [50, 24, 5], fill: '#e26d8f' },
    { d: 'M36 82 h28 v6 h-28 Z', fill: '#a97845' },
  ],
  mesa: [
    { c: [26, 26, 11], fill: '#f0b429' },
    { d: 'M10 74 L30 38 H70 L90 74 Z', fill: '#a04b2b' },
    { d: 'M24 74 L38 52 H62 L76 74 Z', fill: '#c26436' },
    { d: 'M8 74 h84 v6 h-84 Z', fill: '#6d3520' },
  ],
};
// Mid/low-tier symbols. These used to be plain "A K Q J 10 9" card-rank
// badges — replaced with original pictorial icons matching the ranch/gold-
// rush theme, ordered by pay tier (nugget highest, lasso lowest).
function ringD(cx, cy, rOuter, rInner) {
  // A filled ring via two circles of opposite winding in one path — the
  // nonzero fill-rule cancels the overlap, punching the hole. Works in both
  // SVG (default fill-rule) and Canvas2D Path2D.fill() (default 'nonzero').
  const cw = (r) => `M${cx + r},${cy} A${r},${r} 0 1,1 ${cx - r},${cy} A${r},${r} 0 1,1 ${cx + r},${cy} Z`;
  const ccw = (r) => `M${cx + r},${cy} A${r},${r} 0 1,0 ${cx - r},${cy} A${r},${r} 0 1,0 ${cx + r},${cy} Z`;
  return cw(rOuter) + ' ' + ccw(rInner);
}
ART.nugget = [
  { d: 'M28 52 L18 36 L34 18 L58 12 L80 24 L86 46 L74 66 L52 78 L30 70 Z', fill: '#c9922a' },
  { d: 'M36 28 L54 20 L66 30 L58 46 L40 42 Z', fill: '#f5c542' },
  { d: 'M42 54 L62 48 L72 60 L58 72 L42 68 Z', fill: '#ffd977' },
];
ART.spur = [
  { d: 'M22 30 C14 40 13 58 22 70 C28 78 37 82 45 82 L47 72 C40 70 34 64 31 56 C28 46 31 36 38 30 Z', fill: '#c7cdd6' },
  { d: 'M45,47.8 L78,47.8 L78,42 L86,50 L78,58 L78,52.2 L45,52.2 Z', fill: '#8b93a0' },
  { c: [78, 50, 9], fill: '#c7cdd6' },
  { c: [78, 50, 4], fill: '#5b6270' },
];
ART.lantern = [
  { d: 'M42 8 h16 v8 h-16 Z', fill: '#8a5a2e' },
  { d: 'M38 16 h24 v6 h-24 Z', fill: '#6b4423' },
  { d: 'M34 22 L66 22 L60 66 L40 66 Z', fill: '#33271b' },
  { d: 'M39 27 L61 27 L56 61 L44 61 Z', fill: '#dceaf0' },
  { d: 'M46 38 Q50 28 54 38 Q56 48 50 54 Q44 48 46 38 Z', fill: '#ffcf5c' },
  { d: 'M40 66 h20 v8 h-20 Z', fill: '#6b4423' },
  { d: 'M46 74 h8 v10 h-8 Z', fill: '#8a5a2e' },
];
ART.wheel = [
  { c: [50, 50, 34], fill: '#6b5a45' },
  { c: [50, 50, 27], fill: '#4a3d2e' },
  { d: 'M60,47.8 L80,47.8 L80,52.2 L60,52.2 Z', fill: '#8a7256' },
  { d: 'M56.9,57.6 L66.9,74.9 L63.1,77.1 L53.1,59.8 Z', fill: '#8a7256' },
  { d: 'M46.9,59.8 L36.9,77.1 L33.1,74.9 L43.1,57.6 Z', fill: '#8a7256' },
  { d: 'M40,47.8 L20,47.8 L20,52.2 L40,52.2 Z', fill: '#8a7256' },
  { d: 'M43.1,42.4 L33.1,25.1 L36.9,22.9 L46.9,40.2 Z', fill: '#8a7256' },
  { d: 'M53.1,40.2 L63.1,22.9 L66.9,25.1 L56.9,42.4 Z', fill: '#8a7256' },
  { c: [50, 50, 9], fill: '#a3906f' },
  { c: [50, 50, 4], fill: '#3a2f22' },
];
ART.canteen = [
  { c: [50, 55, 26], fill: '#8a5a2e' },
  { c: [50, 55, 20], fill: '#a97845' },
  { d: 'M32 34 C24 42 22 58 30 70 C33 74 37 76 40 77 L42 71 C38 69 35 65 33 59 C31 50 33 43 38 37 Z', fill: '#5c3a1a' },
  { d: 'M42 20 h16 v14 h-16 Z', fill: '#6b4423' },
  { c: [50, 18, 8], fill: '#4a3018' },
];
ART.lasso = [
  { d: ringD(50, 52, 30, 21), fill: '#c9a35c' },
  { c: [50, 22, 5], fill: '#a3793a' },
  { d: 'M53 24 L66 40 L61 44 L49 28 Z', fill: '#a3793a' },
];
ART.moneybull = [{ c: [50, 50, 44], fill: '#c9922a' }, { c: [50, 50, 39], fill: '#f5c542' }].concat(ART.bull.map((l) => ({ ...l })));
ART.collector = ART.moneybull.map((l) => l.fill === HIDE ? { ...l, fill: '#a33d16' } : { ...l });
ART.diamond = [{ d: 'M50 6 L82 38 L50 94 L18 38 Z', fill: '#3d6b8f' }, { d: 'M50 14 L74 38 L50 84 L26 38 Z', fill: '#7ec8ff' }].concat(ART.bull.map((l) => ({ ...l })));

// ---------------------------------------------------------- gloss + shine pass
for (const kind of Object.keys(ART)) ART[kind] = autoGlossy(ART[kind]);
// Hand-placed specular pops on the rounder / metal-and-glass symbols — added
// after the gloss pass so they stay flat, not gradiented.
ART.coin.push(shine(40, 38, 7));
ART.nugget.push(shine(38, 30, 6));
ART.wheel.push(shine(40, 38, 6));
ART.lasso.push(shine(36, 42, 6));
ART.moneybull.push(shine(38, 38, 7));
ART.spur.push(shine(75, 46, 3.5));
ART.lantern.push({ d: 'M43 32 L47 30 L45 44 L42 42 Z', fill: 'rgba(255,255,255,0.6)' });
ART.canteen.push(shine(41, 48, 6));

export function svgFor(kind) {
  const layers = ART[kind] || [];
  let defs = '', body = '', gradCount = 0;
  for (const l of layers) {
    let fillAttr;
    if (l.grad) {
      const id = 'g' + gradCount++;
      defs += `<linearGradient id="${id}" x1="${LIGHT[0]}" y1="${LIGHT[1]}" x2="${LIGHT[2]}" y2="${LIGHT[3]}" gradientUnits="userSpaceOnUse">` +
        l.grad.map(([off, color]) => `<stop offset="${off}" stop-color="${color}"/>`).join('') + '</linearGradient>';
      fillAttr = `url(#${id})`;
    } else fillAttr = l.fill;
    if (l.d) body += `<path d="${l.d}" fill="${fillAttr}"/>`;
    else if (l.c) body += `<circle cx="${l.c[0]}" cy="${l.c[1]}" r="${l.c[2]}" fill="${fillAttr}"/>`;
    else if (l.t !== undefined) body += `<text x="${l.x}" y="${l.y}" font-size="${l.s}" font-weight="${l.w || 700}" fill="${l.fill}" text-anchor="middle" font-family="system-ui,sans-serif">${l.t}</text>`;
  }
  // A single group-level drop shadow: overlapping opaque shapes composite
  // into one silhouette first, so this reads as one coherent shadow under
  // the whole symbol rather than a shadow per layer.
  const shadowId = 'sh';
  return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">` +
    `<defs>${defs}<filter id="${shadowId}" x="-20%" y="-20%" width="140%" height="140%">` +
    `<feDropShadow dx="0" dy="1.6" stdDeviation="1.8" flood-color="#000" flood-opacity="0.4"/></filter></defs>` +
    `<g filter="url(#${shadowId})">${body}</g></svg>`;
}
export function paintSymbol(ctx, kind, x, y, size) {
  const layers = ART[kind] || [];
  const k = size / 100;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(k, k);
  for (const l of layers) {
    let fillStyle;
    if (l.grad) {
      const g = ctx.createLinearGradient(LIGHT[0], LIGHT[1], LIGHT[2], LIGHT[3]);
      for (const [off, color] of l.grad) g.addColorStop(off, color);
      fillStyle = g;
    } else fillStyle = l.fill;
    if (l.d) { ctx.fillStyle = fillStyle; ctx.fill(new Path2D(l.d)); }
    else if (l.c) { ctx.fillStyle = fillStyle; ctx.beginPath(); ctx.arc(l.c[0], l.c[1], l.c[2], 0, 7); ctx.fill(); }
    else if (l.t !== undefined) {
      ctx.fillStyle = l.fill; ctx.font = `${l.w || 700} ${l.s}px system-ui,sans-serif`;
      ctx.textAlign = 'center'; ctx.fillText(l.t, l.x, l.y);
    }
  }
  ctx.restore();
}
export const ART_A = ['bull', 'gate', 'coin', 'horseshoe', 'cactus', 'mesa', 'nugget', 'spur', 'lantern', 'wheel', 'canteen', 'lasso'];
export const ART_B = ['bull', 'moneybull', 'horseshoe', 'cactus', 'mesa', 'nugget', 'spur', 'lantern', 'wheel', 'canteen', 'lasso'];
