import { HttpException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDrizzle } from '@nestjs/drizzle';
import { and, count, eq, gt } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { CaptureService } from '../capture/capture.service.js';
import { normaliseNigerianMobile } from '../capture/phone.js';
import type { Env } from '../config/env.js';
import type { Database } from '../database/database.module.js';
import { lgas, whatsappContacts, whatsappMessages } from '../database/schema.js';
import { IncidentsService, MAX_EVIDENCE_BYTES } from '../incidents/incidents.service.js';
import { DANGER, INCIDENT_TYPES, type IncidentType } from '../incidents/rules.js';
import { KnowledgeService } from '../knowledge/knowledge.service.js';
import { MessagingCore, type Area, type Reply } from '../messaging/core.service.js';
import { Encryptor, keyedHash } from '../security/encryption.js';
import { Assistant } from './assistant.js';
import { WhatsAppClient } from './client.js';
import { EMERGENCY_TEXT, type Language } from './knowledge.js';
import { findAreaCode, findPlace, isEmergency, meansRememberedUnit, numbersIn, parseTypedFigures, wantsCaptureLink, wantsHelp } from './parse.js';

/** An incoming WhatsApp message, reduced to what TrustElect uses */
export type Inbound = {
  id: string;
  /** The sender's WhatsApp number, digits only (e.g. 2348031234567) */
  from: string;
  type: 'text' | 'button' | 'media' | 'audio' | 'other';
  text?: string;
  /** Quick-reply button or list choice */
  choice?: string;
  /** Voice note or image media id */
  mediaId?: string;
  mediaKind?: 'image';
};

type Contact = typeof whatsappContacts.$inferSelect;
type PendingFigures = { unitCode: string; votes: Record<string, number> };
type PendingReport = { type: IncidentType; claim?: string; unitCode?: string };

/** Messages per contact in 10 minutes before TrustElect asks them to slow down */
const MESSAGES_PER_10_MIN = 20;

const HELP = [
  'TrustElect: citizen-collated election results (unofficial; official results are declared by INEC).',
  '',
  'You can:',
  '• Send a polling unit code, e.g. 24-05-01-003, for its result (or a ward or LGA code)',
  '• Send PHOTO for a link to photograph the result poster',
  '• Type figures: PU 24-05-01-003 APC 112 LP 98 PDP 140',
  '• Ask a question about voting',
  '',
  'In danger? Call 112.',
].join('\n');

const CONSENT = [
  'Welcome to TrustElect, where voters record the result posters pasted at polling units.',
  '',
  'To use this service, TrustElect keeps your WhatsApp number encrypted, uses it to count you as one witness, and never shows it publicly. We do not keep the text of your messages. Privacy notice: {web}/privacy',
  '',
  'Do you agree?',
].join('\n');

/**
 * WhatsApp channel (Sprint 9): consent, typed figures (CAP-06), lookups (CNT-08, INF-03),
 * capture links (CAP-02, INF-06), emergencies (INF-08) and the assistant (INF-01 to 07).
 */
