import { keypadArea } from './ussd.service.js';

describe('USSD keypad codes', () => {
  it('reads codes typed without dashes', () => {
    expect(keypadArea('240501003')).toEqual({ level: 'polling_unit', code: '24-05-01-003' });
    expect(keypadArea('240501')).toEqual({ level: 'ward', code: '24-05-01' });
    expect(keypadArea('2405')).toEqual({ level: 'lga', code: '24-05' });
    expect(keypadArea('24-05-01-003')).toEqual({ level: 'polling_unit', code: '24-05-01-003' });
  });
  it('rejects anything else', () => {
    expect(keypadArea('12345')).toBeNull();
    expect(keypadArea('990501003')).toBeNull();
  });
});
