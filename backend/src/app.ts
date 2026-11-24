import express from 'express';
import cors from 'cors';
import compression from 'compression';
import routes from './routes';
import clientErrorsRouter from './routes/clientErrors';
import { JSON_BODY_LIMIT } from './middleware/validateIds';
import { noStoreByDefault } from './middleware/cacheControl';
import { createErrorHandler } from './middleware/errorHandler';
import { requestLog } from './middleware/requestLog';

const app = express();
app.disable('x-powered-by');

// Requests arrive through nginx on the Docker network, so the socket address
// is nginx's. Trusting only private-network hops makes req.ip the client
// address nginx forwards, which rate limits key on. A client cannot spoof it:
// nginx overwrites X-Forwarded-For rather than appending to it.
app.set('trust proxy', 'loopback, uniquelocal');

// First, so every response, a refused CORS request included, has an id and a log line.
app.use(requestLog);

// Middleware
app.use(cors({
  origin: process.env.NODE_ENV === 'development'
    ? true  // Allow all origins in development
    : process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
}));
app.use(compression({
  filter: (req, res) => {
    // Don't compress ZIP downloads (already compressed)
    if (req.path.endsWith('/download')) return false;
    return compression.filter(req, res);
  },
}));
// Ahead of the app-wide parser, so its own much smaller body limit applies.
app.use('/api/client-errors', clientErrorsRouter);

app.use(express.json({ limit: JSON_BODY_LIMIT }));

// Handlers that return public data mark their success responses cacheable;
// everything else, errors included, is never stored.
app.use('/api', noStoreByDefault);

// Routes
app.use('/api', routes);

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ success: false, error: 'Not found' });
});

app.use(createErrorHandler());

export default app;
