import {
  ConcurrencyMetricsSnapshot,
  FlashSaleEvent,
  LockingStrategy,
  RedisLockEntry,
  SeatRecord,
  SqlTransactionLog,
  StressTestTelemetryPoint,
} from '../types/ticket';
import { CountingSemaphore, ResourceMutexManager } from './semaphore';
import { RedisDistributedLockManager } from './redisLock';

export * from '../types/ticket';
export { CountingSemaphore, ResourceMutexManager } from './semaphore';
export { RedisDistributedLockManager } from './redisLock';

export class TicketingStore {
  private events = new Map<string, FlashSaleEvent>();
  private seatsByEvent = new Map<string, Map<number, SeatRecord>>();
  private txLogs: SqlTransactionLog[] = [];
  private telemetryHistory: StressTestTelemetryPoint[] = [];

  public readonly semaphore: CountingSemaphore;
  public readonly redisLocks: RedisDistributedLockManager;
  public readonly mutexManager: ResourceMutexManager;

  private activeEventId = 'evt-aurora-vip';
  private strategy: LockingStrategy = 'REDIS_MUTEX_ACID';
  private isSimulationRunning = false;

  private totalRequestsDispatched = 0;
  private totalRequestsProcessed = 0;
  private currentQueueDepth = 0;
  private successfulCheckouts = 0;
  private blockedRaceConditions = 0;
  private optimisticRetriesBlocked = 0;
  private doubleSellAnomalies = 0;
  private latencies: number[] = [];
  private simStartTime = 0;
  private lastTickCompleted = 0;
  private currentThroughputRps = 0;
  private txSequence = 10000;

  constructor(maxPermits = 16) {
    this.semaphore = new CountingSemaphore(maxPermits);
    this.redisLocks = new RedisDistributedLockManager();
    this.mutexManager = new ResourceMutexManager();
    this.seedDefaultEvents();
  }

  private seedDefaultEvents(): void {
    const defaults: Array<{
      id: string;
      title: string;
      subtitle: string;
      category: FlashSaleEvent['category'];
      venue: string;
      unitPrice: number;
      totalInventory: number;
    }> = [
      {
        id: 'evt-aurora-vip',
        title: 'Aurora Symphony World Tour — Floor VIP',
        subtitle: '50 Front-Row Soundcheck Packages',
        category: 'CONCERT_VIP',
        venue: 'Sphere Arena, Las Vegas',
        unitPrice: 240,
        totalInventory: 50,
      },
      {
        id: 'evt-rtx-founders',
        title: 'TensorCore RTX-6090 Founders Batch',
        subtitle: '50 Serialized MSRP Allocation Units',
        category: 'HARDWARE_DROP',
        venue: 'Global Direct Fulfillment',
        unitPrice: 1599,
        totalInventory: 50,
      },
      {
        id: 'evt-tokyo-dome',
        title: 'Neo-Tokyo Synthwave Finale — Arena Pit',
        subtitle: '50 Collector Passes',
        category: 'LIMITED_RELEASE',
        venue: 'Tokyo Dome, Bunkyo',
        unitPrice: 185,
        totalInventory: 50,
      },
    ];

    for (const item of defaults) {
      this.createEventInternal(item);
    }
  }

  private createEventInternal(params: {
    id: string;
    title: string;
    subtitle: string;
    category: FlashSaleEvent['category'];
    venue: string;
    unitPrice: number;
    totalInventory: number;
  }): FlashSaleEvent {
    const event: FlashSaleEvent = {
      id: params.id,
      title: params.title,
      subtitle: params.subtitle,
      category: params.category,
      venue: params.venue,
      unitPrice: params.unitPrice,
      totalInventory: params.totalInventory,
      availableInventory: params.totalInventory,
      soldCount: 0,
      corruptedDoubleSellCount: 0,
      version: 1,
      createdAt: new Date().toISOString(),
    };
    this.events.set(event.id, event);
    this.initializeSeatsForEvent(event);
    return event;
  }

