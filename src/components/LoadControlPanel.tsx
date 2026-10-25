import React from 'react';
import {
  ConcurrencyMetricsSnapshot,
  LockingStrategy,
  StressTestTelemetryPoint,
} from '../types/ticket';
import {
  ShieldCheck,
  AlertTriangle,
  Cpu,
  Database,
  Lock,
  Users,
  Play,
  RotateCcw,
} from 'lucide-react';

interface ConcurrencyPipelineDiagramProps {
  metrics: ConcurrencyMetricsSnapshot;
  telemetryHistory: StressTestTelemetryPoint[];
  onStrategyChange: (strategy: LockingStrategy) => void;
  onSemaphorePermitsChange: (permits: number) => void;
  onRunStressTest: (buyerCount: number) => void;
  onResetInventory: () => void;
}

const STRATEGY_OPTIONS: Array<{
  id: LockingStrategy;
  index: string;
  label: string;
  shortTag: string;
  summary: string;
  isSafe: boolean;
}> = [
  {
    id: 'REDIS_MUTEX_ACID',
    index: '01',
    label: 'Redis Distributed Lock + SQL ACID',
    shortTag: 'SET NX PX + FOR UPDATE',
    summary:
      'OS Counting Semaphore bounds worker pool; Redis SET NX PX issues a monotonic fencing token per seat; SQL SERIALIZABLE transaction commits atomically.',
    isSafe: true,
  },
  {
    id: 'SQL_OPTIMISTIC_OCC',
    index: '02',
    label: 'SQL Optimistic Concurrency (OCC)',
    shortTag: 'WHERE version = v',
    summary:
      'Lock-free read phase followed by atomic compare-and-swap version validation on commit. Conflicting writers immediately roll back without double-selling.',
    isSafe: true,
  },
  {
    id: 'OS_SEMAPHORE_MUTEX',
    index: '03',
    label: 'OS Counting Semaphore + Kernel Mutex',
    shortTag: 'sem_wait + mutex_lock',
    summary:
      'Models classic Operating Systems P()/V() counting semaphore paired with a strict FIFO mutual exclusion lock guarding the critical section.',
    isSafe: true,
  },
  {
    id: 'UNPROTECTED_NAIVE',
    index: '04',
    label: 'Unprotected Naive (Race Condition Demo)',
    shortTag: 'Check-Then-Act Bug',
    summary:
      'Simulates standard unprotected web code: concurrent requests read available_inventory > 0 across an async I/O boundary before writing, causing severe double-sells.',
    isSafe: false,
  },
];

