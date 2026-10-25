import React from 'react';
import { ConcurrencyMetricsSnapshot } from '../types/ticket';
import { ShieldCheck, AlertTriangle } from 'lucide-react';

interface ArchitectureComparisonSectionProps {
  metrics: ConcurrencyMetricsSnapshot;
  onRunComparisonDemo: (strategy: 'REDIS_MUTEX_ACID' | 'UNPROTECTED_NAIVE') => void;
}

export const ArchitectureComparisonSection: React.FC<ArchitectureComparisonSectionProps> = ({
  metrics,
  onRunComparisonDemo,
}) => {
  return (
    <section
      id="os-architecture"
      aria-labelledby="architecture-heading"
      className="border border-black bg-white"
    >
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-6 border-b border-black">
        <div>
          <div className="text-xs font-mono text-neutral-500">
            04. Systems Architecture &amp; Critical Section Proof
          </div>
          <h2 id="architecture-heading" className="text-xl font-bold tracking-tight text-black">
            Operating Systems &amp; Database Locking Architecture Comparison
          </h2>
          <p className="text-xs text-neutral-600 mt-0.5">
            Why standard web applications double-sell flash-sale inventory under high concurrency—and how OS semaphores, Redis fencing tokens, and SQL row locks prevent it.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-black">
        {/* Vulnerable Naive Implementation */}
        <div className="p-6 flex flex-col justify-between space-y-5 bg-white">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-black inline-flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" />
                Naive Unprotected Check-Then-Act (Race Condition)
              </span>
              <span className="text-xs font-mono text-neutral-500">READ COMMITTED · No Mutex</span>
            </div>

            <p className="text-xs text-neutral-700 leading-relaxed">
              When 5,000 requests execute <code className="font-semibold text-black">SELECT available_inventory</code> at the exact same millisecond, all 5,000 threads read <code className="font-semibold text-black">available &gt; 0</code> before the first <code className="font-semibold text-black">UPDATE</code> finishes its network I/O round-trip.
            </p>

            <pre className="p-4 bg-neutral-100 border border-black text-[11px] font-mono text-black overflow-x-auto leading-relaxed">
{`// VULNERABLE: Non-atomic Read-Then-Write across async I/O
const seat = await db.query(
  "SELECT status FROM seats WHERE seat_no = $1", [seatNo]
);
if (seat.status === 'AVAILABLE') {
  // 500 concurrent requests pass this check simultaneously!
  await paymentGateway.authorize(buyerId);
  await db.query(
    "UPDATE seats SET status = 'SOLD', buyer = $1 WHERE seat_no = $2",
    [buyerId, seatNo]
  ); // Overwrites previous buyer -> Double-Sell!
}`}
            </pre>
          </div>

          <div className="pt-4 border-t border-neutral-200 flex items-center justify-between gap-4">
            <span className="text-xs text-neutral-600">
              Outcome: <strong className="text-black underline">Double-sold seats &amp; negative inventory</strong>
            </span>
            <button
              type="button"
              onClick={() => onRunComparisonDemo('UNPROTECTED_NAIVE')}
              disabled={metrics.isSimulationRunning}
              className="px-4 py-2 text-xs font-bold text-black bg-white hover:bg-neutral-100 disabled:opacity-40 border border-black transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              Demonstrate Race Bug (500 Buyers)
            </button>
          </div>
        </div>

        {/* Protected AegisLock Implementation */}
        <div className="p-6 flex flex-col justify-between space-y-5 bg-white">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-black inline-flex items-center gap-2">
                <ShieldCheck className="w-4 h-4" />
                OS Semaphore + Redis Redlock + SQL ACID Transaction
              </span>
              <span className="text-xs font-mono text-neutral-500">SET NX PX + FOR UPDATE</span>
            </div>

            <p className="text-xs text-neutral-700 leading-relaxed">
              An OS Counting Semaphore (<code className="font-semibold text-black">sem_wait</code>) bounds concurrent DB workers to <code className="font-semibold text-black">K={metrics.semaphoreMaxPermits}</code>. Redis <code className="font-semibold text-black">SET key token NX PX 10000</code> grants an exclusive monotonic fencing token, and SQL <code className="font-semibold text-black">SELECT ... FOR UPDATE</code> serializes the row commit.
            </p>

            <pre className="p-4 bg-black text-white border border-black text-[11px] font-mono overflow-x-auto leading-relaxed">
{`// PROTECTED: Semaphore + Redis Fencing Token + SQL Row Lock
const releasePermit = await dbPoolSemaphore.acquire(); // P(S)
try {
  const { acquired, fencingToken } = await redis.setNxPx(
    \`lock:event:\${eventId}:seat:\${seatNo}\`, buyerId, 10000
  );
  if (!acquired) return rejectContention();
  await db.transaction('SERIALIZABLE', async (tx) => {
    const row = await tx.query(
      "SELECT status, token FROM seats WHERE seat_no = $1 FOR UPDATE", [seatNo]
    );
    if (row.status !== 'AVAILABLE' || row.token >= fencingToken) throw Rollback();
    await tx.query("UPDATE seats SET status='SOLD', token=$1 WHERE seat_no=$2", [fencingToken, seatNo]);
  });
} finally { releasePermit(); /* V(S) */ }`}
            </pre>
          </div>

          <div className="pt-4 border-t border-neutral-200 flex items-center justify-between gap-4">
            <span className="text-xs text-neutral-600">
              Outcome: <strong className="text-black">Exactly 50 sold · 0 double-sells · 4,950 blocked</strong>
            </span>
            <button
              type="button"
              onClick={() => onRunComparisonDemo('REDIS_MUTEX_ACID')}
              disabled={metrics.isSimulationRunning}
              className="px-4 py-2 text-xs font-bold text-white bg-black hover:bg-neutral-800 disabled:opacity-40 transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              Verify Protected Mode (5,000 Buyers)
            </button>
          </div>
        </div>
      </div>
    </section>
  );
};