  private initializeSeatsForEvent(event: FlashSaleEvent): void {
    const seatMap = new Map<number, SeatRecord>();
    const rows = ['A', 'B', 'C', 'D', 'E'];
    for (let i = 1; i <= event.totalInventory; i++) {
      const rowIdx = Math.floor((i - 1) / 10);
      const rowLetter = rows[rowIdx] || 'F';
      const colNum = ((i - 1) % 10) + 1;
      const section = i <= 20 ? 'VIP Pit' : i <= 40 ? 'Orchestra Center' : 'Club Box';
      seatMap.set(i, {
        id: `${event.id}-seat-${i}`,
        eventId: event.id,
        seatNumber: i,
        label: `${rowLetter}${colNum.toString().padStart(2, '0')}`,
        section,
        price: event.unitPrice,
        status: 'AVAILABLE',
        holderBuyerId: null,
        lockExpiresAt: null,
        fencingToken: 0,
        soldToBuyerId: null,
        soldToBuyerName: null,
        transactionId: null,
        soldAt: null,
        sellCount: 0,
        collisionBuyers: [],
      });
    }
    this.seatsByEvent.set(event.id, seatMap);
  }

  public createCustomEvent(input: {
    title: string;
    venue: string;
    unitPrice: number;
    totalInventory: number;
    category?: FlashSaleEvent['category'];
  }): FlashSaleEvent {
    const cleanTitle = input.title.trim();
    const cleanVenue = input.venue.trim();
    if (!cleanTitle) {
      throw new Error('Event title is required.');
    }
    if (!cleanVenue) {
      throw new Error('Venue or fulfillment region is required.');
    }
    const price = Number(input.unitPrice);
    if (!Number.isFinite(price) || price <= 0) {
      throw new Error('Unit price must be greater than $0.');
    }
    const inventory = Math.round(Number(input.totalInventory));
    if (!Number.isFinite(inventory) || inventory < 10 || inventory > 100) {
      throw new Error('Inventory pool must be between 10 and 100 units.');
    }

    const id = `evt-custom-${Date.now().toString(36)}`;
    const created = this.createEventInternal({
      id,
      title: cleanTitle,
      subtitle: `${inventory} Allocated Units`,
      category: input.category || 'CONCERT_VIP',
      venue: cleanVenue,
      unitPrice: price,
      totalInventory: inventory,
    });
    this.activeEventId = created.id;
    this.resetEventInventory(created.id);
    return created;
  }

  public setActiveEvent(eventId: string): FlashSaleEvent {
    const ev = this.events.get(eventId);
    if (!ev) {
      throw new Error(`Event ${eventId} not found`);
    }
    this.activeEventId = eventId;
    return ev;
  }

  public setStrategy(strategy: LockingStrategy): void {
    this.strategy = strategy;
  }

  public getStrategy(): LockingStrategy {
    return this.strategy;
  }

  public resetEventInventory(eventId = this.activeEventId): void {
    const ev = this.events.get(eventId);
    if (!ev) return;
    ev.availableInventory = ev.totalInventory;
    ev.soldCount = 0;
    ev.corruptedDoubleSellCount = 0;
    ev.version = 1;
    this.initializeSeatsForEvent(ev);
    this.redisLocks.reset();
    this.mutexManager.clear();
    this.txLogs = [];
    this.telemetryHistory = [];
    this.totalRequestsDispatched = 0;
    this.totalRequestsProcessed = 0;
    this.currentQueueDepth = 0;
    this.successfulCheckouts = 0;
    this.blockedRaceConditions = 0;
    this.optimisticRetriesBlocked = 0;
    this.doubleSellAnomalies = 0;
    this.latencies = [];
    this.currentThroughputRps = 0;
    this.lastTickCompleted = 0;
    this.isSimulationRunning = false;
  }

  public acquireInteractiveSeatHold(params: {
    eventId?: string;
    seatNumber: number;
    buyerId: string;
    ttlMs?: number;
  }): { ok: boolean; reason?: string; seat?: SeatRecord; lock?: RedisLockEntry } {
    const eventId = params.eventId || this.activeEventId;
    const seatMap = this.seatsByEvent.get(eventId);
    if (!seatMap) return { ok: false, reason: 'Event not found.' };
    const seat = seatMap.get(params.seatNumber);
    if (!seat) return { ok: false, reason: 'Seat does not exist.' };

    this.syncExpiredSeatLocks(eventId);

    if (seat.status === 'SOLD' || seat.status === 'CORRUPTED_DOUBLE_SOLD') {
      return { ok: false, reason: `Seat ${seat.label} has already been sold.` };
    }

    const redisKey = `lock:event:${eventId}:seat:${seat.seatNumber}`;
    const lockResult = this.redisLocks.setNxPx(
      redisKey,
      seat.id,
      params.buyerId,
      params.ttlMs || 30000
    );

    if (!lockResult.acquired || !lockResult.entry) {
      return {
        ok: false,
        reason: `Lock contention: Seat ${seat.label} is currently held by another buyer.`,
      };
    }

    seat.status = 'LOCKED';
    seat.holderBuyerId = params.buyerId;
    seat.lockExpiresAt = lockResult.entry.expiresAt;
    seat.fencingToken = lockResult.fencingToken;

    return { ok: true, seat: { ...seat }, lock: { ...lockResult.entry } };
  }

