import React, { useState, useEffect } from 'react';
import {
  FlashSaleEvent,
  RedisLockEntry,
  SeatRecord,
} from '../types/ticket';
import {
  CheckCircle2,
  Lock,
  Unlock,
  AlertOctagon,
  CircleDot,
  ShoppingCart,
  KeyRound,
  Ticket,
  X,
  Printer,
} from 'lucide-react';

export interface IssuedTicketReceipt {
  ticketId: string;
  eventTitle: string;
  venue: string;
  seatLabel: string;
  section: string;
  buyerName: string;
  buyerEmail: string;
  price: number;
  fencingToken: number;
  txId: string;
  signatureHash: string;
  issuedAt: string;
}

interface SeatMatrixAndCheckoutProps {
  activeEvent: FlashSaleEvent;
  seats: SeatRecord[];
  activeRedisLocks: RedisLockEntry[];
  selectedSeatNumber: number;
  onSelectSeat: (seatNumber: number) => void;
  onAcquireSeatHold: (seatNumber: number, buyerId: string) => Promise<{ ok: boolean; reason?: string }>;
  onReleaseSeatHold: (seatNumber: number, buyerId: string) => Promise<void>;
  onCheckoutSeat: (seatNumber: number, buyerId: string, buyerName: string) => Promise<void>;
}

