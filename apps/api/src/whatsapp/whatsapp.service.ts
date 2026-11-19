import { HttpException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDrizzle } from '@nestjs/drizzle';
import { UNOFFICIAL_LABEL } from '@trustelect/shared';
import { and, asc, count, eq, gt, ne, or } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { ChainService } from '../chain/chain.service.js';
import { CaptureService } from '../capture/capture.service.js';
import { normaliseNigerianMobile } from '../capture/phone.js';
import type { Env } from '../config/env.js';
import type { Database } from '../database/database.module.js';
import {
  electionParties,
  elections,
  lgas,
  parties,
  pollingUnits,
  resultVersions,
  states,
  submissions,
  wards,
  whatsappContacts,
  whatsappMessages,
} from '../database/schema.js';
import { KnowledgeService } from '../knowledge/knowledge.service.js';
import { ResultsService } from '../results/results.service.js';
import { Encryptor, keyedHash } from '../security/encryption.js';
import { TallyService } from '../tally/tally.service.js';
import { figuresHash } from '../witnesses/engine.js';
import { WitnessService } from '../witnesses/witness.service.js';
import { Assistant } from './assistant.js';
import { WhatsAppClient } from './client.js';
import { EMERGENCY_TEXT, type Language } from './knowledge.js';
import { findAreaCode, isEmergency, meansRememberedUnit, numbersIn, parseTypedFigures, wantsCaptureLink, wantsHelp } from './parse.js';

/** An incoming WhatsApp message, reduced to what TrustElect uses */
export type Inbound = {
  id: string;
  /** The sender's WhatsApp number, digits only (e.g. 2348031234567) */
  from: string;
  type: 'text' | 'button' | 'media' | 'audio' | 'other';
  text?: string;
  /** Quick-reply button or list choice */
  choice?: string;
  /** Voice note media id */
  mediaId?: string;
};

type Contact = typeof whatsappContacts.$inferSelect;
type PendingFigures = { unitCode: string; votes: Record<string, number> };

/** Messages per contact in 10 minutes before TrustElect asks them to slow down */
const MESSAGES_PER_10_MIN = 20;
const TYPED_PER_HOUR = 10;