  public releaseInteractiveSeatHold(params: {
    eventId?: string;
    seatNumber: number;
    buyerId: string;
  }): { ok: boolean; seat?: SeatRecord } {
    const eventId = params.eventId || this.activeEventId;
    const seatMap = this.seatsByEvent.get(eventId);
    if (!seatMap) return { ok: false };
    const seat = seatMap.get(params.seatNumber);
    if (!seat) return { ok: false };

    const redisKey = `lock:event:${eventId}:seat:${seat.seatNumber}`;
    this.redisLocks.compareAndDelete(redisKey, params.buyerId);

    if (seat.status === 'LOCKED' && seat.holderBuyerId === params.buyerId) {
      seat.status = 'AVAILABLE';
      seat.holderBuyerId = null;
      seat.lockExpiresAt = null;
    }

    return { ok: true, seat: { ...seat } };
  }

  public syncExpiredSeatLocks(eventId = this.activeEventId, now = Date.now()): void {
    this.redisLocks.evictExpired(now);
    const seatMap = this.seatsByEvent.get(eventId);
    if (!seatMap) return;
    for (const seat of seatMap.values()) {
      if (seat.status === 'LOCKED' && seat.lockExpiresAt && seat.lockExpiresAt <= now) {
        seat.status = 'AVAILABLE';
        seat.holderBuyerId = null;
        seat.lockExpiresAt = null;
      }
    }
  }

  public async processCheckoutRequest(params: {
    eventId?: string;
    seatNumber?: number;
    buyerId: string;
    buyerName: string;
    strategy?: LockingStrategy;
    simulatedIoDelayMs?: number;
  }): Promise<SqlTransactionLog> {
    const startPerf = performance.now();
    const eventId = params.eventId || this.activeEventId;
    const strategy = params.strategy || this.strategy;
    const event = this.events.get(eventId);
    const seatMap = this.seatsByEvent.get(eventId);

    if (!event || !seatMap) {
      throw new Error(`Invalid event ${eventId}`);
    }

    this.currentQueueDepth += 1;

    try {
      if (strategy === 'REDIS_MUTEX_ACID') {
        return await this.executeRedisMutexAcidCheckout(
          event,
          seatMap,
          params.buyerId,
          params.buyerName,
          params.seatNumber,
          startPerf
        );
      } else if (strategy === 'SQL_OPTIMISTIC_OCC') {
        return await this.executeOptimisticOccCheckout(
          event,
          seatMap,
          params.buyerId,
          params.buyerName,
          params.seatNumber,
          startPerf
        );
      } else if (strategy === 'OS_SEMAPHORE_MUTEX') {
        return await this.executeOsSemaphoreMutexCheckout(
          event,
          seatMap,
          params.buyerId,
          params.buyerName,
          params.seatNumber,
          startPerf
        );
      } else {
        return await this.executeUnprotectedNaiveCheckout(
          event,
          seatMap,
          params.buyerId,
          params.buyerName,
          params.seatNumber,
          params.simulatedIoDelayMs ?? 4,
          startPerf
        );
      }
    } finally {
      this.currentQueueDepth = Math.max(0, this.currentQueueDepth - 1);
      this.totalRequestsProcessed += 1;
    }
  }

