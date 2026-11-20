import sharp from 'sharp';
import { TEMPLATE, TEMPLATE_PARTIES, TEMPLATE_PNG_BASE64 } from './poster-template.js';

/** 5x7 dot glyphs: the API image has no fonts, so figures are drawn as shapes */
const GLYPHS: Record<string, string[]> = {
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11111', '00010', '00100', '00010', '00001', '10001', '01110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
};

/** Figures written like a pen: dots of ink, slightly uneven */
function written(text: string, x: number, y: number, dot: number, rnd: () => number, colour = '#1d3f9e') {
  let out = '';
  let cx = x;
  for (const ch of text) {
    const g = GLYPHS[ch];
    if (!g) {
      cx += dot * 4;
      continue;
    }
    g.forEach((row, r) =>
      [...row].forEach((bit, c) => {
        if (bit === '1') {
          const jitter = (rnd() - 0.5) * dot * 0.35;
          out += `<circle cx="${(cx + c * dot + jitter).toFixed(1)}" cy="${(y + r * dot + jitter).toFixed(1)}" r="${(dot * 0.55).toFixed(1)}" fill="${colour}"/>`;
        }
      }),
    );
    cx += dot * 6.2;
  }
  return out;
}

export interface PosterFigures {
  unitCode: string;
  partyVotes: Record<string, number>;
  totalValid: number;
  rejected: number;
  stamped: boolean;
}

/** Deterministic random numbers, so a seed run can be repeated */
export function random(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

const template = Buffer.from(TEMPLATE_PNG_BASE64, 'base64');

/** The sample poster with its figures, as a witness would photograph it (each call a different angle and light) */
export async function posterPhoto(f: PosterFigures, rnd: () => number): Promise<Buffer> {
  const { width: W, height: H, row0, rowHeight, yEnd } = TEMPLATE;
  let marks = written(f.unitCode, 262, 196, 3.4, rnd);
  TEMPLATE_PARTIES.forEach((p, i) => {
    marks += written(String(f.partyVotes[p] ?? 0), 360, row0 + i * rowHeight + 10, 3, rnd);
  });
  marks += written(String(f.totalValid), 360, yEnd + 26, 3.4, rnd);
  marks += written(String(f.rejected), 360, yEnd + 76, 3.4, rnd);
  // Signature: a pen stroke
  const sy = yEnd + 150;
  marks += `<path d="M345 ${sy} c 20 -30, 35 25, 55 -8 s 30 -20, 45 6 s 25 10, 60 -14 s 30 5, 50 2" fill="none" stroke="#1d3f9e" stroke-width="3" stroke-linecap="round"/>`;
  if (f.stamped) {
    const sx = 560 + rnd() * 120, sty = yEnd + 40 + rnd() * 60;
    marks += `<g opacity="0.55" transform="rotate(${(rnd() * 40 - 20).toFixed(0)} ${sx} ${sty})"><circle cx="${sx}" cy="${sty}" r="62" fill="none" stroke="#6a2c91" stroke-width="7"/><circle cx="${sx}" cy="${sty}" r="44" fill="none" stroke="#6a2c91" stroke-width="3"/><rect x="${sx - 34}" y="${sty - 8}" width="68" height="16" fill="#6a2c91"/></g>`;
  }
  const poster = await sharp(template)
    .composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${marks}</svg>`) }])
    .png()
    .toBuffer();

  // A phone photo: the poster on a wall, at a slight angle, in uneven light
  const scale = 0.78 + rnd() * 0.17;
  const angle = rnd() * 10 - 5;
  const placed = await sharp(poster)
    .resize(Math.round(W * scale))
    .rotate(angle, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .modulate({ brightness: 0.82 + rnd() * 0.3 })
    .png()
    .toBuffer();
  const meta = await sharp(placed).metadata();
  const CW = 900, CH = 1200;
  const wall = { r: Math.round(150 + rnd() * 80), g: Math.round(130 + rnd() * 80), b: Math.round(100 + rnd() * 80) };
  const left = Math.max(0, Math.round((CW - (meta.width ?? 0)) * rnd()));
  const top = Math.max(0, Math.round((CH - (meta.height ?? 0)) * rnd()));
  const shade = `<svg xmlns="http://www.w3.org/2000/svg" width="${CW}" height="${CH}"><defs><linearGradient id="g" x1="${rnd()}" y1="0" x2="${rnd()}" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="${(rnd() * 0.25).toFixed(2)}"/><stop offset="1" stop-color="#000" stop-opacity="${(rnd() * 0.35).toFixed(2)}"/></linearGradient></defs><rect width="${CW}" height="${CH}" fill="url(#g)"/></svg>`;
  return sharp({ create: { width: CW, height: CH, channels: 3, background: wall } })
    .composite([
      { input: placed, left: Math.min(left, CW - 1), top: Math.min(top, CH - 1) },
      { input: Buffer.from(shade) },
    ])
    .jpeg({ quality: 78 })
    .toBuffer();
}