const UNIT_STATUS: Record<string, string> = {
  not_confirmed: 'No confirmed result yet',
  counted: 'Counted',
  provisional: 'Provisional: witnesses disagree, under review',
  disputed: 'Disputed: not counted until reviewed',
  resolved: 'Resolved by review',
};
const COMPARISON: Record<string, string> = {
  match: 'Matches the declared result',
  match_so_far: 'Matches the declared result so far',
  does_not_match: 'Does not match the declared result',
  possible_mismatch_low_confidence: 'Possible mismatch (low confidence)',
  conflicting_declarations: 'Conflicting declarations, under review',
  awaiting_data: 'No approved declaration to compare yet',
};

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
    private readonly results: ResultsService,
    private readonly tally: TallyService,
    private readonly witnesses: WitnessService,
    private readonly chain: ChainService,
    private readonly knowledge: KnowledgeService,
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
    if (m.type === 'media') {
      return this.say(
        contact,
        `Photos sent on WhatsApp cannot be accepted: they may be old, forwarded or edited. Use this one-time camera link instead (it works for ${30} minutes):\n${await this.linkFor(contact)}`,
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
        const asked = findAreaCode(`${u.unit_code ?? ''} ${u.area_code ?? ''}`) ?? (contact.rememberedUnitCode ? { level: 'polling_unit' as const, code: contact.rememberedUnitCode } : null);
        if (!asked) return this.say(contact, 'Which polling unit? Send its code, for example 24-05-01-003. It is printed on your voter\'s card.', { translate: true });
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

  /* ------------------------------ capture link ------------------------------ */

  private async linkFor(contact: Contact) {
    const phone = normaliseNigerianMobile(this.phoneOf(contact));
    if (!phone) return `${this.config.get('WEB_ORIGIN', { infer: true })}/capture`;
    return this.capture.issueLink(phone, 'whatsapp');
  }

  private async sendLink(contact: Contact) {
    if (!normaliseNigerianMobile(this.phoneOf(contact))) {
      return this.say(contact, `Results can only be sent from Nigerian mobile numbers. Open ${this.config.get('WEB_ORIGIN', { infer: true })}/capture on a phone with a Nigerian number.`, { translate: true });
    }
    try {
      const link = await this.linkFor(contact);
      return this.say(
        contact,
        `Open this link to photograph the EC60E result poster with your camera. It works once, for 30 minutes, and is linked to this number:\n${link}`,
        { translate: true },
      );
    } catch (err) {
      if (err instanceof HttpException) return this.say(contact, 'This number cannot send results to TrustElect.');
      throw err;
    }
  }

  /* --------------------------------- lookups -------------------------------- */

  private async lookup(contact: Contact, area: { level: 'polling_unit' | 'ward' | 'lga' | 'state'; code: string }) {
    if (area.level === 'polling_unit') return this.unitLookup(contact, area.code);

    const covering = (await this.db.select().from(elections).where(ne(elections.status, 'draft')).orderBy(asc(elections.electionDate)))
      .filter((e) => e.scopeLevel === 'national' || (e.scopeCode !== null && area.code.startsWith(e.scopeCode)));
    const blocks: string[] = [];
    let name = area.code;
    for (const e of covering) {
      try {
        const t = await this.tally.area(e.id, area.level, area.code);
        name = t.area.name;
        const votes = t.parties.map((p: { acronym: string }) => `${p.acronym} ${(t.totals.partyVotes[p.acronym] ?? 0).toLocaleString('en-NG')}`).join(' · ');
        blocks.push(
          [
            `*${e.title}*`,
            `Counted from ${t.totals.countedUnits.toLocaleString('en-NG')} of ${t.totals.totalUnits.toLocaleString('en-NG')} polling units`,
            t.totals.countedUnits ? votes : 'No counted polling units yet',
            t.totals.comparison ? COMPARISON[t.totals.comparison.status] : null,
          ]
            .filter(Boolean)
            .join('\n'),
        );
      } catch (err) {
        if (!(err instanceof NotFoundException) && !(err instanceof HttpException)) throw err;
      }
    }
    if (!blocks.length) return this.say(contact, `No published election covers ${area.code} yet, or that code is not in the register.`, { translate: true });
    const web = this.config.get('WEB_ORIGIN', { infer: true });
    return this.say(contact, `${name} (${area.code})\n\n${blocks.join('\n\n')}\n\n${UNOFFICIAL_LABEL}. Not a projection. More: ${web}/results/elections`);
  }

  private async unitLookup(contact: Contact, code: string) {
    let found;
    try {
      found = await this.results.publicUnitResults(code);
    } catch (err) {
      if (err instanceof NotFoundException || err instanceof HttpException) {
        return this.say(contact, `${code} is not in the polling unit register. Check the code on your voter's card or the result poster.`, { translate: true });
      }
      throw err;
    }
    await this.db.update(whatsappContacts).set({ rememberedUnitCode: found.unit.code }).where(eq(whatsappContacts.id, contact.id));
    const head = `${found.unit.name} (${found.unit.code})\n${found.unit.wardName} ward, ${found.unit.lgaName}, ${found.unit.stateName}`;
    if (!found.results.length) return this.say(contact, `${head}\n\nNo published election covers this polling unit yet.`);
    const blocks = found.results.map((r) => {
      const lines = [`*${r.election.title}*`, UNIT_STATUS[r.status] ?? r.status];
      if (r.figures) {
        lines.push(r.parties.map((p) => `${p.acronym} ${r.figures!.partyVotes[p.acronym] ?? 0}`).join(' · '));
        lines.push(`Total valid ${r.figures.totalValid}`);
        lines.push(`${r.confidence ? `${r.confidence[0].toUpperCase()}${r.confidence.slice(1)} confidence: ` : ''}${r.witnessCount} independent ${r.witnessCount === 1 ? 'witness' : 'witnesses'}`);
      }
      return lines.join('\n');
    });
    return this.say(contact, `${head}\n\n${blocks.join('\n\n')}\n\n${UNOFFICIAL_LABEL}.`);
  }

  /* ------------------------------ typed figures ----------------------------- */

  private async unitWithArea(code: string) {
    const [unit] = await this.db
      .select({ id: pollingUnits.id, code: pollingUnits.code, wardCode: wards.code, lgaCode: lgas.code, stateCode: states.code })
      .from(pollingUnits)
      .innerJoin(wards, eq(wards.id, pollingUnits.wardId))
      .innerJoin(lgas, eq(lgas.id, wards.lgaId))
      .innerJoin(states, eq(states.id, lgas.stateId))
      .where(eq(pollingUnits.code, code))
      .limit(1);
    return unit ?? null;
  }

  private async activeElectionsFor(unit: NonNullable<Awaited<ReturnType<WhatsAppService['unitWithArea']>>>) {
    return this.db
      .select({ id: elections.id, title: elections.title })
      .from(elections)
      .where(
        and(
          eq(elections.status, 'active'),
          or(
            eq(elections.scopeLevel, 'national'),
            and(eq(elections.scopeLevel, 'state'), eq(elections.scopeCode, unit.stateCode)),
            and(eq(elections.scopeLevel, 'lga'), eq(elections.scopeCode, unit.lgaCode)),
            and(eq(elections.scopeLevel, 'ward'), eq(elections.scopeCode, unit.wardCode)),
            and(eq(elections.scopeLevel, 'polling_unit'), eq(elections.scopeCode, unit.code)),
          ),
        ),
      )
      .orderBy(asc(elections.title));
  }

  private async typedFigures(contact: Contact, figures: PendingFigures) {
    const unit = await this.unitWithArea(figures.unitCode);
    if (!unit) return this.say(contact, `${figures.unitCode} is not in the polling unit register. Check the code on the result poster.`, { translate: true });
    const open = await this.activeElectionsFor(unit);
    if (!open.length) return this.say(contact, `No election is open for results at ${unit.code} right now.`, { translate: true });
    if (open.length === 1) return this.recordFigures(contact, open[0].id, figures);

    await this.db.update(whatsappContacts).set({ pendingFigures: figures }).where(eq(whatsappContacts.id, contact.id));
    const id = await this.client.sendList(
      this.phoneOf(contact).slice(1),
      `Which election are these figures for (${unit.code})?`,
      'Choose election',
      open.slice(0, 10).map((e) => ({ id: `election:${e.id}`, title: e.title.slice(0, 24), description: e.title.length > 24 ? e.title : undefined })),
    );
    await this.track(contact, id, 'list');
  }

  private async figuresForElection(contact: Contact, electionId: string) {
    const pending = contact.pendingFigures as PendingFigures | null;
    if (!pending) return this.say(contact, 'Please send the figures again: PU 24-05-01-003 APC 112 LP 98 PDP 140', { translate: true });
    await this.db.update(whatsappContacts).set({ pendingFigures: null }).where(eq(whatsappContacts.id, contact.id));
    return this.recordFigures(contact, electionId, pending);
  }

  /** CAP-06, WIT-06: typed figures are a supporting witness for a photographed version, never a version of their own */
  private async recordFigures(contact: Contact, electionId: string, figures: PendingFigures) {
    const phone = normaliseNigerianMobile(this.phoneOf(contact));
    if (!phone) return this.say(contact, 'Results can only be sent from Nigerian mobile numbers.', { translate: true });
    const unit = await this.unitWithArea(figures.unitCode);
    const [election] = unit ? (await this.activeElectionsFor(unit)).filter((e) => e.id === electionId) : [];
    if (!unit || !election) return this.say(contact, 'That election is not open for results at this polling unit.', { translate: true });

    const ballot = (
      await this.db
        .select({ acronym: parties.acronym })
        .from(electionParties)
        .innerJoin(parties, eq(parties.id, electionParties.partyId))
        .where(eq(electionParties.electionId, electionId))
        .orderBy(asc(electionParties.ballotOrder))
    ).map((p) => p.acronym.toUpperCase());
    const given = Object.keys(figures.votes);
    const unknown = given.filter((p) => !ballot.includes(p));
    const missing = ballot.filter((p) => !given.includes(p));
    if (unknown.length || missing.length) {
      return this.say(
        contact,
        [
          unknown.length ? `Not on this ballot: ${unknown.join(', ')}.` : null,
          missing.length ? `Missing: ${missing.join(', ')}.` : null,
          `Send every party on the poster, in this format:\nPU ${unit.code} ${ballot.map((p) => `${p} 0`).join(' ')}`,
        ]
          .filter(Boolean)
          .join('\n'),
      );
    }

    const reporterId = await this.capture.reporterFor(phone);
    const [{ recent }] = await this.db
      .select({ recent: count() })
      .from(submissions)
      .where(and(eq(submissions.reporterId, reporterId), eq(submissions.kind, 'typed'), gt(submissions.receivedAt, new Date(Date.now() - 3_600_000))));
    if (recent >= TYPED_PER_HOUR) return this.say(contact, 'Too many results from this number in the last hour. Try again later.', { translate: true });

    const extracted = { partyVotes: figures.votes, totalValid: Object.values(figures.votes).reduce((a, b) => a + b, 0), rejected: null, totalCast: null };
    const [row] = await this.db
      .insert(submissions)
      .values({
        electionId,
        pollingUnitId: unit.id,
        reporterId,
        kind: 'typed',
        channel: 'whatsapp',
        status: 'verified',
        extracted,
        clientId: randomUUID(),
        processedAt: new Date(),
      })
      .returning({ id: submissions.id });
    await this.chain.syncSubmission(row.id);
    await this.witnesses.recalculate(electionId, unit.id);
    await this.db.update(whatsappContacts).set({ rememberedUnitCode: unit.code }).where(eq(whatsappContacts.id, contact.id));

    const [version] = await this.db
      .select({ witnessCount: resultVersions.witnessCount })
      .from(resultVersions)
      .where(and(eq(resultVersions.electionId, electionId), eq(resultVersions.pollingUnitId, unit.id), eq(resultVersions.figuresHash, figuresHash(extracted))))
      .limit(1);
    const summary = ballot.map((p) => `${p} ${figures.votes[p]}`).join(' · ');
    if (version) {
      return this.say(
        contact,
        `Recorded for ${unit.code} (${election.title}): ${summary}.\nThese figures match a result photographed by ${version.witnessCount} ${version.witnessCount === 1 ? 'witness' : 'witnesses'}; yours is counted as supporting evidence. Thank you.`,
        { translate: true },
      );
    }
    return this.say(
      contact,
      `Recorded for ${unit.code} (${election.title}): ${summary}.\nNo photo of these figures has been verified yet. Typed figures support photos but never count on their own. If you are at the polling unit, send PHOTO for a camera link.`,
      { translate: true },
    );
  }
}