  private async executeRedisMutexAcidCheckout(
    event: FlashSaleEvent,
    seatMap: Map<number, SeatRecord>,
    buyerId: string,
    buyerName: string,
    requestedSeatNumber: number | undefined,
    startPerf: number
  ): Promise<SqlTransactionLog> {
    const releasePermit = await this.semaphore.acquire();
    try {
      this.syncExpiredSeatLocks(event.id);

      let targetSeat: SeatRecord | undefined;
      if (requestedSeatNumber !== undefined) {
        targetSeat = seatMap.get(requestedSeatNumber);
      } else {
        for (const s of seatMap.values()) {
          if (s.status === 'AVAILABLE' || (s.status === 'LOCKED' && s.holderBuyerId === buyerId)) {
            targetSeat = s;
            break;
          }
        }
      }

      if (!targetSeat || event.availableInventory <= 0) {
        this.blockedRaceConditions += 1;
        return this.recordTxLog({
          eventId: event.id,
          seatNumber: requestedSeatNumber || 0,
          buyerId,
          buyerName,
          strategy: 'REDIS_MUTEX_ACID',
          isolationLevel: 'SERIALIZABLE',
          fencingToken: 0,
          status: 'BLOCKED_SOLD_OUT',
          latencyMs: performance.now() - startPerf,
          sqlStatement: `SELECT id FROM seats WHERE event_id = '${event.id}' AND status = 'AVAILABLE' FOR UPDATE LIMIT 1; -- 0 rows`,
        });
      }

      const redisKey = `lock:event:${event.id}:seat:${targetSeat.seatNumber}`;
      const lockRes = this.redisLocks.setNxPx(redisKey, targetSeat.id, buyerId, 10000);

      if (!lockRes.acquired) {
        this.blockedRaceConditions += 1;
        return this.recordTxLog({
          eventId: event.id,
          seatNumber: targetSeat.seatNumber,
          buyerId,
          buyerName,
          strategy: 'REDIS_MUTEX_ACID',
          isolationLevel: 'SERIALIZABLE',
          fencingToken: lockRes.fencingToken,
          status: 'BLOCKED_LOCK_CONTENTION',
          latencyMs: performance.now() - startPerf,
          sqlStatement: `REDIS SET ${redisKey} ${buyerId} NX PX 10000 -> (nil) [Blocked by token #${lockRes.fencingToken}]`,
        });
      }

      try {
        if (
          targetSeat.status === 'SOLD' ||
          targetSeat.status === 'CORRUPTED_DOUBLE_SOLD' ||
          targetSeat.fencingToken > lockRes.fencingToken ||
          event.availableInventory <= 0
        ) {
          this.blockedRaceConditions += 1;
          return this.recordTxLog({
            eventId: event.id,
            seatNumber: targetSeat.seatNumber,
            buyerId,
            buyerName,
            strategy: 'REDIS_MUTEX_ACID',
            isolationLevel: 'SERIALIZABLE',
            fencingToken: lockRes.fencingToken,
            status: 'BLOCKED_LOCK_CONTENTION',
            latencyMs: performance.now() - startPerf,
            sqlStatement: `ROLLBACK; -- Fencing token rejected write on seat ${targetSeat.label}`,
          });
        }

        const txId = `tx_${++this.txSequence}`;
        targetSeat.status = 'SOLD';
        targetSeat.holderBuyerId = null;
        targetSeat.lockExpiresAt = null;
        targetSeat.fencingToken = lockRes.fencingToken;
        targetSeat.soldToBuyerId = buyerId;
        targetSeat.soldToBuyerName = buyerName;
        targetSeat.transactionId = txId;
        targetSeat.soldAt = new Date().toISOString();
        targetSeat.sellCount += 1;
        targetSeat.collisionBuyers.push(buyerId);

        event.availableInventory -= 1;
        event.soldCount += 1;
        event.version += 1;
        this.successfulCheckouts += 1;

        return this.recordTxLog({
          txId,
          eventId: event.id,
          seatNumber: targetSeat.seatNumber,
          buyerId,
          buyerName,
          strategy: 'REDIS_MUTEX_ACID',
          isolationLevel: 'SERIALIZABLE',
          fencingToken: lockRes.fencingToken,
          status: 'COMMITTED',
          latencyMs: performance.now() - startPerf,
          sqlStatement: `BEGIN SERIALIZABLE; SELECT status FROM seats WHERE seat_no = ${targetSeat.seatNumber} FOR UPDATE; UPDATE seats SET status = 'SOLD', fencing_token = ${lockRes.fencingToken}, tx_id = '${txId}' WHERE seat_no = ${targetSeat.seatNumber}; UPDATE events SET available_inventory = ${event.availableInventory} WHERE id = '${event.id}'; COMMIT;`,
        });
      } finally {
        this.redisLocks.compareAndDelete(redisKey, buyerId, lockRes.fencingToken);
      }
    } finally {
      releasePermit();
    }
  }

