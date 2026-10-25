import React, { useState } from 'react';
import { SqlTransactionLog } from '../types/ticket';
import {
  CheckCircle2,
  ShieldAlert,
  Ban,
  Search,
  Download,
  Terminal,
  Play,
} from 'lucide-react';

interface SqlAndLockLedgerProps {
  transactions: SqlTransactionLog[];
  onRunStressTest: (buyerCount: number) => void;
}

export const SqlAndLockLedger: React.FC<SqlAndLockLedgerProps> = ({
  transactions,
  onRunStressTest,
}) => {
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const filteredTx = transactions.filter((tx) => {
    if (statusFilter === 'COMMITTED' && tx.status !== 'COMMITTED') return false;
    if (
      statusFilter === 'BLOCKED' &&
      tx.status !== 'BLOCKED_LOCK_CONTENTION' &&
      tx.status !== 'BLOCKED_SOLD_OUT' &&
      tx.status !== 'ROLLED_BACK_OCC'
    ) {
      return false;
    }
    if (statusFilter === 'ANOMALY' && tx.status !== 'RACE_CONDITION_OVERWRITE') {
      return false;
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        tx.txId.toLowerCase().includes(q) ||
        tx.buyerId.toLowerCase().includes(q) ||
        tx.buyerName.toLowerCase().includes(q) ||
        tx.sqlStatement.toLowerCase().includes(q) ||
        `seat ${tx.seatNumber}`.includes(q)
      );
    }
    return true;
  });

  const handleDownloadCsv = () => {
    const headers = [
      'txId',
      'timestamp',
      'strategy',
      'isolationLevel',
      'seatNumber',
      'buyerId',
      'fencingToken',
      'status',
      'latencyMs',
      'sqlStatement',
    ];
    const rows = filteredTx.map((t) =>
      [
        t.txId,
        t.timestamp,
        t.strategy,
        t.isolationLevel,
        t.seatNumber,
        t.buyerId,
        t.fencingToken,
        t.status,
        t.latencyMs,
        `"${t.sqlStatement.replace(/"/g, '""')}"`,
      ].join(',')
    );
    const csvContent = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `aegislock-sql-audit-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const committedCount = transactions.filter((t) => t.status === 'COMMITTED').length;
  const blockedCount = transactions.filter(
    (t) =>
      t.status === 'BLOCKED_LOCK_CONTENTION' ||
      t.status === 'BLOCKED_SOLD_OUT' ||
      t.status === 'ROLLED_BACK_OCC'
  ).length;
  const anomalyCount = transactions.filter(
    (t) => t.status === 'RACE_CONDITION_OVERWRITE'
  ).length;

  return (
    <section
      id="sql-ledger"
      aria-labelledby="sql-ledger-heading"
      className="border border-black bg-white"
    >
      {/* Top Row: Section Heading + Export Action */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-6 border-b border-black">
        <div>
          <div className="text-xs font-mono text-neutral-500">
            03. Relational Transaction &amp; Distributed Lock Audit Trail
          </div>
          <h2 id="sql-ledger-heading" className="text-xl font-bold tracking-tight text-black">
            Real-Time SQL Write-Ahead Log &amp; Redis Lock Ledger
          </h2>
          <p className="text-xs text-neutral-600 mt-0.5">
            Inspect executed SQL statements, fencing token validations, lock contention rejections, and race-condition overwrites.
          </p>
        </div>

        <button
          type="button"
          onClick={handleDownloadCsv}
          disabled={filteredTx.length === 0}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-black bg-white hover:bg-neutral-100 disabled:opacity-40 border border-black transition-colors cursor-pointer whitespace-nowrap shrink-0 self-start sm:self-auto"
        >
          <Download className="w-3.5 h-3.5" />
          Download Audit CSV
        </button>
      </div>

      {/* Dedicated Single-Row Filter & Search Toolbar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 px-6 py-3.5 bg-neutral-50 border-b border-black">
        <div
          role="tablist"
          aria-label="Filter transaction log by status"
          className="flex flex-wrap items-center border border-black bg-white"
        >
          {[
            { id: 'ALL', label: `All Logs (${transactions.length})` },
            { id: 'COMMITTED', label: `Committed (${committedCount})` },
            { id: 'BLOCKED', label: `Blocked / Contention (${blockedCount})` },
            { id: 'ANOMALY', label: `Race Overwrites (${anomalyCount})` },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={statusFilter === tab.id}
              onClick={() => setStatusFilter(tab.id)}
              className={`px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 tabular-nums border-r last:border-r-0 border-neutral-200 ${
                statusFilter === tab.id
                  ? 'bg-black text-white'
                  : 'bg-white text-neutral-700 hover:bg-neutral-100 hover:text-black'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="relative w-full md:w-72">
          <Search className="w-3.5 h-3.5 text-neutral-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="search"
            aria-label="Search SQL transaction logs"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter by tx_id, buyer, SQL..."
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-white border border-black text-black placeholder:text-neutral-500 focus:outline-none focus:ring-1 focus:ring-black"
          />
        </div>
      </div>

      {/* Populated vs Empty State */}
      {filteredTx.length === 0 ? (
        <div className="py-14 px-6 text-center bg-white space-y-3">
          <Terminal className="w-6 h-6 text-black mx-auto" />
          <div className="space-y-1">
            <p className="text-sm font-bold text-black">
              No SQL or Redis transaction logs recorded in current filter view
            </p>
            <p className="text-xs text-neutral-600 max-w-md mx-auto">
              Trigger a 5,000-buyer concurrent flash-sale wave or click any seat in the matrix above to inspect live SQL ACID statements and Redis fencing tokens.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onRunStressTest(5000)}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-black hover:bg-neutral-800 transition-colors cursor-pointer"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            Simulate 5,000 Concurrent Buyers Now
          </button>
        </div>
      ) : (
        <div className="overflow-x-auto bg-white">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-black text-black bg-neutral-100 font-mono uppercase text-[11px]">
                <th className="py-2.5 px-4 font-bold whitespace-nowrap">TX ID</th>
                <th className="py-2.5 px-4 font-bold whitespace-nowrap">Outcome Status</th>
                <th className="py-2.5 px-4 font-bold whitespace-nowrap">Seat</th>
                <th className="py-2.5 px-4 font-bold whitespace-nowrap">Buyer ID</th>
                <th className="py-2.5 px-4 font-bold whitespace-nowrap text-right">Fencing Token</th>
                <th className="py-2.5 px-4 font-bold whitespace-nowrap text-right">Latency</th>
                <th className="py-2.5 px-4 font-bold">Executed SQL / Redis Command Trace</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200 font-mono">
              {filteredTx.slice(0, 40).map((tx) => (
                <tr key={tx.txId} className="hover:bg-neutral-50 transition-colors">
                  <td className="py-2.5 px-4 text-black font-semibold whitespace-nowrap tabular-nums">
                    {tx.txId}
                  </td>
                  <td className="py-2.5 px-4 whitespace-nowrap">
                    {tx.status === 'COMMITTED' && (
                      <span className="inline-flex items-center gap-1.5 text-black font-bold">
                        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                        COMMITTED
                      </span>
                    )}
                    {(tx.status === 'BLOCKED_LOCK_CONTENTION' ||
                      tx.status === 'BLOCKED_SOLD_OUT' ||
                      tx.status === 'ROLLED_BACK_OCC') && (
                      <span className="inline-flex items-center gap-1.5 text-neutral-600">
                        <Ban className="w-3.5 h-3.5 shrink-0" />
                        {tx.status === 'BLOCKED_LOCK_CONTENTION'
                          ? 'MUTEX BLOCKED'
                          : tx.status === 'ROLLED_BACK_OCC'
                          ? 'OCC ROLLBACK'
                          : 'SOLD OUT REJECT'}
                      </span>
                    )}
                    {tx.status === 'RACE_CONDITION_OVERWRITE' && (
                      <span className="inline-flex items-center gap-1.5 bg-black text-white px-2 py-0.5 font-bold">
                        <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                        DOUBLE-SELL RACE!
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 px-4 text-black font-semibold whitespace-nowrap tabular-nums">
                    {tx.seatNumber > 0 ? `#${tx.seatNumber.toString().padStart(2, '0')}` : 'Pool'}
                  </td>
                  <td className="py-2.5 px-4 text-neutral-700 whitespace-nowrap">
                    {tx.buyerId}
                  </td>
                  <td className="py-2.5 px-4 text-right text-black whitespace-nowrap tabular-nums">
                    {tx.fencingToken > 0 ? `#${tx.fencingToken}` : '—'}
                  </td>
                  <td className="py-2.5 px-4 text-right text-neutral-700 whitespace-nowrap tabular-nums">
                    {tx.latencyMs.toFixed(2)} ms
                  </td>
                  <td className="py-2.5 px-4 text-neutral-800 max-w-xl truncate" title={tx.sqlStatement}>
                    {tx.sqlStatement}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};
