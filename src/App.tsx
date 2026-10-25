import React, { useEffect, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import {
  ConcurrencyMetricsSnapshot,
  FlashSaleEvent,
  LockingStrategy,
  RedisLockEntry,
  SeatRecord,
  SqlTransactionLog,
  StressTestTelemetryPoint,
} from './types/ticket';
import { ConcurrencyPipelineDiagram as LoadControlPanel } from './components/LoadControlPanel';
import { SeatMatrixAndCheckout as SeatMap } from './components/SeatMap';
import { SqlAndLockLedger as TransactionLogTable } from './components/TransactionLogTable';
import { ArchitectureComparisonSection as LockComparisonView } from './components/LockComparisonView';
import { EnterpriseAndCvSection as IntegrationDocs } from './components/IntegrationDocs';
import { NewEventModal as CreateEventModal } from './components/CreateEventModal';
import {
  Play,
  Plus,
  ShieldCheck,
  AlertOctagon,
  RotateCcw,
} from 'lucide-react';

interface EngineFullState {
  activeEvent: FlashSaleEvent;
  events: FlashSaleEvent[];
  seats: SeatRecord[];
  activeRedisLocks: RedisLockEntry[];
  recentTransactions: SqlTransactionLog[];
  telemetryHistory: StressTestTelemetryPoint[];
  metrics: ConcurrencyMetricsSnapshot;
}

export default function App() {
  const [engineState, setEngineState] = useState<EngineFullState | null>(null);
  const [selectedSeatNumber, setSelectedSeatNumber] = useState<number>(1);
  const [isNewEventModalOpen, setIsNewEventModalOpen] = useState<boolean>(false);
  const [socketConnected, setSocketConnected] = useState<boolean>(false);

  const fetchInitialState = useCallback(async () => {
    try {
      const res = await fetch('/api/state');
      if (res.ok) {
        const data = (await res.json()) as EngineFullState;
        setEngineState(data);
      }
    } catch (err) {
      console.error('Failed to fetch initial state:', err);
    }
  }, []);

  useEffect(() => {
    fetchInitialState();

    const socket: Socket = io({
      path: '/socket.io',
      transports: ['websocket', 'polling'],
    });

    socket.on('connect', () => {
      setSocketConnected(true);
    });

    socket.on('disconnect', () => {
      setSocketConnected(false);
    });

    socket.on('engine:state', (incomingState: EngineFullState) => {
      setEngineState(incomingState);
    });

    return () => {
      socket.disconnect();
    };
  }, [fetchInitialState]);

  const handleRunStressTest = async (buyerCount = 5000, customStrategy?: LockingStrategy) => {
    try {
      const res = await fetch('/api/stress-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          buyerCount,
          strategy: customStrategy || engineState?.metrics.strategy,
        }),
      });
      if (res.ok) {
        const json = await res.json();
        if (json.state) setEngineState(json.state);
      }
    } catch (err) {
      console.error('Failed to start stress test:', err);
    }
  };

  const handleStrategyChange = async (strategy: LockingStrategy) => {
    try {
      const res = await fetch('/api/strategy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ strategy }),
      });
      if (res.ok) {
        const data = await res.json();
        setEngineState(data);
      }
    } catch (err) {
      console.error('Failed to update strategy:', err);
    }
  };

  const handleSelectEvent = async (eventId: string) => {
    try {
      const res = await fetch('/api/event/select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId }),
      });
      if (res.ok) {
        const data = await res.json();
        setEngineState(data);
        setSelectedSeatNumber(1);
      }
    } catch (err) {
      console.error('Failed to switch event:', err);
    }
  };

  const handleSemaphorePermitsChange = async (maxPermits: number) => {
    try {
      const res = await fetch('/api/semaphore-permits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxPermits }),
      });
      if (res.ok) {
        const data = await res.json();
        setEngineState(data);
      }
    } catch (err) {
      console.error('Failed to change semaphore permits:', err);
    }
  };

  const handleResetInventory = async () => {
    try {
      const res = await fetch('/api/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId: engineState?.activeEvent.id }),
      });
      if (res.ok) {
        const data = await res.json();
        setEngineState(data);
      }
    } catch (err) {
      console.error('Failed to reset inventory:', err);
    }
  };

  const handleAcquireSeatHold = async (
    seatNumber: number,
    buyerId: string
  ): Promise<{ ok: boolean; reason?: string }> => {
    try {
      const res = await fetch('/api/seat/hold', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventId: engineState?.activeEvent.id,
          seatNumber,
          buyerId,
          ttlMs: 30000,
        }),
      });
      const data = await res.json();
      if (data.state) setEngineState(data.state);
      return { ok: Boolean(data.ok), reason: data.reason };
    } catch {
      return { ok: false, reason: 'Network error acquiring lock.' };
    }
  };

  const handleReleaseSeatHold = async (seatNumber: number, buyerId: string) => {
    try {
      const res = await fetch('/api/seat/release', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventId: engineState?.activeEvent.id,
          seatNumber,
          buyerId,
        }),
      });
      const data = await res.json();
      if (data.state) setEngineState(data.state);
    } catch (err) {
      console.error('Failed to release lock:', err);
    }
  };

  const handleCheckoutSeat = async (
    seatNumber: number,
    buyerId: string,
    buyerName: string
  ) => {
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventId: engineState?.activeEvent.id,
          seatNumber,
          buyerId,
          buyerName,
        }),
      });
      const data = await res.json();
      if (data.state) setEngineState(data.state);
    } catch (err) {
      console.error('Failed checkout:', err);
    }
  };

  const handleCreateCustomEvent = async (payload: {
    title: string;
    venue: string;
    unitPrice: number;
    totalInventory: number;
    category: FlashSaleEvent['category'];
  }): Promise<{ ok: boolean; error?: string }> => {
    try {
      const res = await fetch('/api/event/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        return { ok: false, error: data.error || 'Could not create event.' };
      }
      if (data.state) setEngineState(data.state);
      return { ok: true };
    } catch {
      return { ok: false, error: 'Network error creating event.' };
    }
  };

  const handleRunComparisonDemo = async (
    strategy: 'REDIS_MUTEX_ACID' | 'UNPROTECTED_NAIVE'
  ) => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    await handleResetInventory();
    await handleStrategyChange(strategy);
    await handleRunStressTest(strategy === 'UNPROTECTED_NAIVE' ? 500 : 5000, strategy);
  };

  if (!engineState) {
    return (
      <div className="min-h-screen bg-white text-black flex items-center justify-center p-6">
        <div className="max-w-md w-full border border-black bg-white p-6 space-y-3">
          <div className="h-5 w-48 bg-neutral-200 animate-pulse" />
          <div className="h-3 w-full bg-neutral-100 animate-pulse" />
          <div className="h-3 w-3/4 bg-neutral-100 animate-pulse" />
        </div>
      </div>
    );
  }

  const {
    activeEvent,
    events,
    seats,
    activeRedisLocks,
    recentTransactions,
    telemetryHistory,
    metrics,
  } = engineState;

  return (
    <div className="min-h-screen bg-white text-black flex flex-col">
      <header className="sticky top-0 z-40 flex items-center justify-between gap-8 px-6 py-4 border-b border-black bg-white">
        <a
          href="#top"
          className="text-lg font-bold tracking-tight text-black whitespace-nowrap shrink-0"
        >
          AegisLock
        </a>

        <nav
          aria-label="Primary Workspace Navigation"
          className="hidden md:flex items-center gap-7 text-sm font-medium text-neutral-700"
        >
          <a
            href="#stress-test-lab"
            className="hover:text-black hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
          >
            Stress Test Lab
          </a>
          <a
            href="#seat-matrix"
            className="hover:text-black hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
          >
            Venue Seat Matrix
          </a>
          <a
            href="#sql-ledger"
            className="hover:text-black hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
          >
            SQL Audit Ledger
          </a>
          <a
            href="#os-architecture"
            className="hover:text-black hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
          >
            OS Architecture
          </a>
          <a
            href="#enterprise-sdk"
            className="hover:text-black hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
          >
            SDK &amp; Benchmarks
          </a>
        </nav>

        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => handleRunStressTest(5000)}
            disabled={metrics.isSimulationRunning}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-bold text-white bg-black hover:bg-neutral-800 disabled:opacity-40 transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            Simulate 5,000 Buyers
          </button>
        </div>
      </header>

      <main id="top" className="flex-1 max-w-[1440px] w-full mx-auto px-6 py-8 space-y-8">
        <section className="space-y-6">
          <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6">
            <div className="space-y-2 max-w-3xl">
              <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-600 font-mono">
                <span>OS Counting Semaphores</span>
                <span aria-hidden="true">·</span>
                <span>Redis Redlock (SET NX PX)</span>
                <span aria-hidden="true">·</span>
                <span>PostgreSQL / MySQL Serializable ACID</span>
                <span aria-hidden="true">·</span>
                <span className="font-semibold text-black">
                  {socketConnected ? 'WebSocket Stream Connected' : 'HTTP Sync Active'}
                </span>
              </div>
              <h1
                className="text-3xl sm:text-4xl font-bold tracking-tight text-black"
                style={{ textWrap: 'balance' }}
              >
                High-Concurrency Flash-Sale &amp; Live Ticketing Engine
              </h1>
              <p className="text-sm text-neutral-700 leading-relaxed max-w-2xl">
                Stress-test 5,000 simultaneous virtual buyers competing for 50 scarce event tickets at the exact same millisecond. Compare Redis distributed mutexes and SQL row locking against naive read-then-write race conditions in real time.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <div
                role="group"
                aria-label="Select active flash-sale event"
                className="flex flex-wrap items-center border border-black bg-white"
              >
                {events.map((ev) => (
                  <button
                    key={ev.id}
                    type="button"
                    onClick={() => handleSelectEvent(ev.id)}
                    className={`px-3.5 py-2 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 border-r last:border-r-0 border-neutral-200 ${
                      activeEvent.id === ev.id
                        ? 'bg-black text-white'
                        : 'bg-white text-neutral-700 hover:bg-neutral-100 hover:text-black'
                    }`}
                  >
                    {ev.title.split('—')[0].trim()}
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={() => setIsNewEventModalOpen(true)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-black bg-white hover:bg-neutral-100 border border-black transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                New Flash-Sale Event
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 border border-black divide-y sm:divide-y-0 sm:divide-x divide-black bg-white">
            <div className="p-5 flex flex-col justify-between gap-2">
              <div className="flex items-center justify-between text-xs text-neutral-600">
                <span className="font-semibold text-black">Remaining Inventory Pool</span>
                <span className="font-mono">of {metrics.totalInventory} Units</span>
              </div>
              <div
                data-testid="metric-inventory-remaining"
                className="text-4xl font-bold font-mono tabular-nums text-black"
              >
                {metrics.inventoryRemaining}
              </div>
              <div className="text-xs text-neutral-600 font-mono">
                {metrics.inventoryRemaining < 0
                  ? `! OVERSOLD BY ${Math.abs(metrics.inventoryRemaining)} UNITS`
                  : `${activeEvent.venue} · $${activeEvent.unitPrice}/unit`}
              </div>
            </div>

            <div className="p-5 flex flex-col justify-between gap-2">
              <div className="flex items-center justify-between text-xs text-neutral-600">
                <span className="font-semibold text-black">Successful Checkouts</span>
                <span className="font-mono font-bold text-black">COMMITTED</span>
              </div>
              <div
                data-testid="metric-successful-checkouts"
                className="text-4xl font-bold font-mono tabular-nums text-black"
              >
                {metrics.successfulCheckouts.toLocaleString()}
              </div>
              <div className="text-xs text-neutral-600 font-mono tabular-nums">
                Settled Volume: ${(metrics.successfulCheckouts * activeEvent.unitPrice).toLocaleString()}
              </div>
            </div>

            <div className="p-5 flex flex-col justify-between gap-2">
              <div className="flex items-center justify-between text-xs text-neutral-600">
                <span className="font-semibold text-black">Blocked Race Conditions</span>
                <span className="font-mono text-neutral-600">MUTEX / SOLD OUT</span>
              </div>
              <div
                data-testid="metric-blocked-races"
                className="text-4xl font-bold font-mono tabular-nums text-black"
              >
                {metrics.blockedRaceConditions.toLocaleString()}
              </div>
              <div className="text-xs text-neutral-600 font-mono tabular-nums">
                Total Requests Processed: {metrics.totalRequestsProcessed.toLocaleString()}
              </div>
            </div>

            <div
              className={`p-5 flex flex-col justify-between gap-2 ${
                metrics.doubleSellAnomalies > 0 ? 'bg-black text-white' : 'bg-white text-black'
              }`}
            >
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold">Double-Sell Race Collisions</span>
                {metrics.doubleSellAnomalies === 0 ? (
                  <span className="inline-flex items-center gap-1 font-mono font-bold">
                    <ShieldCheck className="w-3.5 h-3.5" /> ZERO RACES
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 font-mono font-bold underline">
                    <AlertOctagon className="w-3.5 h-3.5" /> CORRUPTED
                  </span>
                )}
              </div>
              <div
                data-testid="metric-double-sells"
                className="text-4xl font-bold font-mono tabular-nums"
              >
                {metrics.doubleSellAnomalies.toLocaleString()}
              </div>
              <div
                className={`text-xs font-mono ${
                  metrics.doubleSellAnomalies > 0 ? 'text-neutral-300' : 'text-neutral-600'
                }`}
              >
                {metrics.doubleSellAnomalies > 0
                  ? 'Multiple buyers overwrote identical seat rows!'
                  : 'Strict mutual exclusion invariant preserved'}
              </div>
            </div>
          </div>
        </section>

        <LoadControlPanel
          metrics={metrics}
          telemetryHistory={telemetryHistory}
          onStrategyChange={handleStrategyChange}
          onSemaphorePermitsChange={handleSemaphorePermitsChange}
          onRunStressTest={(count) => handleRunStressTest(count)}
          onResetInventory={handleResetInventory}
        />

        <SeatMap
          activeEvent={activeEvent}
          seats={seats}
          activeRedisLocks={activeRedisLocks}
          selectedSeatNumber={selectedSeatNumber}
          onSelectSeat={setSelectedSeatNumber}
          onAcquireSeatHold={handleAcquireSeatHold}
          onReleaseSeatHold={handleReleaseSeatHold}
          onCheckoutSeat={handleCheckoutSeat}
        />

        <TransactionLogTable
          transactions={recentTransactions}
          onRunStressTest={(count) => handleRunStressTest(count)}
        />

        <LockComparisonView
          metrics={metrics}
          onRunComparisonDemo={handleRunComparisonDemo}
        />

        <IntegrationDocs
          activeEvent={activeEvent}
          metrics={metrics}
        />
      </main>

      <footer className="border-t border-black py-6 px-6 mt-12 bg-white">
        <div className="max-w-[1440px] mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-neutral-600">
          <div className="font-mono">
            AegisLock High-Concurrency Ticketing &amp; Flash-Sale Engine · OS Semaphores, Redis Distributed Locks &amp; SQL ACID Transactions
          </div>
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={handleResetInventory}
              className="inline-flex items-center gap-1.5 font-semibold text-black hover:underline cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset All Event State
            </button>
          </div>
        </div>
      </footer>

      <CreateEventModal
        isOpen={isNewEventModalOpen}
        onClose={() => setIsNewEventModalOpen(false)}
        onCreateEvent={handleCreateCustomEvent}
      />
    </div>
  );
}
