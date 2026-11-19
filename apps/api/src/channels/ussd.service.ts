import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { parseUnitCode } from '@trustelect/shared';
import type { Env } from '../config/env.js';
import { MessagingCore, type Area } from '../messaging/core.service.js';
import { Contacts } from './contacts.js';
import { TwoWaySms } from './sms-client.js';

/** A USSD screen holds about 182 characters */
const MAX = 180;
const fit = (text: string) => (text.length <= MAX ? text : `${text.slice(0, MAX - 1).trimEnd()}…`);
const con = (text: string) => `CON ${fit(text)}`;
const end = (text: string) => `END ${fit(text)}`;

/**
 * USSD keypads have no hyphen: codes are typed as digits only.
 * 240501003 → polling unit 24-05-01-003; 240501 → ward 24-05-01; 2405 → LGA 24-05.
 */
export function keypadArea(input: string): Area | null {
  const raw = input.trim();
  if (/[-/]/.test(raw)) {
    const unit = parseUnitCode(raw);
    if (unit) return { level: 'polling_unit', code: unit.unit };
  }
  const d = raw.replace(/\D/g, '');
  if (d.length === 9) {
    const unit = parseUnitCode(`${d.slice(0, 2)}-${d.slice(2, 4)}-${d.slice(4, 6)}-${d.slice(6)}`);
    return unit ? { level: 'polling_unit', code: unit.unit } : null;
  }
  if (d.length === 6) return { level: 'ward', code: `${d.slice(0, 2)}-${d.slice(2, 4)}-${d.slice(4)}` };
  if (d.length === 4) return { level: 'lga', code: `${d.slice(0, 2)}-${d.slice(2)}` };
  return null;
}

/** Short summary of a lookup for one USSD screen */
function compact(text: string) {
  return text
    .replace(/\n{2,}/g, '\n')
    .replace(/Citizen-collated, unofficial\.( Not a projection\.)?( More: \S+)?/, '')
    .trim();
}

/**
 * USSD menu (Sprint 10, CNT-08, CAP-06): Africa's Talking sends the whole session so far as
 * "1*240501003*…"; each request answers with the next screen (CON) or the last one (END).
 */
@Injectable()
export class UssdService {
  /**
   * Sessions in which the consent screen was shown (so its answer is one of the steps).
   * USSD sessions last a few minutes at most; entries expire after 10.
   */
  private readonly consentShown = new Map<string, number>();

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly contacts: Contacts,
    private readonly core: MessagingCore,
    private readonly sms: TwoWaySms,
  ) {}

  async handle(sessionId: string, phone: string, text: string): Promise<string> {
    const now = Date.now();
    for (const [id, at] of this.consentShown) if (now - at > 600_000) this.consentShown.delete(id);
    const steps = text === '' ? [] : text.split('*');
    if (!steps.length) {
      return con('TrustElect (unofficial)\n1. Check a result\n2. Send result figures\n3. Camera link by SMS\n4. Emergency help');
    }
    switch (steps[0]) {
      case '1':
        return this.checkResult(steps.slice(1));
      case '2':
      case '3':
        return this.withConsent(sessionId, phone, steps[0], steps.slice(1));
      case '4':
        return end('In danger? Move to safety and call 112 now. Tell the police at the polling unit. Report offences to INEC.');
      default:
        return end('Invalid choice. Dial again.');
    }
  }

  private async checkResult(rest: string[]) {
    if (!rest.length) return con('Enter the polling unit code without dashes, e.g. 240501003 (ward 240501, LGA 2405):');
    const area = keypadArea(rest[0]);
    if (!area) return end('That is not a valid code. Polling unit codes have 9 digits, e.g. 240501003.');
    const r = await this.core.lookup(area, 'plain');
    return end(compact(r.text));
  }

  /** Sending figures or a link stores the number, so the voter agrees first (once) */
  private async withConsent(sessionId: string, phone: string, choice: string, rest: string[]) {
    const contact = await this.contacts.forPhone(phone);
    let after = rest;
    if (!contact.consentAt || this.consentShown.has(sessionId)) {
      if (!rest.length) {
        this.consentShown.set(sessionId, Date.now());
        return con(`Your number is stored encrypted, counts you as one witness and is never shown. Privacy: trustelect.web.app/privacy\n1. I agree\n2. Cancel`);
      }
      if (rest[0] !== '1') return end('Cancelled. Nothing was stored.');
      if (!contact.consentAt) await this.contacts.update(contact.id, { consentAt: new Date(), declinedAt: null });
      after = rest.slice(1);
    }
    return choice === '3' ? this.sendLink(phone) : this.sendFigures(phone, after);
  }

  private async sendLink(phone: string) {
    const r = await this.core.captureLink(phone, 'ussd');
    if (!r.text.includes('/capture?link=')) return end(r.text);
    const sent = await this.sms.send(phone, r.text);
    return end(sent ? 'We have sent you an SMS with a one-time camera link. Open it at the polling unit.' : 'Sorry, the SMS could not be sent. Try again shortly.');
  }

  private async sendFigures(phone: string, rest: string[]) {
    if (!rest.length) return con('Enter the polling unit code without dashes, e.g. 240501003:');
    const area = keypadArea(rest[0]);
    if (!area || area.level !== 'polling_unit') return end('That is not a valid polling unit code (9 digits, e.g. 240501003).');
    const open = await this.core.openElectionsFor(area.code);
    if (open === null) return end(`${area.code} is not in the polling unit register.`);
    if (!open.length) return end(`No election is open for results at ${area.code}.`);

    let i = 1;
    let election = open[0];
    if (open.length > 1) {
      if (rest.length < 2) return con(`Which election?\n${open.slice(0, 5).map((e, n) => `${n + 1}. ${e.title}`).join('\n')}`);
      const picked = open[Number(rest[1]) - 1];
      if (!picked) return end('Invalid choice. Dial again.');
      election = picked;
      i = 2;
    }

    const ballot = await this.core.ballot(election.id);
    const votes = rest.slice(i, i + ballot.length);
    if (votes.length < ballot.length) {
      if (votes.length && !/^\d{1,6}$/.test(votes.at(-1)!)) return end('Votes must be numbers. Dial again.');
      return con(`${area.code}\n${ballot[votes.length]} votes:`);
    }
    if (votes.some((v) => !/^\d{1,6}$/.test(v))) return end('Votes must be numbers. Dial again.');
    const summary = ballot.map((p, n) => `${p} ${Number(votes[n])}`).join(' ');
    const confirm = rest[i + ballot.length];
    if (confirm === undefined) return con(`${area.code}: ${summary}\n1. Send\n2. Cancel`);
    if (confirm !== '1') return end('Cancelled. Nothing was sent.');
    const r = await this.core.recordFigures(phone, 'ussd', election.id, {
      unitCode: area.code,
      votes: Object.fromEntries(ballot.map((p, n) => [p, Number(votes[n])])),
    });
    return end(r.text.replace(/ If you are at the polling unit.*$/s, ''));
  }
}
