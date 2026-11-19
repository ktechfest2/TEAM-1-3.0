import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';

export type Button = { id: string; title: string };
export type ListRow = { id: string; title: string; description?: string };

/** Sends WhatsApp messages. Returns the WhatsApp message id (null if not sent). */
export abstract class WhatsAppClient {
  abstract sendText(to: string, text: string): Promise<string | null>;
  /** Up to three quick-reply buttons (titles up to 20 characters) */
  abstract sendButtons(to: string, body: string, buttons: Button[]): Promise<string | null>;
  /** A list of up to ten choices (titles up to 24 characters) */
  abstract sendList(to: string, body: string, buttonLabel: string, rows: ListRow[]): Promise<string | null>;
  abstract markRead(messageId: string): Promise<void>;
}

export type SentMessage = { to: string; kind: 'text' | 'buttons' | 'list'; text: string; options?: string[] };

/** Development and tests: messages go to the log (numbers masked) and are kept in memory. */
@Injectable()
export class LogWhatsAppClient extends WhatsAppClient {
  private readonly logger = new Logger('WhatsApp');
  readonly sent: SentMessage[] = [];
  private seq = 0;

  private record(m: SentMessage) {
    this.sent.push(m);
    if (process.env.NODE_ENV !== 'test') this.logger.log(`to …${m.to.slice(-3)} [${m.kind}] ${m.text}${m.options ? ` (${m.options.join(' | ')})` : ''}`);
    return Promise.resolve(`log.${++this.seq}`);
  }
  sendText(to: string, text: string) {
    return this.record({ to, kind: 'text', text });
  }
  sendButtons(to: string, body: string, buttons: Button[]) {
    return this.record({ to, kind: 'buttons', text: body, options: buttons.map((b) => b.id) });
  }
  sendList(to: string, body: string, _label: string, rows: ListRow[]) {
    return this.record({ to, kind: 'list', text: body, options: rows.map((r) => r.id) });
  }
  async markRead() {}
}

/** Meta WhatsApp Cloud API. */
@Injectable()
export class CloudWhatsAppClient extends WhatsAppClient {
  private readonly logger = new Logger('WhatsApp');

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly http: typeof fetch = fetch,
  ) {
    super();
  }

  private async post(payload: object): Promise<string | null> {
    const version = this.config.get('WHATSAPP_GRAPH_VERSION', { infer: true });
    const phoneId = this.config.get('WHATSAPP_PHONE_NUMBER_ID', { infer: true });
    try {
      const res = await this.http(`https://graph.facebook.com/${version}/${phoneId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.get('WHATSAPP_ACCESS_TOKEN', { infer: true })}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ messaging_product: 'whatsapp', ...payload }),
        signal: AbortSignal.timeout(15_000),
      });
      const data = (await res.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message?: string; code?: number } };
      if (!res.ok) {
        this.logger.warn(`send failed: ${data.error?.code ?? res.status} ${data.error?.message ?? ''}`);
        return null;
      }
      return data.messages?.[0]?.id ?? null;
    } catch (err) {
      this.logger.warn(`send failed: ${(err as Error).message}`);
      return null;
    }
  }

  sendText(to: string, text: string) {
    return this.post({ to, type: 'text', text: { body: text.slice(0, 4096), preview_url: true } });
  }

  sendButtons(to: string, body: string, buttons: Button[]) {
    return this.post({
      to,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: body.slice(0, 1024) },
        action: { buttons: buttons.slice(0, 3).map((b) => ({ type: 'reply', reply: { id: b.id, title: b.title.slice(0, 20) } })) },
      },
    });
  }

  sendList(to: string, body: string, buttonLabel: string, rows: ListRow[]) {
    return this.post({
      to,
      type: 'interactive',
      interactive: {
        type: 'list',
        body: { text: body.slice(0, 1024) },
        action: {
          button: buttonLabel.slice(0, 20),
          sections: [
            {
              title: 'Choose one',
              rows: rows.slice(0, 10).map((r) => ({ id: r.id, title: r.title.slice(0, 24), description: r.description?.slice(0, 72) })),
            },
          ],
        },
      },
    });
  }

  async markRead(messageId: string) {
    await this.post({ status: 'read', message_id: messageId });
  }
}
