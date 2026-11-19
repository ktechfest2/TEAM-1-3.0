import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDrizzle } from '@nestjs/drizzle';
import { and, count, eq, gt } from 'drizzle-orm';
import type { Env } from '../config/env.js';
import type { Database } from '../database/database.module.js';
import { whatsappMessages } from '../database/schema.js';
import { MessagingCore, type Reply, type TypedFigures } from '../messaging/core.service.js';
import { EMERGENCY_TEXT } from '../whatsapp/knowledge.js';
import { findAreaCode, isEmergency, parseTypedFigures, wantsCaptureLink } from '../whatsapp/parse.js';
import { Contacts, type Contact } from './contacts.js';
import { TwoWaySms } from './sms-client.js';

const MESSAGES_PER_10_MIN = 15;

/** Kept short: SMS are charged per 160 characters */
const HELP = [
  'TrustElect (unofficial citizen results):',
  '- Text a polling unit, ward or LGA code, e.g. 24-05-01-003',
  '- PU 24-05-01-003 APC 112 LP 98 PDP 140 to send figures',
  '- PHOTO for a camera link',
  'In danger? Call 112.',
].join('\n');

/** Two-way SMS (Sprint 10): the same rules and answers as WhatsApp, in plain text. */
@Injectable()
export class SmsService {
  private readonly logger = new Logger('SMS');
  private queue: Promise<void> = Promise.resolve();

  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly config: ConfigService<Env, true>,
    private readonly contacts: Contacts,
    private readonly core: MessagingCore,
    private readonly sms: TwoWaySms,
  ) {}

  /** Records the message (ignoring repeats by id) and queues it */
  async receive(m: { id: string; from: string; text: string }) {
    const [fresh] = await this.db
      .insert(whatsappMessages)
      .values({ waMessageId: `sms:${m.id}`, direction: 'in', kind: 'sms', status: 'received' })
      .onConflictDoNothing()
      .returning({ id: whatsappMessages.id });
    if (!fresh) return;
    this.queue = this.queue.then(() => this.handle(m, fresh.id).catch((err: Error) => this.logger.error(`sms ${fresh.id}: ${err.message}`)));
  }

  idle() {
    return this.queue;
  }

  private async handle(m: { from: string; text: string }, rowId: number) {
    const contact = await this.contacts.forPhone(m.from);
    await this.db.update(whatsappMessages).set({ contactId: contact.id }).where(eq(whatsappMessages.id, rowId));
    const [{ n }] = await this.db
      .select({ n: count() })
      .from(whatsappMessages)
      .where(and(eq(whatsappMessages.contactId, contact.id), eq(whatsappMessages.direction, 'in'), gt(whatsappMessages.createdAt, new Date(Date.now() - 600_000))));
    if (n > MESSAGES_PER_10_MIN) return;

    const text = m.text.trim();
    if (isEmergency(text)) return this.reply(contact, EMERGENCY_TEXT);
    if (/^stop\b/i.test(text)) {
      await this.contacts.update(contact.id, { consentAt: null, declinedAt: new Date() });
      return this.reply(contact, 'TrustElect will not use your number again unless you text YES.');
    }
    if (!contact.consentAt) {
      if (/^(yes|y|agree|i agree)\b/i.test(text)) {
        await this.contacts.update(contact.id, { consentAt: new Date(), declinedAt: null });
        return this.reply(contact, `Thank you.\n${HELP}`);
      }
      return this.reply(
        contact,
        `TrustElect records polling unit results. Your number is stored encrypted, counts you as one witness and is never shown. Privacy: ${this.config.get('WEB_ORIGIN', { infer: true })}/privacy\nReply YES to agree, STOP to opt out.`,
      );
    }

    // Choosing the election for figures sent earlier: "1", "2", …
    const pending = contact.pendingFigures as (TypedFigures & { options?: string[] }) | null;
    if (pending?.options && /^\d{1,2}$/.test(text)) {
      const electionId = pending.options[Number(text) - 1];
      await this.contacts.update(contact.id, { pendingFigures: null });
      if (!electionId) return this.reply(contact, 'That number is not on the list. Please send the figures again.');
      return this.send(contact, await this.core.recordFigures(this.phone(contact), 'sms', electionId, pending));
    }

    const typed = parseTypedFigures(text);
    if (typed) {
      if ('error' in typed) return this.reply(contact, `${typed.error}\nFormat: PU 24-05-01-003 APC 112 LP 98 PDP 140`);
      const r = await this.core.typedFigures(this.phone(contact), 'sms', typed);
      if (!('choose' in r)) return this.send(contact, r);
      await this.contacts.update(contact.id, { pendingFigures: { ...typed, options: r.choose.map((e) => e.id) } });
      return this.reply(contact, `Which election? Reply with the number:\n${r.choose.map((e, i) => `${i + 1}. ${e.title}`).join('\n')}`);
    }
    if (wantsCaptureLink(text)) return this.send(contact, await this.core.captureLink(this.phone(contact), 'sms'));
    const code = findAreaCode(text);
    if (code) return this.send(contact, await this.core.lookup(code, 'plain'));
    return this.reply(contact, HELP);
  }

  private phone(contact: Contact) {
    return this.contacts.phoneOf(contact);
  }

  private async send(contact: Contact, r: Reply) {
    if (r.rememberUnit) await this.contacts.update(contact.id, { rememberedUnitCode: r.rememberUnit });
    return this.reply(contact, r.text);
  }

  private async reply(contact: Contact, text: string) {
    const ok = await this.sms.send(this.phone(contact), text);
    await this.db.insert(whatsappMessages).values({
      waMessageId: `sms-out:${contact.id}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
      contactId: contact.id,
      direction: 'out',
      kind: 'sms',
      status: ok ? 'sent' : 'failed',
    });
  }
}
