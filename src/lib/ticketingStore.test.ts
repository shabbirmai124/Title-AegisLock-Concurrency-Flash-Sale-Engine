import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CountingSemaphore,
  RedisDistributedLockManager,
  TicketingStore,
} from './ticketingStore';

test('CountingSemaphore enforces max concurrent permits and FIFO release', async () => {
  const sem = new CountingSemaphore(2);
  const r1 = await sem.acquire();
  const r2 = await sem.acquire();
  assert.equal(sem.getState().availablePermits, 0);
  assert.equal(sem.getState().activePermits, 2);

  let thirdAcquired = false;
  const p3 = sem.acquire().then((release) => {
    thirdAcquired = true;
    return release;
  });

  await Promise.resolve();
  assert.equal(thirdAcquired, false);
  assert.equal(sem.getState().waitQueueLength, 1);

  r1();
  const r3 = await p3;
  assert.equal(thirdAcquired, true);
  assert.equal(sem.getState().activePermits, 2);

  r2();
  r3();
  assert.equal(sem.getState().availablePermits, 2);
});

test('CountingSemaphore dynamic permit scaling unblocks waiting callers', async () => {
  const sem = new CountingSemaphore(1);
  const r1 = await sem.acquire();

  let secondAcquired = false;
  const p2 = sem.acquire().then((release) => {
    secondAcquired = true;
    return release;
  });

  await Promise.resolve();
  assert.equal(secondAcquired, false);

  sem.setMaxPermits(4);
  const r2 = await p2;
  assert.equal(secondAcquired, true);

  r1();
  r2();
  assert.equal(sem.getState().availablePermits, 4);
});

test('RedisDistributedLockManager enforces SET NX PX exclusion, fencing tokens, and compare-and-delete', () => {
  const redis = new RedisDistributedLockManager();
  const now = 1000000;

  const first = redis.setNxPx('lock:seat:1', 'seat-1', 'buyer-A', 5000, now);
  assert.equal(first.acquired, true);

  const second = redis.setNxPx('lock:seat:1', 'seat-1', 'buyer-B', 5000, now + 100);
  assert.equal(second.acquired, false);
  assert.equal(redis.lockContentionCount, 1);

  assert.equal(redis.compareAndDelete('lock:seat:1', 'buyer-B'), false);

  const afterExpiry = redis.setNxPx('lock:seat:1', 'seat-1', 'buyer-B', 5000, now + 6000);
  assert.equal(afterExpiry.acquired, true);
  assert.ok(afterExpiry.fencingToken > first.fencingToken);
});

test('Seat hold acquires lock, blocks competing buyers, and releases cleanly', () => {
  const store = new TicketingStore(16);

  const holdA = store.acquireInteractiveSeatHold({
    seatNumber: 1,
    buyerId: 'buyer_alpha',
    ttlMs: 30000,
  });
  assert.equal(holdA.ok, true);
  assert.equal(holdA.seat?.status, 'LOCKED');

  const holdB = store.acquireInteractiveSeatHold({
    seatNumber: 1,
    buyerId: 'buyer_beta',
    ttlMs: 30000,
  });
  assert.equal(holdB.ok, false);

  const released = store.releaseInteractiveSeatHold({
    seatNumber: 1,
    buyerId: 'buyer_alpha',
  });
  assert.equal(released.ok, true);
  assert.equal(released.seat?.status, 'AVAILABLE');
});

test('Custom event creation validates inputs and initializes inventory pool', () => {
  const store = new TicketingStore(16);

  assert.throws(() => {
    store.createCustomEvent({
      title: '   ',
      venue: 'London',
      unitPrice: 100,
      totalInventory: 50,
    });
  }, /Event title is required/);

  assert.throws(() => {
    store.createCustomEvent({
      title: 'Valid Event',
      venue: 'London',
      unitPrice: 100,
      totalInventory: 5,
    });
  }, /Inventory pool must be between 10 and 100 units/);

  const created = store.createCustomEvent({
    title: 'Wembley Finals VIP',
    venue: 'Wembley Stadium',
    unitPrice: 350,
    totalInventory: 40,
    category: 'CONCERT_VIP',
  });

  assert.equal(created.totalInventory, 40);
  assert.equal(store.getFullState().seats.length, 40);
  assert.equal(store.getFullState().metrics.inventoryRemaining, 40);
});

test('TicketingStore with REDIS_MUTEX_ACID prevents race conditions across 5,000 concurrent buyers for 50 tickets', async () => {
  const store = new TicketingStore(16);
  store.setStrategy('REDIS_MUTEX_ACID');

  const finalState = await store.runConcurrentStressWave({
    buyerCount: 5000,
    strategy: 'REDIS_MUTEX_ACID',
    batchSize: 1000,
    batchDelayMs: 0,
  });

  assert.equal(finalState.metrics.successfulCheckouts, 50);
  assert.equal(finalState.metrics.doubleSellAnomalies, 0);
  assert.equal(finalState.metrics.inventoryRemaining, 0);
  assert.equal(finalState.metrics.blockedRaceConditions, 4950);

  const soldSeats = finalState.seats.filter((s) => s.status === 'SOLD');
  assert.equal(soldSeats.length, 50);
  for (const seat of soldSeats) {
    assert.equal(seat.sellCount, 1);
  }

  const committedInLedger = finalState.recentTransactions.filter(
    (tx) => tx.status === 'COMMITTED'
  );
  assert.equal(committedInLedger.length, 50);
});

test('TicketingStore with SQL_OPTIMISTIC_OCC and OS_SEMAPHORE_MUTEX guarantees zero double-sells', async () => {
  const store = new TicketingStore(16);

  const occState = await store.runConcurrentStressWave({
    buyerCount: 1000,
    strategy: 'SQL_OPTIMISTIC_OCC',
    batchSize: 500,
    batchDelayMs: 0,
  });
  assert.equal(occState.metrics.successfulCheckouts, 50);
  assert.equal(occState.metrics.doubleSellAnomalies, 0);
  assert.equal(occState.metrics.inventoryRemaining, 0);

  store.resetEventInventory();
  const semState = await store.runConcurrentStressWave({
    buyerCount: 1000,
    strategy: 'OS_SEMAPHORE_MUTEX',
    batchSize: 500,
    batchDelayMs: 0,
  });
  assert.equal(semState.metrics.successfulCheckouts, 50);
  assert.equal(semState.metrics.doubleSellAnomalies, 0);
  assert.equal(semState.metrics.inventoryRemaining, 0);
});

test('TicketingStore with UNPROTECTED_NAIVE reliably exposes race conditions and double-sells', async () => {
  const store = new TicketingStore(16);
  store.resetEventInventory();

  const naiveState = await store.runConcurrentStressWave({
    buyerCount: 500,
    strategy: 'UNPROTECTED_NAIVE',
    batchSize: 250,
    batchDelayMs: 0,
  });

  assert.ok(
    naiveState.metrics.doubleSellAnomalies > 0,
    'Unprotected naive mode should trigger double-sell anomalies under concurrent load'
  );
  assert.ok(
    naiveState.metrics.inventoryRemaining < 0,
    'Unprotected naive mode should oversell inventory below 0'
  );
});
