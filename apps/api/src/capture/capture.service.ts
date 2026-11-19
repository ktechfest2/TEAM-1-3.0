import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDrizzle } from '@nestjs/drizzle';
import { and, count, desc, eq, gt, isNull } from 'drizzle-orm';
import { randomInt } from 'node:crypto';
import type { Env } from '../config/env.js';
import type { Database } from '../database/database.module.js';
import { parseUnitCode } from '@trustelect/shared';
import { captureSessions, elections, lgas, pollingUnits, reporters, states, submissions, voterOtps, wards } from '../database/schema.js';
import { Encryptor, keyedHash, newToken, sha256 } from '../security/encryption.js';
import { EvidenceStorage } from '../storage/evidence-storage.js';
import { maskPhone, normaliseNigerianMobile } from './phone.js';
import { SmsSender } from './sms.js';

const OTP_MINUTES = 10;
const OTP_MAX_ATTEMPTS = 5;
/** Codes a phone number can request per window */
const OTP_PER_WINDOW = 3;
const OTP_WINDOW_MINUTES = 15;
/** Capture sessions cover a whole election day and the night after */
export const CAPTURE_SESSION_HOURS = 24;
/** Photos a voter can submit per hour (abuse prevention) */
const PHOTOS_PER_HOUR = 20;
export const MAX_PHOTO_BYTES = 6 * 1024 * 1024;

export interface CaptureVoter {
  sessionId: string;
  reporterId: string;
  phoneMasked: string;
  expiresAt: Date;
}

export interface PhotoMeta {
  electionId: string;
  clientId: string;
  /** Polling unit code entered by the voter (from their voter's card) */
  unitCode: string;
  capturedAt?: Date;
  latitude?: number;
  longitude?: number;
  accuracy?: number;
}