@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger('WhatsApp');
  /** Messages are handled one at a time, in arrival order */
  private queue: Promise<void> = Promise.resolve();

  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly config: ConfigService<Env, true>,
    private readonly encryptor: Encryptor,
    private readonly client: WhatsAppClient,
    private readonly assistant: Assistant,
    private readonly capture: CaptureService,
    private readonly knowledge: KnowledgeService,
    private readonly core: MessagingCore,
    private readonly incidents: IncidentsService,
  ) {}

  /** Records the message (ignoring Meta's repeats) and queues it for handling. */
  async receive(message: Inbound): Promise<void> {
    const [fresh] = await this.db
      .insert(whatsappMessages)
      .values({ waMessageId: message.id, direction: 'in', kind: message.type, status: 'received' })
      .onConflictDoNothing()
      .returning({ id: whatsappMessages.id });
    if (!fresh) return;
    this.queue = this.queue.then(() =>
      this.handle(message, fresh.id).catch((err: Error) => this.logger.error(`message ${fresh.id}: ${err.message}`)),
    );
  }

  /** Resolves when every queued message has been handled (tests, shutdown) */
  idle() {
    return this.queue;
  }

  /** Delivery tracking: sent, delivered, read, failed */
  async status(waMessageId: string, status: string, error?: string) {
    await this.db
      .update(whatsappMessages)
      .set({ status, error: error ?? null, updatedAt: new Date() })
      .where(and(eq(whatsappMessages.waMessageId, waMessageId), eq(whatsappMessages.direction, 'out')));
  }

  private async handle(m: Inbound, rowId: number) {
    const contact = await this.contactFor(m.from);
    await this.db.update(whatsappMessages).set({ contactId: contact.id }).where(eq(whatsappMessages.id, rowId));
    void this.client.markRead(m.id).catch(() => undefined);

    const [{ n }] = await this.db
      .select({ n: count() })
      .from(whatsappMessages)
      .where(and(eq(whatsappMessages.contactId, contact.id), eq(whatsappMessages.direction, 'in'), gt(whatsappMessages.createdAt, new Date(Date.now() - 600_000))));
    if (n > MESSAGES_PER_10_MIN) {
      if (n === MESSAGES_PER_10_MIN + 1) await this.say(contact, 'You are sending messages very fast. Please wait a few minutes and try again.');
      return;
    }

    let text = m.text?.trim() ?? '';
    // INF-08: danger first, even before consent
    if (text && isEmergency(text)) return this.say(contact, EMERGENCY_TEXT);

    if (!contact.consentAt) return this.consentStep(contact, m.choice);

    if (m.choice?.startsWith('election:')) return this.figuresForElection(contact, m.choice.slice(9));
    if (m.choice?.startsWith('report:')) return this.reportType(contact, m.choice.slice(7));
    const report = contact.pendingReport as PendingReport | null;
    if (m.type === 'media' && report?.claim && m.mediaKind === 'image' && m.mediaId) return this.reportEvidence(contact, report, m.mediaId);
    if (m.type === 'media') {
      return this.say(
        contact,
        `Photos sent on WhatsApp cannot be accepted as results: they may be old, forwarded or edited. Use this one-time camera link instead (it works for ${30} minutes):\n${await this.linkFor(contact)}\n\nTo report an incident instead, send REPORT.`,
        { translate: true },
      );
    }
    if (m.type === 'audio') {
      // INF-05: a voice note is transcribed, shown back, then handled like typed text. Neither is stored.
      const audio = m.mediaId ? await this.client.downloadMedia(m.mediaId) : null;
      const heard = audio ? await this.assistant.transcribe(audio.bytes, audio.mimeType) : null;
      if (!heard) {
        return this.say(contact, 'Sorry, I could not understand that voice note. Please try again, keep it under 2 minutes, or type your message.', { translate: true });
      }
      if (heard.language !== contact.language) {
        await this.db.update(whatsappContacts).set({ language: heard.language }).where(eq(whatsappContacts.id, contact.id));
        contact.language = heard.language;
      }
      await this.say(contact, `🎙 “${heard.text}”`);
      text = heard.text;
      if (isEmergency(text)) return this.say(contact, EMERGENCY_TEXT, { translate: true });
    }
    if (!text) return this.say(contact, HELP, { translate: true });

    // Incident reports (INC-01, INC-02)
    if (/^cancel\b/i.test(text) && report) {
      await this.db.update(whatsappContacts).set({ pendingReport: null }).where(eq(whatsappContacts.id, contact.id));
      return this.say(contact, 'Report cancelled.', { translate: true });
    }
    const ref = /\b(TE-[A-Za-z0-9]{6})\b/i.exec(text);
    if (ref && text.length <= 30) return this.followReference(contact, ref[1]);
    if (/^report\b/i.test(text)) return this.startReport(contact);
    if (report && !report.claim) return this.reportClaim(contact, report, text);

    const typed = parseTypedFigures(text);
    if (typed) return 'error' in typed ? this.say(contact, `${typed.error}\nFormat: PU 24-05-01-003 APC 112 LP 98 PDP 140`) : this.typedFigures(contact, typed);
    if (wantsCaptureLink(text)) return this.sendLink(contact);
    if (wantsHelp(text) && text.length <= 30) return this.say(contact, HELP, { translate: true });
    const code = findAreaCode(text);
    if (code && text.length <= 40) return this.lookup(contact, code);
    // "Is anything happening at this unit?": answer with what is known about the remembered unit
    if (!code && contact.rememberedUnitCode && meansRememberedUnit(text)) {
      return this.lookup(contact, { level: 'polling_unit', code: contact.rememberedUnitCode });
    }

    // Free text: the assistant classifies it; figures and links still come from fixed code
    const u = await this.assistant.understand(text, {
      rememberedUnit: contact.rememberedUnitCode,
      language: contact.language as Language,
      facts: await this.knowledge.approvedFacts(),
    });
    if (u.language !== contact.language) {
      await this.db.update(whatsappContacts).set({ language: u.language }).where(eq(whatsappContacts.id, contact.id));
      contact.language = u.language;
    }
    switch (u.intent) {
      case 'emergency':
        return this.say(contact, EMERGENCY_TEXT, { translate: true });
      case 'capture_link':
        return this.sendLink(contact);
      case 'lookup': {
        // A code first, then a state or LGA named in the message, then the voter's unit from earlier
        const asked =
          findAreaCode(`${u.unit_code ?? ''} ${u.area_code ?? ''}`) ??
          findPlace(text, await this.lgaNames()) ??
          (contact.rememberedUnitCode ? { level: 'polling_unit' as const, code: contact.rememberedUnitCode } : null);
        if (!asked) return this.say(contact, 'Which polling unit, LGA or state? Send a polling unit code, for example 24-05-01-003 (it is printed on your voter\'s card), or name the LGA or state.', { translate: true });
        return this.lookup(contact, asked);
      }
      case 'voting_advice':
        return this.say(contact, 'TrustElect does not give voting advice or predict winners, and has no view on any party or candidate. Your vote is your choice, and it is secret.', { translate: true });
      case 'rumour_check':
        return this.say(
          contact,
          `TrustElect only reports what voters have photographed and verified. Send a polling unit, ward or LGA code to see what has been confirmed there. If it is not shown, nothing has been confirmed. Official results: https://inecelectionresults.ng`,
          { translate: true },
        );
      case 'question':
        if (u.answer) return this.say(contact, u.answer);
        return this.say(contact, 'I can only answer from official INEC information, and I do not have that answer. Please check https://inecnigeria.org.', { translate: true });
      case 'greeting':
        return this.say(contact, HELP, { translate: true });
      default:
        return this.say(contact, `I can help with election results and voting questions.\n\n${HELP}`, { translate: true });
    }
  }

  /* -------------------------------- contacts -------------------------------- */

  private async contactFor(waId: string): Promise<Contact> {
    const phone = `+${waId.replace(/\D/g, '')}`;
    const phoneHash = keyedHash(this.config.get('PHONE_HASH_KEY', { infer: true }), phone);
    const [row] = await this.db
      .insert(whatsappContacts)
      .values({ phoneHash, phoneEncrypted: this.encryptor.encrypt(phone), lastInboundAt: new Date() })
      .onConflictDoUpdate({ target: whatsappContacts.phoneHash, set: { lastInboundAt: new Date() } })
      .returning();
    return row;
  }

  private phoneOf(contact: Contact) {
    return this.encryptor.decrypt(contact.phoneEncrypted);
  }

  private async consentStep(contact: Contact, choice?: string) {
    if (choice === 'consent_yes') {
      await this.db.update(whatsappContacts).set({ consentAt: new Date(), declinedAt: null }).where(eq(whatsappContacts.id, contact.id));
      return this.say(contact, `Thank you.\n\n${HELP}`);
    }
    if (choice === 'consent_no') {
      await this.db.update(whatsappContacts).set({ declinedAt: new Date() }).where(eq(whatsappContacts.id, contact.id));
      return this.say(contact, 'OK. TrustElect will not use your number. If you change your mind, send START. In danger? Call 112.');
    }
    const id = await this.client.sendButtons(this.phoneOf(contact).slice(1), CONSENT.replace('{web}', this.config.get('WEB_ORIGIN', { infer: true })), [
      { id: 'consent_yes', title: 'I agree' },
      { id: 'consent_no', title: 'No thanks' },
    ]);
    await this.track(contact, id, 'buttons');
  }

  /* --------------------------------- replies -------------------------------- */

  /**
   * Sends text, translated into the voter's language when asked. A translation that changes
   * any number (figures, codes, phone numbers) is discarded and the English text is sent.
   */
  private async say(contact: Contact, text: string, options: { translate?: boolean } = {}) {
    let body = text;
    if (options.translate && contact.language !== 'en') {
      const translated = await this.assistant.translate(text, contact.language as Language);
      if (numbersIn(translated) === numbersIn(text)) body = translated;
    }
    const id = await this.client.sendText(this.phoneOf(contact).slice(1), body);
    await this.track(contact, id, 'text');
  }

  private async track(contact: Contact, waMessageId: string | null, kind: string) {
    await this.db.insert(whatsappMessages).values({
      waMessageId: waMessageId ?? `failed.${randomUUID()}`,
      contactId: contact.id,
      direction: 'out',
      kind,
      status: waMessageId ? 'sent' : 'failed',
    });
  }

  /* ----------------------------- incident reports ---------------------------- */

  private async startReport(contact: Contact) {
    const id = await this.client.sendList(
      this.phoneOf(contact).slice(1),
      'What do you want to report? Choose one. In danger? Call 112 first.',
      'Report type',
      Object.entries(INCIDENT_TYPES).map(([type, title]) => ({ id: `report:${type}`, title })),
    );
    await this.track(contact, id, 'list');
  }

  private async reportType(contact: Contact, type: string) {
    if (!(type in INCIDENT_TYPES)) return this.startReport(contact);
    await this.db.update(whatsappContacts).set({ pendingReport: { type } }).where(eq(whatsappContacts.id, contact.id));
    if (DANGER.has(type as IncidentType)) await this.say(contact, EMERGENCY_TEXT, { translate: true });
    return this.say(
      contact,
      `In one or two sentences, what happened? Include the polling unit code, e.g. 24-05-01-003${contact.rememberedUnitCode ? ` (or we will use ${contact.rememberedUnitCode})` : ''}. Do not name private people. Send CANCEL to stop.`,
      { translate: true },
    );
  }

  private async reportClaim(contact: Contact, report: PendingReport, text: string) {
    const code = findAreaCode(text);
    const unitCode = code?.level === 'polling_unit' ? code.code : contact.rememberedUnitCode;
    if (!unitCode) return this.say(contact, 'Please include the polling unit code, for example 24-05-01-003.', { translate: true });
    if (text.length < 10) return this.say(contact, 'Please describe what happened in a sentence.', { translate: true });
    await this.db
      .update(whatsappContacts)
      .set({ pendingReport: { ...report, claim: text.slice(0, 280), unitCode } })
      .where(eq(whatsappContacts.id, contact.id));
    return this.say(contact, `Now send a photo of what you saw at ${unitCode}. Take it now; old or forwarded photos count for less.`, { translate: true });
  }

  private async reportEvidence(contact: Contact, report: PendingReport, mediaId: string) {
    const phone = normaliseNigerianMobile(this.phoneOf(contact));
    if (!phone) return this.say(contact, 'Reports can only be sent from Nigerian mobile numbers.', { translate: true });
    const media = await this.client.downloadMedia(mediaId, MAX_EVIDENCE_BYTES);
    if (!media) return this.say(contact, 'Sorry, that photo could not be received. Please send it again.', { translate: true });
    try {
      const receipt = await this.incidents.submit(
        await this.capture.reporterFor(phone),
        { type: report.type, unitCode: report.unitCode!, claim: report.claim!, clientId: randomUUID(), channel: 'whatsapp' },
        media.bytes,
      );
      await this.db.update(whatsappContacts).set({ pendingReport: null, rememberedUnitCode: report.unitCode }).where(eq(whatsappContacts.id, contact.id));
      return this.say(
        contact,
        `Thank you. Your report number is ${receipt.reference}. We check the photo against what you said and label the report; serious reports are checked by a person before anything is published. Your number is never shown. Send ${receipt.reference} at any time to see its label.`,
        { translate: true },
      );
    } catch (err) {
      if (err instanceof HttpException) return this.say(contact, err.message);
      throw err;
    }
  }

  private async followReference(contact: Contact, reference: string) {
    try {
      const r = await this.incidents.byReference(reference);
      const state = r.published ? 'published' : r.status === 'hidden' ? 'not published' : 'not published yet';
      return this.say(contact, `${r.reference} (${r.typeText}, ${r.unitCode}): ${r.labelText}. ${state[0].toUpperCase()}${state.slice(1)}.`, { translate: true });
    } catch (err) {
      if (err instanceof HttpException) return this.say(contact, `No report found with the number ${reference.toUpperCase()}.`, { translate: true });
      throw err;
    }
  }

  /* ------------------------- shared with SMS and USSD ------------------------ */

  /** Sends a core reply and remembers the unit it was about (INF-02) */
  private async reply(contact: Contact, r: Reply) {
    if (r.rememberUnit) await this.db.update(whatsappContacts).set({ rememberedUnitCode: r.rememberUnit }).where(eq(whatsappContacts.id, contact.id));
    return this.say(contact, r.text, { translate: r.translate });
  }

  private async linkFor(contact: Contact) {
    const phone = normaliseNigerianMobile(this.phoneOf(contact));
    if (!phone) return `${this.config.get('WEB_ORIGIN', { infer: true })}/capture`;
    return this.capture.issueLink(phone, 'whatsapp');
  }

  private async sendLink(contact: Contact) {
    return this.reply(contact, await this.core.captureLink(this.phoneOf(contact), 'whatsapp'));
  }

  private lgaCache: { code: string; name: string }[] | null = null;

  /** LGA names from the register, to recognise places named in messages */
  private async lgaNames() {
    this.lgaCache ??= await this.db.select({ code: lgas.code, name: lgas.name }).from(lgas);
    return this.lgaCache;
  }

  private async lookup(contact: Contact, area: Area) {
    return this.reply(contact, await this.core.lookup(area, 'whatsapp'));
  }

  private async typedFigures(contact: Contact, figures: PendingFigures) {
    const r = await this.core.typedFigures(this.phoneOf(contact), 'whatsapp', figures);
    if (!('choose' in r)) return this.reply(contact, r);
    await this.db.update(whatsappContacts).set({ pendingFigures: figures }).where(eq(whatsappContacts.id, contact.id));
    const id = await this.client.sendList(
      this.phoneOf(contact).slice(1),
      `Which election are these figures for (${r.unitCode})?`,
      'Choose election',
      r.choose.slice(0, 10).map((e) => ({ id: `election:${e.id}`, title: e.title.slice(0, 24), description: e.title.length > 24 ? e.title : undefined })),
    );
    await this.track(contact, id, 'list');
  }

  private async figuresForElection(contact: Contact, electionId: string) {
    const pending = contact.pendingFigures as PendingFigures | null;
    if (!pending) return this.say(contact, 'Please send the figures again: PU 24-05-01-003 APC 112 LP 98 PDP 140', { translate: true });
    await this.db.update(whatsappContacts).set({ pendingFigures: null }).where(eq(whatsappContacts.id, contact.id));
    return this.reply(contact, await this.core.recordFigures(this.phoneOf(contact), 'whatsapp', electionId, pending));
  }
}