  private async executeOptimisticOccCheckout(
    event: FlashSaleEvent,
    seatMap: Map<number, SeatRecord>,
    buyerId: string,
    buyerName: string,
    requestedSeatNumber: number | undefined,
    startPerf: number
  ): Promise<SqlTransactionLog> {
    const releasePermit = await this.semaphore.acquire();
    try {
      const snapshotVersion = event.version;
      const snapshotAvailable = event.availableInventory;

      let targetSeat: SeatRecord | undefined;
      if (requestedSeatNumber !== undefined) {
        targetSeat = seatMap.get(requestedSeatNumber);
      } else {
        for (const s of seatMap.values()) {
          if (s.status === 'AVAILABLE') {
            targetSeat = s;
            break;
          }
        }
      }

      if (!targetSeat || snapshotAvailable <= 0) {
        this.blockedRaceConditions += 1;
        return this.recordTxLog({
          eventId: event.id,
          seatNumber: requestedSeatNumber || 0,
          buyerId,
          buyerName,
          strategy: 'SQL_OPTIMISTIC_OCC',
          isolationLevel: 'REPEATABLE_READ',
          fencingToken: snapshotVersion,
          status: 'BLOCKED_SOLD_OUT',
          latencyMs: performance.now() - startPerf,
          sqlStatement: `SELECT version, available_inventory FROM events WHERE id = '${event.id}'; -- 0 remaining`,
        });
      }

      const seatSnapshotSellCount = targetSeat.sellCount;
      await Promise.resolve();

      if (
        event.version !== snapshotVersion ||
        targetSeat.status !== 'AVAILABLE' ||
        targetSeat.sellCount !== seatSnapshotSellCount ||
        event.availableInventory <= 0
      ) {
        this.redisLocks.lockContentionCount += 1;
        this.optimisticRetriesBlocked += 1;
        this.blockedRaceConditions += 1;
        return this.recordTxLog({
          eventId: event.id,
          seatNumber: targetSeat.seatNumber,
          buyerId,
          buyerName,
          strategy: 'SQL_OPTIMISTIC_OCC',
          isolationLevel: 'REPEATABLE_READ',
          fencingToken: snapshotVersion,
          status: 'ROLLED_BACK_OCC',
          latencyMs: performance.now() - startPerf,
          sqlStatement: `UPDATE events SET available_inventory = available_inventory - 1, version = version + 1 WHERE id = '${event.id}' AND version = ${snapshotVersion}; -- 0 rows affected (Version Conflict)`,
        });
      }

      const txId = `tx_${++this.txSequence}`;
      event.version += 1;
      event.availableInventory -= 1;
      event.soldCount += 1;

      targetSeat.status = 'SOLD';
      targetSeat.fencingToken = event.version;
      targetSeat.soldToBuyerId = buyerId;
      targetSeat.soldToBuyerName = buyerName;
      targetSeat.transactionId = txId;
      targetSeat.soldAt = new Date().toISOString();
      targetSeat.sellCount += 1;
      targetSeat.collisionBuyers.push(buyerId);

      this.successfulCheckouts += 1;

      return this.recordTxLog({
        txId,
        eventId: event.id,
        seatNumber: targetSeat.seatNumber,
        buyerId,
        buyerName,
        strategy: 'SQL_OPTIMISTIC_OCC',
        isolationLevel: 'REPEATABLE_READ',
        fencingToken: event.version,
        status: 'COMMITTED',
        latencyMs: performance.now() - startPerf,
        sqlStatement: `UPDATE seats SET status = 'SOLD', tx_id = '${txId}' WHERE seat_no = ${targetSeat.seatNumber} AND status = 'AVAILABLE'; UPDATE events SET available_inventory = ${event.availableInventory}, version = ${event.version} WHERE id = '${event.id}' AND version = ${snapshotVersion}; COMMIT;`,
      });
    } finally {
      releasePermit();
    }
  }

