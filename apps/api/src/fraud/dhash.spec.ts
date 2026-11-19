import sharp from 'sharp';
import { dHash, hamming, SAME_PICTURE_DISTANCE } from './dhash.js';

/** A synthetic "poster": dark stripes on light paper, positions set by the seed */
async function poster(seed: number, width = 640) {
  const height = Math.round(width * 1.3);
  const stripes = Array.from({ length: 12 }, (_, i) => {
    const y = Math.round(((i * 37 + seed * 53) % 100) / 100 * height);
    const w = Math.round((((i * 61 + seed * 17) % 60) + 20) / 100 * width);
    return `<rect x="${Math.round(width * 0.08)}" y="${y}" width="${w}" height="${Math.round(height / 40)}" fill="#222"/>`;
  }).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#f4f1e8"/>${stripes}</svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer();
}

describe('perceptual hash', () => {
  it('matches the same picture re-saved and resized, not a different picture', async () => {
    const original = await poster(1);
    const resaved = await sharp(original).resize(480).jpeg({ quality: 55 }).toBuffer();
    const other = await poster(7);
    const [a, b, c] = await Promise.all([dHash(original), dHash(resaved), dHash(other)]);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(hamming(a!, b!)).toBeLessThanOrEqual(SAME_PICTURE_DISTANCE);
    expect(hamming(a!, c!)).toBeGreaterThan(SAME_PICTURE_DISTANCE);
  });

  it('returns null for something that is not an image', async () => {
    expect(await dHash(Buffer.from('not an image'))).toBeNull();
  });
});
