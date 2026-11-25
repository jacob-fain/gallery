import express from 'express';
import cors from 'cors';
import compression from 'compression';
import routes from './routes';
import clientErrorsRouter from './routes/clientErrors';
import { JSON_BODY_LIMIT } from './middleware/validateIds';
import { noStoreByDefault } from './middleware/cacheControl';
import { createErrorHandler } from './middleware/errorHandler';
import { requestLog } from './middleware/requestLog';
import { isAllowedOrigin } from './middleware/session';

const app = express();
app.disable('x-powered-by');

// Requests arrive through nginx on the Docker network, so the socket address
// is nginx's. Trusting only private-network hops makes req.ip the client
// address nginx forwards, which rate limits key on. A client cannot spoof it:
// nginx overwrites X-Forwarded-For rather than appending to it.
app.set('trust proxy', 'loopback, uniquelocal');

// First, so every response, a refused CORS request included, has an id and a log line.
app.use(requestLog);

// Both sites call /api on their own host, so production needs no CORS for
// them to work. Credentials go only to the admin origin: the public site is
// the same site as the admin one, so its requests would carry the admin
// cookie, and it must never read an answer made with it. Any other origin gets
// no CORS headers at all. Development serves the API on its own port, so its
// pages are cross-origin: the local dev hosts may send credentials, as the
// admin UI runs there too, and any other origin (a phone on the LAN) gets
// public reads only.
app.use(cors((req, callback) => {
  const origin = req.headers.origin;
  if (origin && isAllowedOrigin(origin)) return callback(null, { origin: true, credentials: true });
  if (process.env.NODE_ENV === 'development') return callback(null, { origin: true, credentials: false });
  callback(null, { origin: false });
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
// Express 5 leaves req.body undefined when a request has no body, and the
// handlers destructure it; an empty object lets their own validation answer.
app.use((req, _res, next) => {
  if (req.body === undefined) req.body = {};
  next();
});

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