export const ConcurrencyPipelineDiagram: React.FC<ConcurrencyPipelineDiagramProps> = ({
  metrics,
  telemetryHistory,
  onStrategyChange,
  onSemaphorePermitsChange,
  onRunStressTest,
  onResetInventory,
}) => {
  const activeStrategyMeta =
    STRATEGY_OPTIONS.find((s) => s.id === metrics.strategy) || STRATEGY_OPTIONS[0];

  const visualPermitCount = Math.min(16, metrics.semaphoreMaxPermits);
  const activePermitRatio =
    metrics.semaphoreMaxPermits > 0
      ? metrics.semaphoreActivePermits / metrics.semaphoreMaxPermits
      : 0;
  const litPermits = metrics.isSimulationRunning
    ? Math.max(2, Math.round(visualPermitCount * Math.max(0.5, activePermitRatio)))
    : Math.round(visualPermitCount * activePermitRatio);

  return (
    <section
      id="stress-test-lab"
      aria-labelledby="pipeline-heading"
      className="border border-black bg-white"
    >
      {/* Section Header Bar */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 p-6 border-b border-black bg-white">
        <div className="space-y-1">
          <div className="text-xs font-mono text-neutral-500">
            01. Operating Systems &amp; Distributed Locking Engine
          </div>
          <h2 id="pipeline-heading" className="text-xl font-bold tracking-tight text-black">
            Concurrency Control Strategy &amp; 5,000-Buyer Load Generator
          </h2>
          <p className="text-xs text-neutral-600 max-w-2xl">
            Select a locking architecture and dispatch a concurrent wave of virtual buyers to inspect real-time semaphore permits, Redis mutex contention, and SQL transaction isolation.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => onRunStressTest(5000)}
            disabled={metrics.isSimulationRunning}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-white bg-black hover:bg-neutral-800 disabled:opacity-40 transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            {metrics.isSimulationRunning
              ? 'Executing 5,000-Buyer Wave...'
              : 'Simulate 5,000 Concurrent Buyers'}
          </button>

          <button
            type="button"
            onClick={() => onRunStressTest(500)}
            disabled={metrics.isSimulationRunning}
            className="inline-flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-semibold text-black bg-white hover:bg-neutral-100 disabled:opacity-40 border border-black transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            Burst 500 Buyers
          </button>

          <button
            type="button"
            onClick={onResetInventory}
            className="inline-flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-medium text-neutral-700 hover:text-black bg-neutral-100 hover:bg-neutral-200 border border-neutral-300 transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset Inventory
          </button>
        </div>
      </div>

      {/* 4-Column Strategy Selector Grid */}
      <div
        role="radiogroup"
        aria-label="Concurrency Locking Strategy"
        className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 divide-y md:divide-y-0 md:divide-x divide-neutral-200 border-b border-black"
      >
        {STRATEGY_OPTIONS.map((option) => {
          const isSelected = metrics.strategy === option.id;
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={isSelected}
              onClick={() => onStrategyChange(option.id)}
              className={`text-left p-5 transition-colors cursor-pointer flex flex-col justify-between gap-3 ${
                isSelected
                  ? 'bg-black text-white'
                  : 'bg-white text-black hover:bg-neutral-50'
              }`}
            >
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={`text-[11px] font-mono ${
                      isSelected ? 'text-neutral-400' : 'text-neutral-500'
                    }`}
                  >
                    Mode {option.index} · {option.isSafe ? 'ACID Protected' : 'Race Vulnerable'}
                  </span>
                  {option.isSafe ? (
                    <ShieldCheck
                      className={`w-4 h-4 shrink-0 ${
                        isSelected ? 'text-white' : 'text-black'
                      }`}
                    />
                  ) : (
                    <AlertTriangle
                      className={`w-4 h-4 shrink-0 ${
                        isSelected ? 'text-white' : 'text-black'
                      }`}
                    />
                  )}
                </div>
                <div className="text-sm font-bold tracking-tight">
                  {option.label}
                </div>
              </div>
              <div
                className={`text-[11px] font-mono pt-2 border-t ${
                  isSelected
                    ? 'border-neutral-800 text-neutral-300'
                    : 'border-neutral-200 text-neutral-600'
                }`}
              >
                {option.shortTag}
              </div>
            </button>
          );
        })}
      </div>

      {/* Mechanism Specification & OS Semaphore Permit Control Strip */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 px-6 py-3.5 bg-neutral-50 border-b border-black text-xs">
        <div className="flex items-start md:items-center gap-2.5 text-black">
          <span className="font-mono font-bold uppercase px-1.5 py-0.5 border border-black bg-white text-[10px] shrink-0">
            {activeStrategyMeta.isSafe ? 'INVARIANT SAFE' : 'RACE CONDITION DEMO'}
          </span>
          <span className="text-neutral-700">{activeStrategyMeta.summary}</span>
        </div>

        <div className="flex items-center gap-3 shrink-0 border-t md:border-t-0 pt-2 md:pt-0 border-neutral-200">
          <label
            htmlFor="semaphore-permits-slider"
            className="text-neutral-700 font-medium whitespace-nowrap"
          >
            OS Semaphore Permits (K):{' '}
            <span className="font-mono text-black font-bold tabular-nums">
              {metrics.semaphoreMaxPermits}
            </span>
          </label>
          <input
            id="semaphore-permits-slider"
            type="range"
            min={4}
            max={64}
            step={4}
            value={metrics.semaphoreMaxPermits}
            onChange={(e) => onSemaphorePermitsChange(Number(e.target.value))}
            className="w-28 accent-black cursor-pointer"
          />
        </div>
      </div>

      {/* 4-Stage Kernel & Distributed Lock Execution Pipeline */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 divide-y md:divide-y-0 md:divide-x divide-neutral-200">
        {/* Stage 1: Ingress Request Burst */}
        <div className="p-5 flex flex-col justify-between gap-4 bg-white">
          <div className="flex items-center justify-between text-xs text-neutral-500">
            <span className="font-mono font-semibold text-black">01 / INGRESS QUEUE</span>
            <Users className="w-4 h-4 text-black" />
          </div>
          <div className="space-y-1">
            <div className="text-3xl font-bold font-mono tabular-nums text-black">
              {metrics.queueDepth.toLocaleString()}
            </div>
            <div className="text-xs text-neutral-600">
              In-Flight Buyer Threads · <span className="font-mono tabular-nums font-semibold text-black">{metrics.totalRequestsProcessed.toLocaleString()}</span> Completed
            </div>
          </div>
          <div className="w-full bg-neutral-200 h-2 overflow-hidden">
            <div
              className="bg-black h-full transition-transform duration-150 origin-left"
              style={{
                transform: `scaleX(${Math.min(1, metrics.queueDepth / 2500 || (metrics.totalRequestsProcessed > 0 ? 1 : 0.03))})`,
              }}
            />
          </div>
        </div>

        {/* Stage 2: OS Counting Semaphore Pool */}
        <div className="p-5 flex flex-col justify-between gap-4 bg-white">
          <div className="flex items-center justify-between text-xs text-neutral-500">
            <span className="font-mono font-semibold text-black">02 / OS SEMAPHORE P(S)</span>
            <Cpu className="w-4 h-4 text-black" />
          </div>
          <div className="space-y-1">
            <div className="text-3xl font-bold font-mono tabular-nums text-black">
              {metrics.semaphoreMaxPermits} Permits
            </div>
            <div className="text-xs text-neutral-600">
              Wait Queue: <span className="font-mono tabular-nums font-semibold text-black">{metrics.semaphoreWaitQueue}</span> · Bounds DB Workers
            </div>
          </div>
          <div className="grid grid-cols-8 gap-1 pt-0.5" aria-label="Semaphore permit slots">
            {Array.from({ length: visualPermitCount }).map((_, idx) => (
              <div
                key={idx}
                className={`h-2.5 border border-black transition-opacity duration-150 ${
                  idx < litPermits ? 'bg-black' : 'bg-white'
                }`}
              />
            ))}
          </div>
        </div>

        {/* Stage 3: Redis Distributed Lock (Redlock / SET NX PX) */}
        <div className="p-5 flex flex-col justify-between gap-4 bg-white">
          <div className="flex items-center justify-between text-xs text-neutral-500">
            <span className="font-mono font-semibold text-black">03 / REDIS MUTEX GATE</span>
            <Lock className="w-4 h-4 text-black" />
          </div>
          <div className="space-y-1">
            <div className="text-3xl font-bold font-mono tabular-nums text-black">
              {metrics.lockContentionCount.toLocaleString()}
            </div>
            <div className="text-xs text-neutral-600">
              Mutex Rejections · <span className="font-mono tabular-nums font-semibold text-black">{metrics.redisActiveLocksCount}</span> Active Holds
            </div>
          </div>
          <div className="text-[11px] font-mono text-neutral-600 truncate border-t border-neutral-200 pt-2">
            {metrics.strategy === 'UNPROTECTED_NAIVE'
              ? 'WARNING: Mutex Bypassed (No Lock)'
              : 'CMD: SET lock:event:seat NX PX 10000'}
          </div>
        </div>

        {/* Stage 4: SQL ACID Commit & Race Audit */}
        <div className="p-5 flex flex-col justify-between gap-4 bg-white">
          <div className="flex items-center justify-between text-xs text-neutral-500">
            <span className="font-mono font-semibold text-black">04 / SQL ACID COMMIT</span>
            <Database className="w-4 h-4 text-black" />
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <div>
              <div className="text-3xl font-bold font-mono tabular-nums text-black">
                {metrics.successfulCheckouts.toLocaleString()}
              </div>
              <div className="text-xs text-neutral-600">Committed Rows</div>
            </div>
            <div className="text-right">
              <div
                className={`text-3xl font-bold font-mono tabular-nums px-1.5 ${
                  metrics.doubleSellAnomalies > 0 ? 'bg-black text-white' : 'text-black'
                }`}
              >
                {metrics.doubleSellAnomalies.toLocaleString()}
              </div>
              <div className="text-xs text-neutral-600">Double-Sells</div>
            </div>
          </div>
          <div className="text-[11px] font-mono text-neutral-600 truncate border-t border-neutral-200 pt-2">
            {metrics.doubleSellAnomalies > 0
              ? `CRITICAL: ${metrics.doubleSellAnomalies} Corrupted Overwrites!`
              : `Blocked ${metrics.blockedRaceConditions.toLocaleString()} Excess Requests`}
          </div>
        </div>
      </div>

      {/* Live Telemetry Sparkline / Wave History Bar Chart */}
      {telemetryHistory.length > 0 && (
        <div className="p-5 border-t border-black bg-neutral-50 space-y-2.5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-neutral-600">
            <span className="font-semibold text-black">
              Real-Time Wave Throughput &amp; Contention Distribution
            </span>
            <span className="font-mono tabular-nums text-black">
              Peak Throughput: {Math.max(...telemetryHistory.map((t) => t.throughputRps), 0).toLocaleString()} req/s · P99 Latency: {metrics.p99LatencyMs} ms
            </span>
          </div>
          <div className="h-16 flex items-end gap-1 pt-2 px-2 bg-white border border-black">
            {telemetryHistory.slice(-32).map((pt) => {
              const heightPct = Math.max(
                14,
                Math.min(100, Math.round((pt.throughputRps / 15000) * 100))
              );
              return (
                <div
                  key={pt.tick}
                  className="flex-1 flex flex-col items-center justify-end h-full group relative"
                  title={`Tick #${pt.tick} (${pt.timestamp}): ${pt.throughputRps} req/s, Blocked: ${pt.blockedRaceConditions}, Double-Sells: ${pt.doubleSells}`}
                >
                  <div
                    className={`w-full transition-transform duration-150 ${
                      pt.doubleSells > 0
                        ? 'pattern-diagonal-lines border border-black'
                        : 'bg-black'
                    }`}
                    style={{ height: `${heightPct}%` }}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
};
