import crypto from 'node:crypto';

type DetailPayload = {
  title: string;
  kind: string;
  content: string;
  createdAt: number;
};

const DETAIL_TTL_MS = 6 * 60 * 60 * 1000;
const DETAIL_MAX_ENTRIES = 2000;
const detailStore = new Map<string, DetailPayload>();

function prune(now: number): void {
  for (const [key, value] of detailStore) {
    if (now - value.createdAt > DETAIL_TTL_MS) {
      detailStore.delete(key);
    }
  }
  while (detailStore.size > DETAIL_MAX_ENTRIES) {
    const oldestKey = detailStore.keys().next().value;
    if (!oldestKey) break;
    detailStore.delete(oldestKey);
  }
}

export function saveDetailPayload(input: { title: string; kind: string; content: string }): string {
  const now = Date.now();
  prune(now);
  const ref = crypto
    .createHash('sha1')
    .update(`${input.title}\n${input.kind}\n${input.content}`)
    .digest('hex')
    .slice(0, 24);
  detailStore.set(ref, {
    title: input.title,
    kind: input.kind,
    content: input.content,
    createdAt: now,
  });
  return ref;
}

export function loadDetailPayload(ref: string): { title: string; kind: string; content: string } | null {
  const now = Date.now();
  prune(now);
  const payload = detailStore.get(ref);
  if (!payload) return null;
  if (now - payload.createdAt > DETAIL_TTL_MS) {
    detailStore.delete(ref);
    return null;
  }
  return {
    title: payload.title,
    kind: payload.kind,
    content: payload.content,
  };
}

export function pruneDetailCache(): number {
  const before = detailStore.size;
  prune(Date.now());
  return Math.max(0, before - detailStore.size);
}

export function clearDetailCache(): number {
  const count = detailStore.size;
  detailStore.clear();
  return count;
}

export function getDetailCacheStats(): {
  entries: number;
  ttlMs: number;
  maxEntries: number;
} {
  prune(Date.now());
  return {
    entries: detailStore.size,
    ttlMs: DETAIL_TTL_MS,
    maxEntries: DETAIL_MAX_ENTRIES,
  };
}
