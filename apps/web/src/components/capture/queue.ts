/**
 * Offline queue for photographs (CAP-04). Photos are kept in IndexedDB on the phone
 * and uploaded when the network is available. Each photo has a clientId, so the
 * server treats retries as the same submission. Once sent, the image bytes are
 * removed from the phone and only the receipt is kept.
 */

export type QueueStatus = 'waiting' | 'uploading' | 'sent' | 'failed';

export interface QueuedPhoto {
  clientId: string;
  electionId: string;
  electionTitle: string;
  blob: Blob | null;
  capturedAt: string;
  latitude?: number;
  longitude?: number;
  accuracy?: number;
  status: QueueStatus;
  attempts: number;
  lastError?: string;
  createdAt: string;
  sentAt?: string;
  sha256?: string;
}

const DB_NAME = 'trustelect-capture';
const STORE = 'photos';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'clientId' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = run(t.objectStore(STORE));
      t.oncomplete = () => resolve(req.result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  } finally {
    db.close();
  }
}

export const queue = {
  put: (item: QueuedPhoto) => tx('readwrite', (s) => s.put(item)),
  remove: (clientId: string) => tx('readwrite', (s) => s.delete(clientId)),
  all: async () =>
    (await tx<QueuedPhoto[]>('readonly', (s) => s.getAll())).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
};

export type FlushResult = 'done' | 'offline' | 'signed-out';

let flushing: Promise<FlushResult> | null = null;

/** Uploads every waiting photo. Only one flush runs at a time. */
export function flushQueue(onChange: () => void): Promise<FlushResult> {
  flushing ??= runFlush(onChange).finally(() => {
    flushing = null;
  });
  return flushing;
}

async function runFlush(onChange: () => void): Promise<FlushResult> {
  const items = (await queue.all()).filter((i) => i.status === 'waiting' || i.status === 'uploading');
  for (const item of items.reverse()) {
    if (!navigator.onLine) return 'offline';
    if (!item.blob) continue;

    await queue.put({ ...item, status: 'uploading' });
    onChange();

    const params = new URLSearchParams({ electionId: item.electionId, clientId: item.clientId, capturedAt: item.capturedAt });
    if (item.latitude != null && item.longitude != null) {
      params.set('lat', String(item.latitude));
      params.set('lng', String(item.longitude));
      if (item.accuracy != null) params.set('accuracy', String(Math.round(item.accuracy)));
    }

    let res: Response | null = null;
    try {
      res = await fetch(`/api/capture/photos?${params}`, {
        method: 'POST',
        headers: { 'content-type': item.blob.type || 'image/jpeg' },
        body: item.blob,
      });
    } catch {
      res = null;
    }

    if (res && (res.status === 200 || res.status === 201)) {
      const data = (await res.json()) as { sha256: string };
      // Sent: drop the image from the phone, keep the receipt
      await queue.put({ ...item, blob: null, status: 'sent', sentAt: new Date().toISOString(), sha256: data.sha256, lastError: undefined });
    } else if (res?.status === 401) {
      await queue.put({ ...item, status: 'waiting' });
      onChange();
      return 'signed-out';
    } else if (res && res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
      const data = (await res.json().catch(() => ({}))) as { message?: string };
      await queue.put({ ...item, status: 'failed', attempts: item.attempts + 1, lastError: data.message ?? 'The photo was not accepted' });
    } else {
      // Network error, timeout, rate limit or server error: try again later
      await queue.put({ ...item, status: 'waiting', attempts: item.attempts + 1, lastError: 'Waiting for a better connection' });
    }
    onChange();
  }
  return 'done';
}
