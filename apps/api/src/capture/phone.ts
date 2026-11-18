/**
 * Nigerian mobile numbers: accepts 0803 123 4567, 08031234567, 2348031234567,
 * +234 803 123 4567 and returns E.164 (+2348031234567), or null if not a mobile number.
 */
export function normaliseNigerianMobile(input: string): string | null {
  const digits = input.replace(/[\s().-]/g, '');
  const match = /^(?:\+?234|0)([789][01]\d{8})$/.exec(digits);
  return match ? `+234${match[1]}` : null;
}

/** Shows only the last three digits, for confirmations: +234 *** *** *567 */
export function maskPhone(e164: string): string {
  return `+234 *** *** *${e164.slice(-3)}`;
}
