import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDrizzle } from '@nestjs/drizzle';
import { eq } from 'drizzle-orm';
import type { Env } from '../config/env.js';
import type { Database } from '../database/database.module.js';
import { whatsappContacts } from '../database/schema.js';
import { Encryptor, keyedHash } from '../security/encryption.js';

export type Contact = typeof whatsappContacts.$inferSelect;

/**
 * One record per phone number across WhatsApp, SMS and USSD (consent, remembered unit, pending
 * figures). The number is encrypted; its keyed hash is the same one used to count witnesses.
 */
@Injectable()
export class Contacts {
  constructor(
    @InjectDrizzle() private readonly db: Database,
    private readonly config: ConfigService<Env, true>,
    private readonly encryptor: Encryptor,
  ) {}

  /** E.164 (+234…) */
  static e164(raw: string) {
    return `+${raw.replace(/\D/g, '')}`;
  }

  async forPhone(raw: string): Promise<Contact> {
    const phone = Contacts.e164(raw);
    const phoneHash = keyedHash(this.config.get('PHONE_HASH_KEY', { infer: true }), phone);
    const [row] = await this.db
      .insert(whatsappContacts)
      .values({ phoneHash, phoneEncrypted: this.encryptor.encrypt(phone), lastInboundAt: new Date() })
      .onConflictDoUpdate({ target: whatsappContacts.phoneHash, set: { lastInboundAt: new Date() } })
      .returning();
    return row;
  }

  phoneOf(contact: Contact) {
    return this.encryptor.decrypt(contact.phoneEncrypted);
  }

  update(id: string, set: Partial<Pick<Contact, 'consentAt' | 'declinedAt' | 'rememberedUnitCode' | 'pendingFigures' | 'language'>>) {
    return this.db.update(whatsappContacts).set(set).where(eq(whatsappContacts.id, id));
  }
}