export const SeatMatrixAndCheckout: React.FC<SeatMatrixAndCheckoutProps> = ({
  activeEvent,
  seats,
  activeRedisLocks,
  selectedSeatNumber,
  onSelectSeat,
  onAcquireSeatHold,
  onReleaseSeatHold,
  onCheckoutSeat,
}) => {
  const [sectionFilter, setSectionFilter] = useState<string>('ALL');
  const [buyerName, setBuyerName] = useState<string>('Alex Rivera');
  const [buyerEmail, setBuyerEmail] = useState<string>('alex.rivera@enterprise.io');
  const [sessionBuyerId] = useState<string>('usr_interactive_session');
  const [issuedTickets, setIssuedTickets] = useState<IssuedTicketReceipt[]>([]);
  const [activePassModal, setActivePassModal] = useState<IssuedTicketReceipt | null>(null);
  const [actionFeedback, setActionFeedback] = useState<{
    type: 'success' | 'error' | 'info';
    message: string;
  } | null>(null);
  const [nowTs, setNowTs] = useState<number>(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => {
      setNowTs(Date.now());
    }, 500);
    return () => clearInterval(timer);
  }, []);

  const selectedSeat =
    seats.find((s) => s.seatNumber === selectedSeatNumber) || seats[0];

  const filteredSeats = seats.filter((seat) => {
    if (sectionFilter === 'ALL') return true;
    if (sectionFilter === 'CORRUPTED') return seat.status === 'CORRUPTED_DOUBLE_SOLD';
    if (sectionFilter === 'AVAILABLE') return seat.status === 'AVAILABLE';
    return seat.section === sectionFilter;
  });

  const availableCount = seats.filter((s) => s.status === 'AVAILABLE').length;
  const lockedCount = seats.filter((s) => s.status === 'LOCKED').length;
  const soldCount = seats.filter((s) => s.status === 'SOLD').length;
  const corruptedCount = seats.filter((s) => s.status === 'CORRUPTED_DOUBLE_SOLD').length;

  const handleHoldClick = async () => {
    if (!selectedSeat) return;
    setActionFeedback(null);
    const res = await onAcquireSeatHold(selectedSeat.seatNumber, sessionBuyerId);
    if (res.ok) {
      setActionFeedback({
        type: 'success',
        message: `Acquired 30s Redis Mutex Hold on Seat ${selectedSeat.label} (SET NX PX 30000).`,
      });
    } else {
      setActionFeedback({
        type: 'error',
        message: res.reason || 'Could not acquire Redis lock.',
      });
    }
  };

  const handleReleaseClick = async () => {
    if (!selectedSeat) return;
    await onReleaseSeatHold(selectedSeat.seatNumber, sessionBuyerId);
    setActionFeedback({
      type: 'info',
      message: `Released Redis Mutex Hold on Seat ${selectedSeat.label} via atomic compare-and-delete.`,
    });
  };

  const handleCheckoutSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSeat) return;
    const trimmedName = buyerName.trim();
    if (!trimmedName) {
      setActionFeedback({
        type: 'error',
        message: 'Please enter a valid Buyer Name before committing checkout.',
      });
      return;
    }
    await onCheckoutSeat(selectedSeat.seatNumber, sessionBuyerId, trimmedName);

    const tokenNum = selectedSeat.fencingToken || 1001 + issuedTickets.length;
    const txId = `tx_acid_${selectedSeat.seatNumber}_${Date.now().toString(36).slice(-4)}`;
    const hash = `sha256:${activeEvent.id.slice(0, 6)}_${selectedSeat.label}_${tokenNum}_9f8a2b1c4e`;

    const newReceipt: IssuedTicketReceipt = {
      ticketId: `TKT-${Date.now().toString(36).toUpperCase().slice(-6)}`,
      eventTitle: activeEvent.title,
      venue: activeEvent.venue,
      seatLabel: selectedSeat.label,
      section: selectedSeat.section,
      buyerName: trimmedName,
      buyerEmail: buyerEmail.trim() || 'verified@enterprise.io',
      price: selectedSeat.price,
      fencingToken: tokenNum,
      txId,
      signatureHash: hash,
      issuedAt: new Date().toISOString(),
    };
    setIssuedTickets((prev) => [newReceipt, ...prev]);

    setActionFeedback({
      type: 'success',
      message: `Issued verifiable ticket pass ${newReceipt.ticketId} for Seat ${selectedSeat.label}.`,
    });
  };

  const lockTtlRemainingSec =
    selectedSeat?.lockExpiresAt && selectedSeat.lockExpiresAt > nowTs
      ? Math.ceil((selectedSeat.lockExpiresAt - nowTs) / 1000)
      : 0;

  return (
    <section
      id="seat-matrix"
      aria-labelledby="seat-matrix-heading"
      className="border border-black bg-white"
    >
      {/* Top Section Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-6 border-b border-black">
        <div>
          <div className="text-xs font-mono text-neutral-500">
            02. Venue Seat Allocation &amp; Distributed Lock Matrix
          </div>
          <h2 id="seat-matrix-heading" className="text-xl font-bold tracking-tight text-black">
            {activeEvent.title}
          </h2>
          <p className="text-xs text-neutral-600 mt-0.5">
            {activeEvent.venue} · ${activeEvent.unitPrice.toLocaleString()} per unit · {seats.length} Serialized Inventory Slots
          </p>
        </div>

        {/* Unboxed Monochrome Status Legend */}
        <div className="flex flex-wrap items-center gap-3 text-xs font-mono tabular-nums text-black">
          <span className="inline-flex items-center gap-1.5">
            <CircleDot className="w-3.5 h-3.5" /> {availableCount} Avail
          </span>
          <span aria-hidden="true" className="text-neutral-400">·</span>
          <span className="inline-flex items-center gap-1.5">
            <Lock className="w-3.5 h-3.5" /> {lockedCount} Held
          </span>
          <span aria-hidden="true" className="text-neutral-400">·</span>
          <span className="inline-flex items-center gap-1.5 font-semibold">
            <CheckCircle2 className="w-3.5 h-3.5" /> {soldCount} Sold
          </span>
          {corruptedCount > 0 && (
            <>
              <span aria-hidden="true" className="text-neutral-400">·</span>
              <span className="inline-flex items-center gap-1.5 bg-black text-white px-2 py-0.5 font-bold">
                <AlertOctagon className="w-3.5 h-3.5" /> {corruptedCount} Double-Sold!
              </span>
            </>
          )}
        </div>
      </div>

      {/* Main 12-Column Split: Left 8 Columns Matrix, Right 4 Columns Inspector & Checkout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-black">
        {/* Left 8 Columns: Interactive 50-Seat Grid */}
        <div className="lg:col-span-8 p-6 flex flex-col justify-between space-y-6">
          <div className="space-y-5">
            {/* Section Filter Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div
                role="tablist"
                aria-label="Filter seats by section or status"
                className="flex flex-wrap items-center border border-black bg-white"
              >
                {[
                  { id: 'ALL', label: `All Units (${seats.length})` },
                  { id: 'AVAILABLE', label: `Available (${availableCount})` },
                  { id: 'VIP Pit', label: 'VIP Pit' },
                  { id: 'Orchestra Center', label: 'Orchestra' },
                  { id: 'Club Box', label: 'Club Box' },
                  ...(corruptedCount > 0
                    ? [{ id: 'CORRUPTED', label: `! Double-Sold (${corruptedCount})` }]
                    : []),
                ].map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={sectionFilter === tab.id}
                    onClick={() => setSectionFilter(tab.id)}
                    className={`px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 border-r last:border-r-0 border-neutral-200 ${
                      sectionFilter === tab.id
                        ? 'bg-black text-white'
                        : 'bg-white text-neutral-700 hover:bg-neutral-100 hover:text-black'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              <span className="text-xs text-neutral-500 font-mono">
                STAGE / FRONT OF HOUSE ↑
              </span>
            </div>

            {/* 10-Column Architectural Seat Matrix Grid */}
            <div
              data-testid="seat-matrix-grid"
              className="grid grid-cols-5 sm:grid-cols-10 gap-2"
            >
              {filteredSeats.map((seat) => {
                const isSelected = selectedSeat?.seatNumber === seat.seatNumber;
                let cellStyle =
                  'bg-white border-neutral-300 text-black hover:border-black';
                let statusTag = 'OPEN';

                if (seat.status === 'LOCKED') {
                  cellStyle =
                    'bg-neutral-100 border-2 border-dashed border-black text-black font-semibold';
                  statusTag = 'HOLD';
                } else if (seat.status === 'SOLD') {
                  cellStyle =
                    'bg-black border-black text-white';
                  statusTag = 'SOLD';
                } else if (seat.status === 'CORRUPTED_DOUBLE_SOLD') {
                  cellStyle =
                    'pattern-diagonal-lines border-2 border-black text-black font-bold';
                  statusTag = `${seat.sellCount}x!`;
                }

                return (
                  <button
                    key={seat.id}
                    type="button"
                    onClick={() => onSelectSeat(seat.seatNumber)}
                    aria-label={`Seat ${seat.label} ${seat.status} (${seat.section})`}
                    className={`h-13 px-1.5 border font-mono text-xs flex flex-col items-center justify-center transition-all cursor-pointer ${cellStyle} ${
                      isSelected ? 'ring-2 ring-black ring-offset-2 ring-offset-white' : ''
                    }`}
                  >
                    <span
                      className={`font-bold tracking-tight leading-none px-1 ${
                        seat.status === 'CORRUPTED_DOUBLE_SOLD' ? 'bg-white text-black' : ''
                      }`}
                    >
                      {seat.label}
                    </span>
                    <span
                      className={`text-[9px] mt-1 leading-none tabular-nums px-1 ${
                        seat.status === 'CORRUPTED_DOUBLE_SOLD'
                          ? 'bg-black text-white font-bold'
                          : 'opacity-75'
                      }`}
                    >
                      {statusTag}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Active Redis Keys Strip & Issued Tickets Registry */}
          <div className="space-y-4 pt-4 border-t border-neutral-200">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-neutral-600">
              <div className="flex items-center gap-2 font-mono text-black font-semibold">
                <KeyRound className="w-3.5 h-3.5 shrink-0" />
                <span>
                  Active Redis Mutex Keys (SET NX PX): {activeRedisLocks.length}
                </span>
              </div>
              <div className="font-mono text-[11px] text-neutral-600 truncate">
                {activeRedisLocks.length > 0
                  ? activeRedisLocks
                      .slice(0, 2)
                      .map((l) => `${l.key} (fencing token #${l.fencingToken})`)
                      .join(' · ')
                  : '0 active manual holds — select any OPEN unit to test 30s Redis seat reservation'}
              </div>
            </div>

            {/* Issued Session Tickets Pass Strip */}
            {issuedTickets.length > 0 && (
              <div className="border border-black bg-neutral-50 p-4 space-y-2.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-black inline-flex items-center gap-1.5">
                    <Ticket className="w-3.5 h-3.5" />
                    Issued Cryptographic Ticket Passes ({issuedTickets.length})
                  </span>
                  <span className="font-mono text-[11px] text-neutral-500">
                    CLICK ANY PASS TO VIEW BARCODE RECEIPT
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {issuedTickets.slice(0, 4).map((tkt) => (
                    <div
                      key={tkt.ticketId}
                      className="border border-black bg-white p-3 flex items-center justify-between gap-3 text-xs"
                    >
                      <div className="space-y-0.5">
                        <div className="font-mono font-bold text-black">
                          {tkt.ticketId} · Seat {tkt.seatLabel} ({tkt.section})
                        </div>
                        <div className="text-[11px] text-neutral-600 truncate max-w-[190px]">
                          Holder: {tkt.buyerName}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <div className="text-right font-mono">
                          <div className="font-bold text-black">${tkt.price}</div>
                          <div className="text-[10px] text-neutral-500">#{tkt.fencingToken}</div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setActivePassModal(tkt)}
                          className="px-2.5 py-1.5 text-[11px] font-bold bg-black text-white hover:bg-neutral-800 cursor-pointer whitespace-nowrap"
                        >
                          Inspect Pass
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right 4 Columns: Seat Lock & Live Atomic Checkout Inspector */}
        <div className="lg:col-span-4 p-6 bg-neutral-50/60 flex flex-col justify-between space-y-5">
          {selectedSeat ? (
            <>
              <div className="space-y-4">
                <div className="flex items-center justify-between pb-4 border-b border-black">
                  <div>
                    <span className="text-[11px] font-mono uppercase text-neutral-500">
                      Selected Unit Telemetry
                    </span>
                    <h3 className="text-xl font-bold font-mono text-black mt-0.5">
                      Seat {selectedSeat.label} · {selectedSeat.section}
                    </h3>
                  </div>
                  <div className="text-right font-mono">
                    <div className="text-xl font-bold text-black tabular-nums">
                      ${selectedSeat.price.toLocaleString()}
                    </div>
                    <div className="text-[11px] text-neutral-500">Unit Price</div>
                  </div>
                </div>

                {/* Explicit State Table */}
                <div className="border border-black bg-white divide-y divide-neutral-200 text-xs">
                  <div className="flex items-center justify-between px-3.5 py-2.5">
                    <span className="text-neutral-600">Row Lock Status</span>
                    {selectedSeat.status === 'AVAILABLE' && (
                      <span className="inline-flex items-center gap-1.5 font-mono font-bold text-black">
                        <CircleDot className="w-3.5 h-3.5" /> AVAILABLE
                      </span>
                    )}
                    {selectedSeat.status === 'LOCKED' && (
                      <span className="inline-flex items-center gap-1.5 font-mono font-bold text-black bg-neutral-200 px-1.5 py-0.5">
                        <Lock className="w-3.5 h-3.5" /> REDIS HOLD ({lockTtlRemainingSec}s TTL)
                      </span>
                    )}
                    {selectedSeat.status === 'SOLD' && (
                      <span className="inline-flex items-center gap-1.5 font-mono font-bold text-white bg-black px-2 py-0.5">
                        <CheckCircle2 className="w-3.5 h-3.5" /> SOLD (COMMITTED)
                      </span>
                    )}
                    {selectedSeat.status === 'CORRUPTED_DOUBLE_SOLD' && (
                      <span className="inline-flex items-center gap-1.5 font-mono font-bold text-white bg-black px-2 py-0.5">
                        <AlertOctagon className="w-3.5 h-3.5" /> CORRUPTED ({selectedSeat.sellCount}x SOLD)
                      </span>
                    )}
                  </div>

                  <div className="flex items-center justify-between px-3.5 py-2.5">
                    <span className="text-neutral-600">Redis Mutex Key</span>
                    <code className="text-[11px] text-black font-mono font-semibold">
                      lock:event:{activeEvent.id}:seat:{selectedSeat.seatNumber}
                    </code>
                  </div>

                  <div className="flex items-center justify-between px-3.5 py-2.5">
                    <span className="text-neutral-600">Fencing Token</span>
                    <span className="font-mono tabular-nums font-semibold text-black">
                      {selectedSeat.fencingToken > 0 ? `#${selectedSeat.fencingToken}` : 'None (0)'}
                    </span>
                  </div>

                  <div className="flex items-center justify-between px-3.5 py-2.5">
                    <span className="text-neutral-600">Assigned Holder</span>
                    <span className="font-mono text-black font-medium truncate max-w-[180px]">
                      {selectedSeat.soldToBuyerName ||
                        selectedSeat.holderBuyerId ||
                        'Unassigned'}
                    </span>
                  </div>

                  {selectedSeat.transactionId && (
                    <div className="flex items-center justify-between px-3.5 py-2.5">
                      <span className="text-neutral-600">SQL Commit TX</span>
                      <span className="font-mono font-bold text-black">
                        {selectedSeat.transactionId}
                      </span>
                    </div>
                  )}

                  {selectedSeat.collisionBuyers.length > 1 && (
                    <div className="p-3.5 bg-neutral-100 space-y-1">
                      <div className="text-black font-bold font-mono text-[11px]">
                        ! RACE CONDITION COLLISION BUYERS ({selectedSeat.collisionBuyers.length}):
                      </div>
                      <div className="font-mono text-[11px] text-neutral-800 break-all leading-relaxed">
                        {selectedSeat.collisionBuyers.join(', ')}
                      </div>
                    </div>
                  )}
                </div>

                {/* Interactive Redis Hold + Atomic Checkout Form */}
                <form onSubmit={handleCheckoutSubmit} className="space-y-3 pt-1">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div>
                      <label
                        htmlFor="checkout-buyer-name"
                        className="block text-xs font-semibold text-black mb-1"
                      >
                        Ticket Holder Name
                      </label>
                      <input
                        id="checkout-buyer-name"
                        type="text"
                        value={buyerName}
                        onChange={(e) => setBuyerName(e.target.value)}
                        placeholder="Enter full name"
                        className="w-full px-3 py-2 text-xs bg-white border border-black text-black focus:outline-none focus:ring-1 focus:ring-black"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="checkout-buyer-email"
                        className="block text-xs font-semibold text-black mb-1"
                      >
                        Confirmation Email
                      </label>
                      <input
                        id="checkout-buyer-email"
                        type="email"
                        value={buyerEmail}
                        onChange={(e) => setBuyerEmail(e.target.value)}
                        placeholder="buyer@domain.com"
                        className="w-full px-3 py-2 text-xs bg-white border border-black text-black focus:outline-none focus:ring-1 focus:ring-black"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={handleHoldClick}
                      disabled={
                        selectedSeat.status === 'SOLD' ||
                        selectedSeat.status === 'CORRUPTED_DOUBLE_SOLD'
                      }
                      className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-black bg-white hover:bg-neutral-100 disabled:opacity-40 border border-black transition-colors cursor-pointer whitespace-nowrap shrink-0"
                    >
                      <Lock className="w-3.5 h-3.5" />
                      Acquire 30s Hold
                    </button>

                    <button
                      type="button"
                      onClick={handleReleaseClick}
                      disabled={selectedSeat.status !== 'LOCKED'}
                      className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-black bg-white hover:bg-neutral-100 disabled:opacity-40 border border-neutral-400 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                    >
                      <Unlock className="w-3.5 h-3.5" />
                      Release Lock
                    </button>
                  </div>

                  <button
                    type="submit"
                    disabled={
                      selectedSeat.status === 'SOLD' ||
                      selectedSeat.status === 'CORRUPTED_DOUBLE_SOLD'
                    }
                    className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-bold text-white bg-black hover:bg-neutral-800 disabled:opacity-40 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <ShoppingCart className="w-3.5 h-3.5" />
                    Complete Atomic Checkout (${selectedSeat.price})
                  </button>
                </form>

                {actionFeedback && (
                  <div
                    role="status"
                    className={`p-3 border text-xs font-mono ${
                      actionFeedback.type === 'error'
                        ? 'bg-black text-white border-black'
                        : 'bg-white text-black border-black'
                    }`}
                  >
                    {actionFeedback.message}
                  </div>
                )}
              </div>

              <div className="pt-3 border-t border-neutral-300 text-[11px] font-mono text-neutral-600">
                Atomic Lua Unlock: <code className="text-black font-semibold">if GET(k) == token then DEL(k)</code>
              </div>
            </>
          ) : null}
        </div>
      </div>

      {/* Verifiable Cryptographic Ticket Pass Modal */}
      {activePassModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="ticket-pass-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
        >
          <div className="w-full max-w-lg border-2 border-black bg-white p-6 space-y-5">
            <div className="flex items-center justify-between pb-3 border-b-2 border-black">
              <div>
                <div className="text-[10px] font-mono uppercase text-neutral-500">
                  AegisLock Cryptographic Admission Pass
                </div>
                <h3 id="ticket-pass-modal-title" className="text-lg font-bold text-black font-mono">
                  {activePassModal.ticketId} · SEAT {activePassModal.seatLabel}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setActivePassModal(null)}
                aria-label="Close pass modal"
                className="p-1 text-neutral-600 hover:text-black cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="border border-black divide-y divide-neutral-200 text-xs font-mono">
              <div className="p-3.5 bg-black text-white flex items-center justify-between">
                <span className="font-bold">{activePassModal.eventTitle}</span>
                <span className="font-bold">${activePassModal.price} PAID</span>
              </div>
              <div className="grid grid-cols-2 divide-x divide-neutral-200">
                <div className="p-3">
                  <div className="text-[10px] text-neutral-500">VENUE</div>
                  <div className="font-bold text-black mt-0.5">{activePassModal.venue}</div>
                </div>
                <div className="p-3">
                  <div className="text-[10px] text-neutral-500">SECTION &amp; UNIT</div>
                  <div className="font-bold text-black mt-0.5">
                    {activePassModal.section} · {activePassModal.seatLabel}
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 divide-x divide-neutral-200">
                <div className="p-3">
                  <div className="text-[10px] text-neutral-500">TICKET HOLDER</div>
                  <div className="font-bold text-black mt-0.5">{activePassModal.buyerName}</div>
                </div>
                <div className="p-3">
                  <div className="text-[10px] text-neutral-500">REDIS FENCING TOKEN</div>
                  <div className="font-bold text-black mt-0.5">#{activePassModal.fencingToken}</div>
                </div>
              </div>
              <div className="p-3 space-y-1 bg-neutral-50">
                <div className="text-[10px] text-neutral-500">CRYPTOGRAPHIC COMMIT HASH</div>
                <div className="text-[11px] text-black break-all font-semibold">
                  {activePassModal.signatureHash}
                </div>
              </div>
            </div>

            {/* Crisp Monochrome SVG Barcode Strip */}
            <div className="p-4 border border-black bg-white flex flex-col items-center space-y-2">
              <svg
                viewBox="0 0 320 48"
                className="w-full h-12 fill-black"
                aria-label="Cryptographic Ticket Barcode"
              >
                {Array.from({ length: 48 }).map((_, i) => {
                  const width = (i * 7 + 3) % 3 === 0 ? 4 : (i % 2 === 0 ? 2 : 1);
                  const x = i * 6.5 + 4;
                  return <rect key={i} x={x} y={2} width={width} height={44} />;
                })}
              </svg>
              <span className="text-[10px] font-mono tracking-widest text-black">
                *{activePassModal.ticketId}-{activePassModal.seatLabel}-{activePassModal.fencingToken}*
              </span>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-black bg-white border border-black hover:bg-neutral-100 cursor-pointer"
              >
                <Printer className="w-3.5 h-3.5" />
                Print Ticket Pass
              </button>
              <button
                type="button"
                onClick={() => setActivePassModal(null)}
                className="px-4 py-2 text-xs font-bold text-white bg-black hover:bg-neutral-800 cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
