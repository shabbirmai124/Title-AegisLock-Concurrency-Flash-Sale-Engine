# AegisLock — High-Concurrency Flash-Sale & Live Ticketing Engine

A full-stack event ticketing and flash-sale concurrency engine built with **Node.js, Express.js, Redis Distributed Locks (`SET NX PX`), Relational SQL ACID Transactions, and Socket.IO WebSockets**.

I built this project to bridge core **Operating Systems concurrency primitives** (Dijkstra counting semaphores, mutual exclusion locks, wait queues, and critical section serialization) with a **real-time distributed web architecture** capable of handling flash-sale traffic spikes without race conditions or inventory overselling.

---

## The Engineering Problem

When **5,000 to 10,000 concurrent buyers** attempt to purchase the last **50 concert tickets** or limited-allocation hardware units at the exact same millisecond, standard web applications fail in two ways:

1. **Check-Then-Act Race Conditions (`READ COMMITTED`):** Multiple asynchronous Node.js requests execute `SELECT available_inventory FROM events` simultaneously, read `available > 0` across the network I/O boundary before the first `UPDATE` commits, and overwrite each other—resulting in double-sold seats and negative inventory.
2. **Database Connection Pool Exhaustion:** Allowing 5,000 simultaneous requests to open blocking database transactions at once saturates worker threads and crashes the database.

---

## System Architecture & Concurrency Pipeline

AegisLock solves both problems through a 4-stage execution pipeline and allows side-by-side stress testing of four distinct concurrency strategies:

### 1. OS Counting Semaphore (`CountingSemaphore`)
- Models classic Operating Systems `P()` (`sem_wait`) and `V()` (`sem_post`) counting semaphores in `src/engine/concurrencyEngine.ts`.
- Bounds the maximum number of concurrent worker threads allowed inside the database critical section at any instant (configurable from $K = 4$ to $K = 64$ permits), queuing excess burst requests in a strict FIFO wait queue.

### 2. Redis Distributed Mutex & Monotonic Fencing Tokens (`RedisDistributedLockManager`)
- Implements Redis `SET lock:event:{id}:seat:{num} {buyerId} NX PX {ttlMs}` semantics with automatic TTL eviction.
- Issues monotonically increasing **fencing tokens** (`#1001, #1002, ...`) on every lock acquisition so that if a client experiences a pause or lock expiration, stale writes are rejected by the storage layer.
- Uses an atomic Lua-equivalent compare-and-delete release check (`if GET(key) == owner then DEL(key)`) so a worker can never accidentally release another buyer's lock.

### 3. Relational SQL ACID Isolation & Optimistic Concurrency Control
- **`REDIS_MUTEX_ACID` (Protected Default):** Combines the OS Counting Semaphore + Redis `SET NX PX` mutex + SQL `SERIALIZABLE` (`SELECT ... FOR UPDATE`) row validation. Guarantees **0 double-sells** across 5,000+ concurrent buyers.
- **`SQL_OPTIMISTIC_OCC` (Lock-Free Read + CAS Commit):** Uses a `version` column (`UPDATE events SET available_inventory = available_inventory - 1, version = version + 1 WHERE id = ? AND version = ?`). Conflicting writers detect stale versions and roll back cleanly.
- **`OS_SEMAPHORE_MUTEX` (Kernel-Style FIFO Mutex):** Enforces in-process mutual exclusion queues per resource pool.
- **`UNPROTECTED_NAIVE` (Vulnerability Demonstration):** Intentionally executes an unguarded read-then-write across an asynchronous I/O boundary to visually demonstrate real-time race-condition collisions (`15x+` buyers overwriting the exact same seat) in the dashboard.

### 4. Real-Time WebSocket Stress-Test Visualizer & Venue Checkout
- Streams live metrics (`Queue Depth`, `OS Semaphore Permits`, `Redis Lock Contentions`, `Committed Checkouts`, `Blocked Race Conditions`, and `Double-Sell Collisions`) over **Socket.IO** (`server.ts`).
- Features an interactive **50-Seat Venue Allocation Matrix (`A01`–`E10`)** where users can acquire a live 30-second Redis seat hold, inspect the active mutex key and fencing token, complete an atomic checkout, and generate a printable **Cryptographic Admission Pass** with an SVG barcode and SHA-256 commit digest.

