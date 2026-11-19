import { anchorRecordText, canonicalJson, entryHashInput, readZip, sha256Hex } from '@trustelect/shared';
import { createHash } from 'node:crypto';
import { otsProofFile } from './anchor.service.js';
import { writeZip } from './zip.js';

describe('canonical records', () => {
  it('gives the same text whatever the key order, and drops undefined', () => {
    expect(canonicalJson({ b: 1, a: { d: [1, { y: 2, x: null }], c: 'é' }, u: undefined })).toBe('{"a":{"c":"é","d":[1,{"x":null,"y":2}]},"b":1}');
    expect(canonicalJson({ z: 1, a: 2 })).toBe(canonicalJson({ a: 2, z: 1 }));
    expect(canonicalJson({ t: new Date('2026-11-01T10:00:00Z') })).toBe('{"t":"2026-11-01T10:00:00.000Z"}');
    expect(() => canonicalJson({ n: Number.NaN })).toThrow();
  });

  it('hashes the same in the browser code as in Node', async () => {
    const text = entryHashInput({ seq: 1, entryType: 'audit', refId: '9', payloadSha256: 'ab', prevHash: '0'.repeat(64), createdAt: '2026-11-01T10:00:00.000Z' });
    expect(await sha256Hex(text)).toBe(createHash('sha256').update(text).digest('hex'));
    expect(await sha256Hex(new Uint8Array([1, 2, 3]))).toBe(createHash('sha256').update(Buffer.from([1, 2, 3])).digest('hex'));
  });
});

describe('evidence pack ZIP', () => {
  it('round-trips files byte for byte', () => {
    const photo = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x10, 0x80]);
    const zip = writeZip([
      { name: 'manifest.json', data: Buffer.from('{"a":1}') },
      { name: 'photos/ab.jpg', data: photo },
    ]);
    const files = readZip(new Uint8Array(zip));
    expect([...files.keys()]).toEqual(['manifest.json', 'photos/ab.jpg']);
    expect(Buffer.from(files.get('photos/ab.jpg')!)).toEqual(photo);
    expect(new TextDecoder().decode(files.get('manifest.json'))).toBe('{"a":1}');
  });

  it('rejects files that are not ZIPs', () => {
    expect(() => readZip(new Uint8Array(100))).toThrow(/Not a ZIP/);
  });
});

describe('OpenTimestamps proof file', () => {
  it('starts with the standard header, SHA-256 operation and the digest', () => {
    const digest = createHash('sha256').update(anchorRecordText({ seq: 5, hash: 'f'.repeat(64), createdAt: '2026-11-01T10:00:00.000Z' })).digest();
    const file = otsProofFile(digest, Buffer.from([0xf0, 0x10]));
    expect(file.subarray(0, 31).toString('hex')).toBe('004f70656e54696d657374616d7073000050726f6f6600bf89e2e884e89294');
    expect(file[31]).toBe(1);
    expect(file[32]).toBe(0x08);
    expect(file.subarray(33, 65)).toEqual(digest);
    expect(file.subarray(65)).toEqual(Buffer.from([0xf0, 0x10]));
  });
});