@Injectable()
export class CaptureService {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly config: ConfigService<Env, true>,
    private readonly encryptor: Encryptor,
    private readonly sms: SmsSender,
    private readonly storage: EvidenceStorage,
  ) {}

  private phoneHash(e164: string) {
    return keyedHash(this.config.get('PHONE_HASH_KEY', { infer: true }), e164);
  }

  /** Sends a 6-digit code. Returns the code itself only outside production, for local testing. */
  async requestCode(rawPhone: string): Promise<{ phoneMasked: string; devCode?: string }> {
    const phone = normaliseNigerianMobile(rawPhone);
    if (!phone) throw new BadRequestException('Enter a Nigerian mobile number, for example 0803 123 4567');
    const phoneHash = this.phoneHash(phone);

    const [blocked] = await this.db
      .select({ blockedAt: reporters.blockedAt })
      .from(reporters)
      .where(eq(reporters.phoneHash, phoneHash))
      .limit(1);
    if (blocked?.blockedAt) throw new ForbiddenException('This number cannot submit to TrustElect');

    const since = new Date(Date.now() - OTP_WINDOW_MINUTES * 60_000);
    const [{ n }] = await this.db
      .select({ n: count() })
      .from(voterOtps)
      .where(and(eq(voterOtps.phoneHash, phoneHash), gt(voterOtps.createdAt, since)));
    if (n >= OTP_PER_WINDOW) {
      throw new HttpException('Too many codes requested. Wait 15 minutes and try again.', HttpStatus.TOO_MANY_REQUESTS);
    }

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await this.db.insert(voterOtps).values({
      phoneHash,
      codeHash: sha256(`${phoneHash}:${code}`),
      expiresAt: new Date(Date.now() + OTP_MINUTES * 60_000),
    });

    // Origin-bound format lets phones offer the code automatically (last line: @domain #code)
    const domain = new URL(this.config.get('WEB_ORIGIN', { infer: true })).hostname;
    await this.sms.send(phone, `Your TrustElect code is ${code}. It expires in ${OTP_MINUTES} minutes.\n\n@${domain} #${code}`);

    // The code is shown on screen only in development with the log provider, never when a real SMS is sent
    const showCode =
      this.config.get('NODE_ENV', { infer: true }) !== 'production' &&
      this.config.get('SMS_PROVIDER', { infer: true }) === 'log';
    return { phoneMasked: maskPhone(phone), ...(showCode ? { devCode: code } : {}) };
  }

  /** Checks the code, records consent and opens a capture session. Returns the session token. */
  async verifyCode(rawPhone: string, code: string): Promise<{ token: string; voter: CaptureVoter }> {
    const phone = normaliseNigerianMobile(rawPhone);
    if (!phone) throw new BadRequestException('Enter a Nigerian mobile number');
    const phoneHash = this.phoneHash(phone);

    const [otp] = await this.db
      .select()
      .from(voterOtps)
      .where(and(eq(voterOtps.phoneHash, phoneHash), isNull(voterOtps.consumedAt), gt(voterOtps.expiresAt, new Date())))
      .orderBy(desc(voterOtps.createdAt))
      .limit(1);
    if (!otp || otp.attempts >= OTP_MAX_ATTEMPTS) {
      throw new UnauthorizedException('This code has expired. Request a new one.');
    }
    if (otp.codeHash !== sha256(`${phoneHash}:${code}`)) {
      await this.db.update(voterOtps).set({ attempts: otp.attempts + 1 }).where(eq(voterOtps.id, otp.id));
      throw new UnauthorizedException('That code is not correct');
    }
    await this.db.update(voterOtps).set({ consumedAt: new Date() }).where(eq(voterOtps.id, otp.id));
    return this.openSession(phone, 'sms');
  }

  /**
   * Starts a capture session from a phone number alone (no SMS code). The number is
   * self-declared, so it identifies a witness but does not prove they are a separate person.
   */
  async startWithoutVerification(rawPhone: string): Promise<{ token: string; voter: CaptureVoter }> {
    const phone = normaliseNigerianMobile(rawPhone);
    if (!phone) throw new BadRequestException('Enter a Nigerian mobile number, for example 0803 123 4567');
    return this.openSession(phone, 'web');
  }

  /** Records consent for the number and opens a capture session. */
  private async openSession(phone: string, via: 'sms' | 'web'): Promise<{ token: string; voter: CaptureVoter }> {
    const phoneHash = this.phoneHash(phone);
    const [reporter] = await this.db
      .insert(reporters)
      .values({ phoneHash, phoneEncrypted: this.encryptor.encrypt(phone), consentAt: new Date() })
      .onConflictDoUpdate({ target: reporters.phoneHash, set: { consentAt: new Date() } })
      .returning({ id: reporters.id, blockedAt: reporters.blockedAt });
    if (reporter.blockedAt) throw new ForbiddenException('This number cannot submit to TrustElect');

    const { token, hash } = newToken();
    const expiresAt = new Date(Date.now() + CAPTURE_SESSION_HOURS * 3_600_000);
    const [session] = await this.db
      .insert(captureSessions)
      .values({ reporterId: reporter.id, tokenHash: hash, issuedVia: via, expiresAt })
      .returning({ id: captureSessions.id });

    return { token, voter: { sessionId: session.id, reporterId: reporter.id, phoneMasked: maskPhone(phone), expiresAt } };
  }

  async resolveSession(token: string): Promise<CaptureVoter | null> {
    const [row] = await this.db
      .select({
        sessionId: captureSessions.id,
        reporterId: reporters.id,
        phoneEncrypted: reporters.phoneEncrypted,
        blockedAt: reporters.blockedAt,
        expiresAt: captureSessions.expiresAt,
      })
      .from(captureSessions)
      .innerJoin(reporters, eq(reporters.id, captureSessions.reporterId))
      .where(and(eq(captureSessions.tokenHash, sha256(token)), gt(captureSessions.expiresAt, new Date())))
      .limit(1);
    if (!row || row.blockedAt) return null;
    return {
      sessionId: row.sessionId,
      reporterId: row.reporterId,
      phoneMasked: maskPhone(this.encryptor.decrypt(row.phoneEncrypted)),
      expiresAt: row.expiresAt,
    };
  }

  async endSession(voter: CaptureVoter) {
    await this.db.update(captureSessions).set({ expiresAt: new Date() }).where(eq(captureSessions.id, voter.sessionId));
  }

  /**
   * Accepts a live-camera photograph (CAP-01, CAP-03). Idempotent per clientId, so the
   * phone's offline queue can retry safely. Verification follows in Sprint 4.
   */
  async submitPhoto(voter: CaptureVoter, meta: PhotoMeta, bytes: Buffer) {
    const [existing] = await this.db
      .select({ id: submissions.id, status: submissions.status, receivedAt: submissions.receivedAt, imageSha256: submissions.imageSha256 })
      .from(submissions)
      .where(and(eq(submissions.reporterId, voter.reporterId), eq(submissions.clientId, meta.clientId)))
      .limit(1);
    if (existing) return { ...existing, duplicate: true };

    const type = imageType(bytes);
    if (!type) throw new BadRequestException('The photo must be a JPEG or WebP image');
    if (bytes.length > MAX_PHOTO_BYTES) throw new BadRequestException('The photo is too large');

    const [election] = await this.db
      .select({ status: elections.status, scopeLevel: elections.scopeLevel, scopeCode: elections.scopeCode })
      .from(elections)
      .where(eq(elections.id, meta.electionId))
      .limit(1);
    if (!election || election.status !== 'active') {
      throw new BadRequestException('This election is not accepting photographs');
    }

    // The voter's polling unit must exist and belong to this election's area
    const code = parseUnitCode(meta.unitCode);
    if (!code) throw new BadRequestException('Enter a valid polling unit code, for example 24-05-01-003');
    const [unit] = await this.db
      .select({ id: pollingUnits.id, code: pollingUnits.code, ward: wards.code, lga: lgas.code, state: states.code })
      .from(pollingUnits)
      .innerJoin(wards, eq(wards.id, pollingUnits.wardId))
      .innerJoin(lgas, eq(lgas.id, wards.lgaId))
      .innerJoin(states, eq(states.id, lgas.stateId))
      .where(eq(pollingUnits.code, code.unit))
      .limit(1);
    if (!unit) throw new BadRequestException(`Polling unit ${code.unit} is not in INEC's register`);
    const scopeCode = { national: null, state: unit.state, lga: unit.lga, ward: unit.ward, polling_unit: unit.code }[election.scopeLevel];
    if (election.scopeLevel !== 'national' && scopeCode !== election.scopeCode) {
      throw new BadRequestException(`Polling unit ${unit.code} is not part of this election's area`);
    }

    const hourAgo = new Date(Date.now() - 3_600_000);
    const [{ n }] = await this.db
      .select({ n: count() })
      .from(submissions)
      .where(and(eq(submissions.reporterId, voter.reporterId), gt(submissions.receivedAt, hourAgo)));
    if (n >= PHOTOS_PER_HOUR) {
      throw new HttpException('Too many photos in the last hour. Try again later.', HttpStatus.TOO_MANY_REQUESTS);
    }

    const digest = sha256(bytes);
    const key = await this.storage.put(digest, bytes, type === 'image/webp' ? 'webp' : 'jpg');

    const now = Date.now();
    // A capture time in the future (beyond small clock drift) is not trusted
    const capturedAt = meta.capturedAt && meta.capturedAt.getTime() <= now + 5 * 60_000 ? meta.capturedAt : null;

    const [row] = await this.db
      .insert(submissions)
      .values({
        electionId: meta.electionId,
        pollingUnitId: unit.id,
        reporterId: voter.reporterId,
        kind: 'photo',
        channel: 'web',
        status: 'pending',
        capturedAt,
        latitude: meta.latitude ?? null,
        longitude: meta.longitude ?? null,
        locationAccuracy: meta.accuracy ?? null,
        imageKey: key,
        imageSha256: digest,
        imageBytes: bytes.length,
        imageType: type,
        clientId: meta.clientId,
      })
      .onConflictDoNothing({ target: [submissions.reporterId, submissions.clientId] })
      .returning({ id: submissions.id, status: submissions.status, receivedAt: submissions.receivedAt, imageSha256: submissions.imageSha256 });

    if (!row) {
      // A parallel retry inserted it first
      const [again] = await this.db
        .select({ id: submissions.id, status: submissions.status, receivedAt: submissions.receivedAt, imageSha256: submissions.imageSha256 })
        .from(submissions)
        .where(and(eq(submissions.reporterId, voter.reporterId), eq(submissions.clientId, meta.clientId)))
        .limit(1);
      return { ...again, duplicate: true };
    }
    return { ...row, duplicate: false };
  }
}

/** Identifies JPEG and WebP by their first bytes, not by the declared content type. */
export function imageType(bytes: Buffer): 'image/jpeg' | 'image/webp' | null {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length > 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  return null;
}