  private async executeOsSemaphoreMutexCheckout(
    event: FlashSaleEvent,
    seatMap: Map<number, SeatRecord>,
    buyerId: string,
    buyerName: string,
    requestedSeatNumber: number | undefined,
    startPerf: number
  ): Promise<SqlTransactionLog> {
    const releasePermit = await this.semaphore.acquire();
    try {
      const unlockMutex = await this.mutexManager.lock(`mutex:event:${event.id}`);
      try {
        let targetSeat: SeatRecord | undefined;
        if (requestedSeatNumber !== undefined) {
          const s = seatMap.get(requestedSeatNumber);
          if (s && s.status === 'AVAILABLE') targetSeat = s;
        } else {
          for (const s of seatMap.values()) {
            if (s.status === 'AVAILABLE') {
              targetSeat = s;
              break;
            }
          }
        }

        if (!targetSeat || event.availableInventory <= 0) {
          this.blockedRaceConditions += 1;
          return this.recordTxLog({
            eventId: event.id,
            seatNumber: requestedSeatNumber || 0,
            buyerId,
            buyerName,
            strategy: 'OS_SEMAPHORE_MUTEX',
            isolationLevel: 'SERIALIZABLE',
            fencingToken: event.version,
            status: 'BLOCKED_SOLD_OUT',
            latencyMs: performance.now() - startPerf,
            sqlStatement: `pthread_mutex_lock(&pool_mutex); -- 0 seats remaining, releasing mutex.`,
          });
        }

        const txId = `tx_${++this.txSequence}`;
        event.version += 1;
        event.availableInventory -= 1;
        event.soldCount += 1;

        targetSeat.status = 'SOLD';
        targetSeat.fencingToken = event.version;
        targetSeat.soldToBuyerId = buyerId;
        targetSeat.soldToBuyerName = buyerName;
        targetSeat.transactionId = txId;
        targetSeat.soldAt = new Date().toISOString();
        targetSeat.sellCount += 1;
        targetSeat.collisionBuyers.push(buyerId);

        this.successfulCheckouts += 1;

        return this.recordTxLog({
          txId,
          eventId: event.id,
          seatNumber: targetSeat.seatNumber,
          buyerId,
          buyerName,
          strategy: 'OS_SEMAPHORE_MUTEX',
          isolationLevel: 'SERIALIZABLE',
          fencingToken: event.version,
          status: 'COMMITTED',
          latencyMs: performance.now() - startPerf,
          sqlStatement: `sem_wait(&db_pool); pthread_mutex_lock(&seat_${targetSeat.seatNumber}); UPDATE seats SET status = 'SOLD' WHERE seat_no = ${targetSeat.seatNumber}; pthread_mutex_unlock(); sem_post(&db_pool);`,
        });
      } finally {
        unlockMutex();
      }
    } finally {
      releasePermit();
    }
  }

