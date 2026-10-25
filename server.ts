import express from 'express';
import { createServer as createHttpServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import { TicketingStore, LockingStrategy } from './src/lib/ticketingStore.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  app.use(express.json());

  const httpServer = createHttpServer(app);
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
  });

  const store = new TicketingStore(16);

  const broadcastState = () => {
    io.emit('engine:state', store.getFullState());
  };

  setInterval(() => {
    const evicted = store.redisLocks.evictExpired();
    if (evicted.length > 0) {
      store.syncExpiredSeatLocks();
      broadcastState();
    }
  }, 1000);

  app.get('/api/state', (_req, res) => {
    res.json(store.getFullState());
  });

  app.post('/api/strategy', (req, res) => {
    const { strategy } = req.body as { strategy: LockingStrategy };
    if (
      strategy === 'REDIS_MUTEX_ACID' ||
      strategy === 'SQL_OPTIMISTIC_OCC' ||
      strategy === 'OS_SEMAPHORE_MUTEX' ||
      strategy === 'UNPROTECTED_NAIVE'
    ) {
      store.setStrategy(strategy);
      broadcastState();
      res.json(store.getFullState());
    } else {
      res.status(400).json({ error: 'Invalid locking strategy' });
    }
  });

  app.post('/api/event/select', (req, res) => {
    try {
      const { eventId } = req.body as { eventId: string };
      store.setActiveEvent(eventId);
      broadcastState();
      res.json(store.getFullState());
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Failed to switch event' });
    }
  });

  app.post('/api/event/create', (req, res) => {
    try {
      const created = store.createCustomEvent(req.body);
      broadcastState();
      res.json({ created, state: store.getFullState() });
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Failed to create event' });
    }
  });

  app.post('/api/semaphore-permits', (req, res) => {
    const { maxPermits } = req.body as { maxPermits: number };
    store.semaphore.setMaxPermits(Number(maxPermits) || 16);
    broadcastState();
    res.json(store.getFullState());
  });

  app.post('/api/reset', (req, res) => {
    const { eventId } = (req.body || {}) as { eventId?: string };
    store.resetEventInventory(eventId);
    broadcastState();
    res.json(store.getFullState());
  });

  app.post('/api/seat/hold', (req, res) => {
    const { eventId, seatNumber, buyerId, ttlMs } = req.body;
    const result = store.acquireInteractiveSeatHold({
      eventId,
      seatNumber: Number(seatNumber),
      buyerId: String(buyerId || 'interactive_user'),
      ttlMs: Number(ttlMs) || 30000,
    });
    broadcastState();
    if (!result.ok) {
      res.status(409).json({ ...result, state: store.getFullState() });
      return;
    }
    res.json({ ...result, state: store.getFullState() });
  });

  app.post('/api/seat/release', (req, res) => {
    const { eventId, seatNumber, buyerId } = req.body;
    const result = store.releaseInteractiveSeatHold({
      eventId,
      seatNumber: Number(seatNumber),
      buyerId: String(buyerId || 'interactive_user'),
    });
    broadcastState();
    res.json({ ...result, state: store.getFullState() });
  });

  app.post('/api/checkout', async (req, res) => {
    try {
      const { eventId, seatNumber, buyerId, buyerName, strategy } = req.body;
      const txLog = await store.processCheckoutRequest({
        eventId,
        seatNumber: seatNumber !== undefined ? Number(seatNumber) : undefined,
        buyerId: String(buyerId || 'interactive_user'),
        buyerName: String(buyerName || 'Direct Buyer'),
        strategy,
      });
      broadcastState();
      res.json({ txLog, state: store.getFullState() });
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Checkout failed' });
    }
  });

  app.post('/api/stress-test', async (req, res) => {
    const { buyerCount = 5000, strategy, batchSize } = req.body || {};
    store
      .runConcurrentStressWave({
        buyerCount: Number(buyerCount) || 5000,
        strategy,
        batchSize: batchSize ? Number(batchSize) : undefined,
        onProgress: (state) => {
          io.emit('engine:state', state);
        },
      })
      .catch((err) => {
        console.error('Stress wave error:', err);
      });

    res.json({ started: true, state: store.getFullState() });
  });

  io.on('connection', (socket) => {
    socket.emit('engine:state', store.getFullState());

    socket.on(
      'stress:start',
      async (payload: { buyerCount?: number; strategy?: LockingStrategy; batchSize?: number }) => {
        await store.runConcurrentStressWave({
          buyerCount: Number(payload?.buyerCount) || 5000,
          strategy: payload?.strategy,
          batchSize: payload?.batchSize,
          onProgress: (state) => {
            io.emit('engine:state', state);
          },
        });
      }
    );

    socket.on('engine:reset', (payload?: { eventId?: string }) => {
      store.resetEventInventory(payload?.eventId);
      broadcastState();
    });

    socket.on('engine:set-strategy', (payload: { strategy: LockingStrategy }) => {
      if (payload?.strategy) {
        store.setStrategy(payload.strategy);
        broadcastState();
      }
    });

    socket.on('engine:set-event', (payload: { eventId: string }) => {
      try {
        if (payload?.eventId) {
          store.setActiveEvent(payload.eventId);
          broadcastState();
        }
      } catch {
        // Ignore invalid event ID
      }
    });

    socket.on('engine:set-permits', (payload: { maxPermits: number }) => {
      if (payload?.maxPermits) {
        store.semaphore.setMaxPermits(Number(payload.maxPermits));
        broadcastState();
      }
    });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const PORT = 3000;
  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
