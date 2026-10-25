import React, { useState } from 'react';
import { FlashSaleEvent } from '../types/ticket';
import { X, PlusCircle } from 'lucide-react';

interface NewEventModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateEvent: (payload: {
    title: string;
    venue: string;
    unitPrice: number;
    totalInventory: number;
    category: FlashSaleEvent['category'];
  }) => Promise<{ ok: boolean; error?: string }>;
}

export const NewEventModal: React.FC<NewEventModalProps> = ({
  isOpen,
  onClose,
  onCreateEvent,
}) => {
  const [title, setTitle] = useState('');
  const [venue, setVenue] = useState('');
  const [unitPrice, setUnitPrice] = useState('299');
  const [totalInventory, setTotalInventory] = useState('50');
  const [category, setCategory] = useState<FlashSaleEvent['category']>('CONCERT_VIP');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!title.trim()) {
      setErrorMsg('Event title is required.');
      return;
    }
    if (!venue.trim()) {
      setErrorMsg('Venue or fulfillment region is required.');
      return;
    }
    const priceNum = Number(unitPrice);
    if (!Number.isFinite(priceNum) || priceNum <= 0) {
      setErrorMsg('Unit price must be a positive number.');
      return;
    }
    const invNum = Number(totalInventory);
    if (!Number.isFinite(invNum) || invNum < 10 || invNum > 100) {
      setErrorMsg('Inventory allocation must be between 10 and 100 units.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await onCreateEvent({
        title: title.trim(),
        venue: venue.trim(),
        unitPrice: priceNum,
        totalInventory: invNum,
        category,
      });
      if (res.ok) {
        setTitle('');
        setVenue('');
        onClose();
      } else {
        setErrorMsg(res.error || 'Failed to create flash-sale event.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-event-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
    >
      <div className="w-full max-w-md border-2 border-black bg-white p-6 space-y-5">
        <div className="flex items-center justify-between pb-3 border-b border-black">
          <h2 id="new-event-dialog-title" className="text-base font-bold text-black">
            Configure Custom Flash-Sale Event Pool
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="p-1 text-neutral-600 hover:text-black cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          <div>
            <label htmlFor="event-title-input" className="block font-bold text-black mb-1">
              Event or Flash-Sale Drop Title
            </label>
            <input
              id="event-title-input"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Wembley Finals — Pitchside Allocation"
              className="w-full px-3 py-2 bg-white border border-black text-black focus:outline-none focus:ring-1 focus:ring-black"
            />
          </div>

          <div>
            <label htmlFor="event-venue-input" className="block font-bold text-black mb-1">
              Venue / Fulfillment Datacenter
            </label>
            <input
              id="event-venue-input"
              type="text"
              value={venue}
              onChange={(e) => setVenue(e.target.value)}
              placeholder="e.g., London Stadium · EU-West Cluster"
              className="w-full px-3 py-2 bg-white border border-black text-black focus:outline-none focus:ring-1 focus:ring-black"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="event-price-input" className="block font-bold text-black mb-1">
                Unit Price (USD)
              </label>
              <input
                id="event-price-input"
                type="number"
                min={1}
                value={unitPrice}
                onChange={(e) => setUnitPrice(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-black text-black font-mono focus:outline-none focus:ring-1 focus:ring-black"
              />
            </div>

            <div>
              <label htmlFor="event-inventory-input" className="block font-bold text-black mb-1">
                Total Units (10–100)
              </label>
              <input
                id="event-inventory-input"
                type="number"
                min={10}
                max={100}
                value={totalInventory}
                onChange={(e) => setTotalInventory(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-black text-black font-mono focus:outline-none focus:ring-1 focus:ring-black"
              />
            </div>
          </div>

          <div>
            <label htmlFor="event-category-select" className="block font-bold text-black mb-1">
              Allocation Category
            </label>
            <select
              id="event-category-select"
              value={category}
              onChange={(e) => setCategory(e.target.value as FlashSaleEvent['category'])}
              className="w-full px-3 py-2 bg-white border border-black text-black focus:outline-none focus:ring-1 focus:ring-black"
            >
              <option value="CONCERT_VIP">Concert VIP Ticketing</option>
              <option value="HARDWARE_DROP">Hardware GPU / Silicon Drop</option>
              <option value="LIMITED_RELEASE">Limited Edition Collector Drop</option>
            </select>
          </div>

          {errorMsg && (
            <div role="alert" className="p-2.5 bg-black text-white font-mono">
              {errorMsg}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-black">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 text-xs font-semibold text-black bg-white border border-black hover:bg-neutral-100 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-black hover:bg-neutral-800 disabled:opacity-50 cursor-pointer"
            >
              <PlusCircle className="w-3.5 h-3.5" />
              Create &amp; Initialize Pool
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
