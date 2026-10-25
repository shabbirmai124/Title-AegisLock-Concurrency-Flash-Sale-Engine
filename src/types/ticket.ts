export type LockingStrategy =
  | 'REDIS_MUTEX_ACID'
  | 'SQL_OPTIMISTIC_OCC'
  | 'OS_SEMAPHORE_MUTEX'
  | 'UNPROTECTED_NAIVE';

export type SeatStatus = 'AVAILABLE' | 'LOCKED' | 'SOLD' | 'CORRUPTED_DOUBLE_SOLD';

export interface SeatRecord {
  id: string;
  eventId: string;
  seatNumber: number;
  label: string;
  section: string;
  price: number;
  status: SeatStatus;
  holderBuyerId: string | null;
  lockExpiresAt: number | null;
  fencingToken: number;
  soldToBuyerId: string | null;
  soldToBuyerName: string | null;
  transactionId: string | null;
  soldAt: string | null;
  sellCount: number;
  collisionBuyers: string[];
}

export interface FlashSaleEvent {
  id: string;
  title: string;
  subtitle: string;
  category: 'CONCERT_VIP' | 'HARDWARE_DROP' | 'LIMITED_RELEASE';
  venue: string;
  unitPrice: number;
  totalInventory: number;
  availableInventory: number;
  soldCount: number;
  corruptedDoubleSellCount: number;
  version: number;
  createdAt: string;
}

export interface RedisLockEntry {
  key: string;
  resourceId: string;
  ownerId: string;
  fencingToken: number;
  acquiredAt: number;
  expiresAt: number;
  ttlMs: number;
}

export interface SqlTransactionLog {
  txId: string;
  eventId: string;
  seatNumber: number;
  buyerId: string;
  buyerName: string;
  strategy: LockingStrategy;
  isolationLevel: 'SERIALIZABLE' | 'REPEATABLE_READ' | 'READ_UNCOMMITTED';
  fencingToken: number;
  status:
    | 'COMMITTED'
    | 'BLOCKED_LOCK_CONTENTION'
    | 'BLOCKED_SOLD_OUT'
    | 'RACE_CONDITION_OVERWRITE'
    | 'ROLLED_BACK_OCC';
  latencyMs: number;
  sqlStatement: string;
  timestamp: string;
}

export interface StressTestTelemetryPoint {
  tick: number;
  timestamp: string;
  queueDepth: number;
  activePermits: number;
  lockContention: number;
  successfulCheckouts: number;
  blockedRaceConditions: number;
  doubleSells: number;
  throughputRps: number;
  p99LatencyMs: number;
}

export interface ConcurrencyMetricsSnapshot {
  activeEventId: string;
  strategy: LockingStrategy;
  isSimulationRunning: boolean;
  totalRequestsDispatched: number;
  totalRequestsProcessed: number;
  queueDepth: number;
  semaphoreMaxPermits: number;
  semaphoreActivePermits: number;
  semaphoreWaitQueue: number;
  redisActiveLocksCount: number;
  lockContentionCount: number;
  successfulCheckouts: number;
  blockedRaceConditions: number;
  optimisticRetriesBlocked: number;
  doubleSellAnomalies: number;
  inventoryRemaining: number;
  totalInventory: number;
  avgLatencyMs: number;
  p99LatencyMs: number;
  throughputRps: number;
  elapsedMs: number;
}