  private async executeUnprotectedNaiveCheckout(
    event: FlashSaleEvent,
    seatMap: Map<number, SeatRecord>,
    buyerId: string,
    buyerName: string,
    requestedSeatNumber: number | undefined,
    simulatedIoDelayMs: number,
    startPerf: number
  ): Promise<SqlTransactionLog> {
    let targetSeat: SeatRecord | undefined;
    if (requestedSeatNumber !== undefined) {
      const candidate = seatMap.get(requestedSeatNumber);
      if (candidate && candidate.status === 'AVAILABLE') {
        targetSeat = candidate;
      }
    } else {
      const availableCandidates: SeatRecord[] = [];
      for (const s of seatMap.values()) {
        if (s.status === 'AVAILABLE') {
          availableCandidates.push(s);
        }
      }
      if (availableCandidates.length > 0) {
        const hotIndex = Math.min(
          availableCandidates.length - 1,
          Math.floor(Math.random() * Math.min(5, availableCandidates.length))
        );
        targetSeat = availableCandidates[hotIndex];
      }
    }

    if (!targetSeat || event.availableInventory <= 0) {
      this.blockedRaceConditions += 1;
      return this.recordTxLog({
        eventId: event.id,
        seatNumber: requestedSeatNumber || 0,
        buyerId,
        buyerName,
        strategy: 'UNPROTECTED_NAIVE',
        isolationLevel: 'READ_UNCOMMITTED',
        fencingToken: 0,
        status: 'BLOCKED_SOLD_OUT',
        latencyMs: performance.now() - startPerf,
        sqlStatement: `SELECT available_inventory FROM events WHERE id = '${event.id}'; -- Read 0 remaining`,
      });
    }

    if (simulatedIoDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, simulatedIoDelayMs));
    } else {
      await Promise.resolve();
    }

    const txId = `tx_${++this.txSequence}`;
    const wasAlreadySold = targetSeat.sellCount >= 1;

    targetSeat.sellCount += 1;
    targetSeat.collisionBuyers.push(buyerId);
    targetSeat.soldToBuyerId = buyerId;
    targetSeat.soldToBuyerName = buyerName;
    targetSeat.transactionId = txId;
    targetSeat.soldAt = new Date().toISOString();

    event.availableInventory -= 1;
    event.soldCount += 1;

    if (wasAlreadySold) {
      targetSeat.status = 'CORRUPTED_DOUBLE_SOLD';
      event.corruptedDoubleSellCount += 1;
      this.doubleSellAnomalies += 1;

      return this.recordTxLog({
        txId,
        eventId: event.id,
        seatNumber: targetSeat.seatNumber,
        buyerId,
        buyerName,
        strategy: 'UNPROTECTED_NAIVE',
        isolationLevel: 'READ_UNCOMMITTED',
        fencingToken: 0,
        status: 'RACE_CONDITION_OVERWRITE',
        latencyMs: performance.now() - startPerf,
        sqlStatement: `/* DOUBLE-SELL #${targetSeat.sellCount} ON SEAT ${targetSeat.label} */ UPDATE seats SET sold_to = '${buyerId}' WHERE seat_no = ${targetSeat.seatNumber}; UPDATE events SET available_inventory = ${event.availableInventory};`,
      });
    } else {
      targetSeat.status = 'SOLD';
      this.successfulCheckouts += 1;

      return this.recordTxLog({
        txId,
        eventId: event.id,
        seatNumber: targetSeat.seatNumber,
        buyerId,
        buyerName,
        strategy: 'UNPROTECTED_NAIVE',
        isolationLevel: 'READ_UNCOMMITTED',
        fencingToken: 0,
        status: 'COMMITTED',
        latencyMs: performance.now() - startPerf,
        sqlStatement: `SELECT status FROM seats WHERE seat_no = ${targetSeat.seatNumber}; UPDATE seats SET status = 'SOLD', sold_to = '${buyerId}' WHERE seat_no = ${targetSeat.seatNumber};`,
      });
    }
  }

  private recordTxLog(
    entry: Omit<SqlTransactionLog, 'txId' | 'timestamp'> & { txId?: string }
  ): SqlTransactionLog {
    const txId = entry.txId || `tx_${++this.txSequence}`;
    const roundedLatency = Math.max(0.1, Math.round(entry.latencyMs * 100) / 100);
    this.latencies.push(roundedLatency);
    if (this.latencies.length > 2000) {
      this.latencies.shift();
    }

    const log: SqlTransactionLog = {
      ...entry,
      txId,
      latencyMs: roundedLatency,
      timestamp: new Date().toISOString(),
    };

    if (log.status === 'BLOCKED_SOLD_OUT') {
      const soldOutCount = this.txLogs.filter((t) => t.status === 'BLOCKED_SOLD_OUT').length;
      if (soldOutCount >= 35) {
        return log;
      }
      this.txLogs.push(log);
    } else {
      this.txLogs.unshift(log);
    }

    if (this.txLogs.length > 250) {
      this.txLogs.pop();
    }

    return log;
  }

  public async runConcurrentStressWave(options: {
    buyerCount: number;
    strategy?: LockingStrategy;
    batchSize?: number;
    batchDelayMs?: number;
    onProgress?: (snapshot: ReturnType<TicketingStore['getFullState']>) => void;
  }): Promise<ReturnType<TicketingStore['getFullState']>> {
    if (this.isSimulationRunning) {
      return this.getFullState();
    }

    const totalBuyers = Math.max(1, Math.min(10000, options.buyerCount));
    if (options.strategy) {
      this.strategy = options.strategy;
    }

    const event = this.events.get(this.activeEventId);
    if (event && event.availableInventory <= 0) {
      this.resetEventInventory(this.activeEventId);
    }

    this.isSimulationRunning = true;
    this.simStartTime = Date.now();
    this.totalRequestsDispatched += totalBuyers;
    this.lastTickCompleted = this.totalRequestsProcessed;

    const batchSize = options.batchSize || Math.max(100, Math.floor(totalBuyers / 16));
    const batchDelayMs = options.batchDelayMs ?? 35;

    let dispatchedSoFar = 0;
    let tickCounter = this.telemetryHistory.length;

    try {
      while (dispatchedSoFar < totalBuyers) {
        const currentBatchCount = Math.min(batchSize, totalBuyers - dispatchedSoFar);
        this.currentQueueDepth = totalBuyers - dispatchedSoFar;

        const batchPromises: Promise<SqlTransactionLog>[] = [];
        for (let i = 0; i < currentBatchCount; i++) {
          const buyerIndex = dispatchedSoFar + i + 1;
          const buyerId = `usr_${buyerIndex.toString().padStart(5, '0')}`;
          const buyerName = `Buyer #${buyerIndex}`;

          batchPromises.push(
            this.processCheckoutRequest({
              eventId: this.activeEventId,
              buyerId,
              buyerName,
              strategy: this.strategy,
              simulatedIoDelayMs: this.strategy === 'UNPROTECTED_NAIVE' ? 6 : 0,
            })
          );
        }

        await Promise.all(batchPromises);
        dispatchedSoFar += currentBatchCount;

        const completedDelta = this.totalRequestsProcessed - this.lastTickCompleted;
        this.lastTickCompleted = this.totalRequestsProcessed;
        const rps = Math.round((completedDelta / Math.max(10, batchDelayMs)) * 1000);
        this.currentThroughputRps = rps;

        tickCounter += 1;
        const metrics = this.getMetricsSnapshot();
        this.telemetryHistory.push({
          tick: tickCounter,
          timestamp: new Date().toLocaleTimeString([], {
            hour12: false,
            minute: '2-digit',
            second: '2-digit',
          }),
          queueDepth: Math.max(0, totalBuyers - dispatchedSoFar),
          activePermits: metrics.semaphoreActivePermits,
          lockContention: metrics.lockContentionCount,
          successfulCheckouts: metrics.successfulCheckouts,
          blockedRaceConditions: metrics.blockedRaceConditions,
          doubleSells: metrics.doubleSellAnomalies,
          throughputRps: rps,
          p99LatencyMs: metrics.p99LatencyMs,
        });

        if (this.telemetryHistory.length > 40) {
          this.telemetryHistory.shift();
        }

        if (options.onProgress) {
          options.onProgress(this.getFullState());
        }

        if (dispatchedSoFar < totalBuyers && batchDelayMs > 0) {
          await new Promise((r) => setTimeout(r, batchDelayMs));
        }
      }
    } finally {
      this.currentQueueDepth = 0;
      this.isSimulationRunning = false;
      if (options.onProgress) {
        options.onProgress(this.getFullState());
      }
    }

    return this.getFullState();
  }

  public getMetricsSnapshot(): ConcurrencyMetricsSnapshot {
    const event = this.events.get(this.activeEventId)!;
    const semState = this.semaphore.getState();
    const activeLocks = this.redisLocks.getAllActiveLocks();

    let avgLatency = 0;
    let p99Latency = 0;
    if (this.latencies.length > 0) {
      const sum = this.latencies.reduce((acc, v) => acc + v, 0);
      avgLatency = Math.round((sum / this.latencies.length) * 100) / 100;
      const sorted = [...this.latencies].sort((a, b) => a - b);
      const p99Idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99));
      p99Latency = sorted[p99Idx];
    }

    const totalContention =
      this.redisLocks.lockContentionCount +
      this.mutexManager.contentionEvents +
      this.blockedRaceConditions;

    return {
      activeEventId: this.activeEventId,
      strategy: this.strategy,
      isSimulationRunning: this.isSimulationRunning,
      totalRequestsDispatched: this.totalRequestsDispatched,
      totalRequestsProcessed: this.totalRequestsProcessed,
      queueDepth: this.currentQueueDepth,
      semaphoreMaxPermits: semState.maxPermits,
      semaphoreActivePermits: semState.activePermits,
      semaphoreWaitQueue: semState.waitQueueLength,
      redisActiveLocksCount: activeLocks.length,
      lockContentionCount: totalContention,
      successfulCheckouts: this.successfulCheckouts,
      blockedRaceConditions: this.blockedRaceConditions,
      optimisticRetriesBlocked: this.optimisticRetriesBlocked,
      doubleSellAnomalies: this.doubleSellAnomalies,
      inventoryRemaining: event.availableInventory,
      totalInventory: event.totalInventory,
      avgLatencyMs: avgLatency,
      p99LatencyMs: p99Latency,
      throughputRps: this.currentThroughputRps,
      elapsedMs: this.simStartTime > 0 ? Date.now() - this.simStartTime : 0,
    };
  }

  public getFullState() {
    this.syncExpiredSeatLocks(this.activeEventId);
    const activeEvent = this.events.get(this.activeEventId)!;
    const seats = Array.from(this.seatsByEvent.get(this.activeEventId)!.values());
    return {
      activeEvent,
      events: Array.from(this.events.values()),
      seats,
      activeRedisLocks: this.redisLocks.getAllActiveLocks(),
      recentTransactions: this.txLogs.slice(0, 80),
      telemetryHistory: this.telemetryHistory,
      metrics: this.getMetricsSnapshot(),
    };
  }
}
