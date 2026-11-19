import sharp from 'sharp';

/**
 * Perceptual "difference hash" of a photo: 64 bits from a 9×8 grey thumbnail. The same picture
 * re-saved, resized or recompressed keeps (almost) the same hash; two people photographing the
 * same poster from their own positions get clearly different ones.
 */
export async function dHash(bytes: Buffer): Promise<string | null> {
  try {
    const data = await sharp(bytes).rotate().grayscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer();
    let bits = 0n;
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) bits = (bits << 1n) | (data[y * 9 + x] > data[y * 9 + x + 1] ? 1n : 0n);
    }
    return bits.toString(16).padStart(16, '0');
  } catch {
    return null;
  }
}

/** Number of differing bits between two hashes */
export function hamming(a: string, b: string): number {
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let n = 0;
  while (x) {
    n += Number(x & 1n);
    x >>= 1n;
  }
  return n;
}

/** At or below this distance two photos are treated as the same picture */
export const SAME_PICTURE_DISTANCE = 4;
