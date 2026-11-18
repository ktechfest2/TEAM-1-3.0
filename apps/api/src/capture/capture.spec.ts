import { imageType } from './capture.service.js';
import { maskPhone, normaliseNigerianMobile } from './phone.js';

describe('normaliseNigerianMobile', () => {
  it('accepts common ways of writing Nigerian mobile numbers', () => {
    for (const input of ['08031234567', '0803 123 4567', '+234 803 123 4567', '2348031234567', '(0803) 123-4567']) {
      expect(normaliseNigerianMobile(input)).toBe('+2348031234567');
    }
    expect(normaliseNigerianMobile('07061234567')).toBe('+2347061234567');
    expect(normaliseNigerianMobile('09131234567')).toBe('+2349131234567');
  });

  it('rejects landlines, short numbers and foreign numbers', () => {
    for (const input of ['0123456789', '0803123456', '+447911123456', '08231234567', 'abc']) {
      expect(normaliseNigerianMobile(input)).toBeNull();
    }
  });

  it('masks all but the last three digits', () => {
    expect(maskPhone('+2348031234567')).toBe('+234 *** *** *567');
  });
});

describe('imageType', () => {
  it('detects JPEG and WebP from their first bytes', () => {
    expect(imageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]))).toBe('image/jpeg');
    expect(imageType(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')]))).toBe('image/webp');
  });

  it('rejects anything else, whatever it claims to be', () => {
    expect(imageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(imageType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBeNull();
    expect(imageType(Buffer.alloc(0))).toBeNull();
  });
});
