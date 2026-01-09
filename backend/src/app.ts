import express from 'express';
import cors from 'cors';
import compression from 'compression';
import routes from './routes';

const app = express();

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
app.use(express.json());

// Cache headers for public GET endpoints
app.use('/api', (req, res, next) => {
  if (req.method === 'GET') {
    const publicPaths = ['/galleries', '/featured', '/settings'];
    const isPublic = publicPaths.some(p => req.path.startsWith(p));

    if (isPublic && !req.path.includes('/admin')) {
      res.set('Cache-Control', 'public, max-age=300'); // 5 min
    } else {
      res.set('Cache-Control', 'private, no-cache');
    }
  }
  next();
});

// Routes
app.use('/api', routes);

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ success: false, error: 'Not found' });
});

// Global error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    success: false,
    error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
  });
});

export default app;