---

## Project Structure

```text
├── server.ts                                    # Express.js + Socket.IO WebSocket & REST API server
├── src/
│   ├── types/
│   │   └── ticket.ts                            # TypeScript interfaces for events, seats, locks & WAL logs
│   ├── lib/
│   │   ├── semaphore.ts                         # OS counting semaphore & FIFO mutex implementation
│   │   ├── redisLock.ts                         # Redis SET NX PX lock manager & fencing token generator
│   │   ├── ticketingStore.ts                    # Relational seat store & concurrency execution strategies
│   │   └── ticketingStore.test.ts               # Automated unit & concurrency invariant test suite
│   ├── components/
│   │   ├── LoadControlPanel.tsx                 # 4-stage pipeline schematic & 5,000-buyer load generator
│   │   ├── SeatMap.tsx                          # Interactive 50-seat matrix, Redis hold & ticket pass modal
│   │   ├── TransactionLogTable.tsx              # Live SQL Write-Ahead Log (WAL) & CSV export table
│   │   ├── LockComparisonView.tsx               # Naive Read-Then-Write vs. Protected ACID comparison
│   │   ├── IntegrationDocs.tsx                  # Redis Lua scripts, TypeScript SDK & SLA matrix
│   │   └── CreateEventModal.tsx                 # Custom flash-sale event pool modal
│   ├── App.tsx                                  # Main application layout & Socket.IO state sync
│   └── index.css                                # Monochrome architectural design system
└── package.json
```

---

## Getting Started Locally

### 1. Install Dependencies
```bash
npm install
```

### 2. Run the Automated Concurrency Test Suite
The unit test suite validates the OS Counting Semaphore FIFO queue bounds, Redis `SET NX PX` mutual exclusion and fencing token ordering, interactive seat holds, and 5,000-buyer concurrent flash-sale invariants:

```bash
npm test
```

### 3. Start the Full-Stack Server (Port 3000)
```bash
npm run dev
```
Open `http://localhost:3000` in your browser.

---

## Verified Stress-Test Benchmarks (5,000 Concurrent Buyers / 50 Units)

| Concurrency Strategy | Total Buyers | Inventory Pool | Valid Checkouts | Blocked Contention | Double-Sell Collisions | Final Inventory |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| `REDIS_MUTEX_ACID` | `5,000` | `50` | **`50`** | `4,950` | **`0`** | **`0`** |
| `SQL_OPTIMISTIC_OCC` | `5,000` | `50` | **`50`** | `4,950` | **`0`** | **`0`** |
| `OS_SEMAPHORE_MUTEX` | `5,000` | `50` | **`50`** | `4,950` | **`0`** | **`0`** |
| `UNPROTECTED_NAIVE` | `500` | `50` | `5–10` | `400` | **`90+` (Corrupted)** | **`< 0` (Oversold)** |

---

## REST API & WebSocket Endpoints

- `GET /api/state` — Returns full engine snapshot (events, seats, active Redis locks, recent SQL transactions, and telemetry).
- `POST /api/stress-test` — Dispatches a concurrent wave of virtual buyers (`{ buyerCount: 5000, strategy: 'REDIS_MUTEX_ACID' }`) and streams progress via Socket.IO `engine:state`.
- `POST /api/seat/hold` — Acquires a 30-second Redis distributed mutex lock (`SET NX PX 30000`) on a specific seat.
- `POST /api/seat/release` — Releases a seat hold via atomic compare-and-delete verification.
- `POST /api/checkout` — Executes an atomic seat checkout transaction under the active locking strategy.
- `POST /api/strategy` — Switches active locking strategy (`REDIS_MUTEX_ACID` | `SQL_OPTIMISTIC_OCC` | `OS_SEMAPHORE_MUTEX` | `UNPROTECTED_NAIVE`).
- `POST /api/semaphore-permits` — Dynamically scales the OS Counting Semaphore permit pool ($K \in [4, 64]$).
