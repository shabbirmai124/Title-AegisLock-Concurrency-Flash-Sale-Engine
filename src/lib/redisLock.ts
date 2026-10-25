import { RedisLockEntry } from '../types/ticket';

export class RedisDistributedLockManager {
  private store = new Map<string, RedisLockEntry>();
  private fencingCounter = 1000;
  public lockContentionCount = 0;

  public setNxPx(
    key: string,
    resourceId: string,
    ownerId: string,
    ttlMs = 15000,
    now = Date.now()
  ): { acquired: boolean; fencingToken: number; entry?: RedisLockEntry } {
    this.evictExpired(now);
    const existing = this.store.get(key);
    if (existing && existing.expiresAt > now) {
      if (existing.ownerId !== ownerId) {
        this.lockContentionCount += 1;
        return { acquired: false, fencingToken: existing.fencingToken };
      }
      existing.expiresAt = now + ttlMs;
      existing.ttlMs = ttlMs;
      return { acquired: true, fencingToken: existing.fencingToken, entry: existing };
    }

    this.fencingCounter += 1;
    const entry: RedisLockEntry = {
      key,
      resourceId,
      ownerId,
      fencingToken: this.fencingCounter,
      acquiredAt: now,
      expiresAt: now + ttlMs,
      ttlMs,
    };
    this.store.set(key, entry);
    return { acquired: true, fencingToken: entry.fencingToken, entry };
  }

  public compareAndDelete(key: string, ownerId: string, fencingToken?: number): boolean {
    const existing = this.store.get(key);
    if (!existing) return false;
    if (existing.ownerId !== ownerId) return false;
    if (fencingToken !== undefined && existing.fencingToken !== fencingToken) return false;
    this.store.delete(key);
    return true;
  }

  public getLock(key: string, now = Date.now()): RedisLockEntry | undefined {
    this.evictExpired(now);
    return this.store.get(key);
  }

  public getAllActiveLocks(now = Date.now()): RedisLockEntry[] {
    this.evictExpired(now);
    return Array.from(this.store.values());
  }

  public evictExpired(now = Date.now()): string[] {
    const evicted: string[] = [];
    for (const [key, entry] of this.store.entries()) {
      if (entry.expiresAt <= now) {
        this.store.delete(key);
        evicted.push(key);
      }
    }
    return evicted;
  }

  public reset(): void {
    this.store.clear();
    this.lockContentionCount = 0;
  }
}
