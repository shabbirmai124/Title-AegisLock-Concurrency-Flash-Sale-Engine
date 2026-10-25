export class CountingSemaphore {
  private maxPermits: number;
  private availablePermits: number;
  private waitQueue: Array<() => void> = [];
  private totalAcquisitions = 0;
  private peakWaitQueue = 0;

  constructor(maxPermits = 16) {
    this.maxPermits = Math.max(1, maxPermits);
    this.availablePermits = this.maxPermits;
  }

  public async acquire(): Promise<() => void> {
    if (this.availablePermits > 0) {
      this.availablePermits -= 1;
      this.totalAcquisitions += 1;
      let released = false;
      return () => {
        if (!released) {
          released = true;
          this.release();
        }
      };
    }

    return new Promise<() => void>((resolve) => {
      this.waitQueue.push(() => {
        this.totalAcquisitions += 1;
        let released = false;
        resolve(() => {
          if (!released) {
            released = true;
            this.release();
          }
        });
      });
      if (this.waitQueue.length > this.peakWaitQueue) {
        this.peakWaitQueue = this.waitQueue.length;
      }
    });
  }

  private release(): void {
    const nextResolver = this.waitQueue.shift();
    if (nextResolver) {
      nextResolver();
    } else {
      this.availablePermits = Math.min(this.maxPermits, this.availablePermits + 1);
    }
  }

  public setMaxPermits(newMax: number): void {
    const clamped = Math.max(1, Math.min(128, newMax));
    const delta = clamped - this.maxPermits;
    this.maxPermits = clamped;
    this.availablePermits = Math.max(0, Math.min(this.maxPermits, this.availablePermits + delta));
    while (this.availablePermits > 0 && this.waitQueue.length > 0) {
      this.availablePermits -= 1;
      const next = this.waitQueue.shift();
      if (next) next();
    }
  }

  public getState() {
    return {
      maxPermits: this.maxPermits,
      availablePermits: this.availablePermits,
      activePermits: this.maxPermits - this.availablePermits,
      waitQueueLength: this.waitQueue.length,
      totalAcquisitions: this.totalAcquisitions,
      peakWaitQueue: this.peakWaitQueue,
    };
  }
}

export class ResourceMutexManager {
  private locks = new Map<string, boolean>();
  private queues = new Map<string, Array<() => void>>();
  public contentionEvents = 0;

  public async lock(resourceKey: string): Promise<() => void> {
    if (!this.locks.get(resourceKey)) {
      this.locks.set(resourceKey, true);
      return () => this.unlock(resourceKey);
    }

    this.contentionEvents += 1;
    return new Promise<() => void>((resolve) => {
      const q = this.queues.get(resourceKey) || [];
      q.push(() => resolve(() => this.unlock(resourceKey)));
      this.queues.set(resourceKey, q);
    });
  }

  private unlock(resourceKey: string): void {
    const q = this.queues.get(resourceKey);
    if (q && q.length > 0) {
      const next = q.shift()!;
      next();
    } else {
      this.locks.delete(resourceKey);
      this.queues.delete(resourceKey);
    }
  }

  public clear(): void {
    this.locks.clear();
    this.queues.clear();
    this.contentionEvents = 0;
  }
}
