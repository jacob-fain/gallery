# Gallery

A self-hosted photography portfolio with private gallery sharing, image optimization, and analytics.

**Live:** [jacobfain.gallery](https://jacobfain.gallery)

![Homepage](assets/homepage.png)

---

## Overview

Gallery is a full-stack photography portfolio platform designed for photographers who want complete control over their work. It combines a public-facing portfolio with password-protected client galleries, all backed by a comprehensive admin dashboard.

The system runs on self-hosted infrastructure with cloud storage, striking a balance between cost efficiency and performance. Photos are stored on AWS S3 with automatic optimization, while compute runs on a home server exposed securely through Cloudflare Tunnel.

![Gallery Grid](assets/gallery.png)

---

## Technology Stack

| Layer | Technologies |
|-------|--------------|
| Frontend | React 19, TypeScript, Vite, React Router 6 |
| UI Components | react-photo-album, yet-another-react-lightbox, @dnd-kit, Recharts |
| Backend | Node.js 20, Express 5, TypeScript |
| Image Processing | Sharp (WebP conversion, resizing), exif-reader |
| Database | PostgreSQL 15 |
| Storage | AWS S3 (signed URLs, three-tier image storage) |
| Auth | JWT, bcrypt |
| Infrastructure | Docker, Nginx, Cloudflare Tunnel |

---

## Features

### Public Site

- Full-viewport hero section with featured photo
- Responsive masonry photo grid with lazy loading
- Lightbox with pinch-to-zoom, swipe navigation, and swipe-to-dismiss
- EXIF metadata overlay (camera, lens, settings)
- Full-resolution download and gallery ZIP export
- Password-protected private galleries with session tokens

![Lightbox](assets/lightbox.png)

### Admin Dashboard

- Drag-and-drop batch photo upload with per-file progress
- Photo and gallery reordering via drag-and-drop
- Featured photo management (hero + grid selection)
- Hide individual photos from public view
- Analytics dashboard with view/download charts
- Site settings configuration

![Admin Dashboard](assets/dashboard.png)

![Gallery Editor](assets/gallery-edit.png)

### Image Pipeline

- Three-tier storage: original (preserved), web (1920px WebP), thumbnail (600px WebP)
- Automatic WebP conversion (30% smaller than JPEG)
- EXIF extraction stored as JSONB
- Signed S3 URLs with 1-hour expiration and in-memory caching

---

## Architecture

```
                    Internet
                        |
                        v
               Cloudflare Tunnel
              (SSL termination)
                        |
                        v
    +-------------------+-------------------+
    |           Home Server (Docker)        |
    |                                       |
    |   +--------+    +--------+    +----+  |
    |   | Nginx  |--->| Express|--->| PG |  |
    |   | (SPA)  |    |  API   |    |    |  |
    |   +--------+    +---+----+    +----+  |
    +---------------------|------------------+
                          |
                          v
                      AWS S3
                  (Photo Storage)
```

### Design Decisions

| Decision | Rationale |
|----------|-----------|
| Self-hosted compute | Full control, zero hosting cost, Docker experience |
| AWS S3 for images | Scalable storage, fast delivery, industry standard |
| Cloudflare Tunnel | Secure exposure without port forwarding, hides home IP |
| Three-tier images | Fast page loads without sacrificing download quality |
| Subdomain routing | Clean separation of public site and admin interface |

---

## Database Schema

```
users
├── id (UUID)
├── email
├── password_hash
└── created_at

galleries
├── id (UUID)
├── title, slug, description
├── cover_image_id → photos.id
├── is_public, password_hash
├── view_count, sort_order
└── created_at, updated_at

photos
├── id (UUID)
├── gallery_id → galleries.id
├── s3_key, s3_web_key, s3_thumbnail_key
├── width, height, file_size
├── sort_order, featured_order
├── is_hidden, exif_data (JSONB)
├── view_count, download_count
└── uploaded_at

analytics_events
├── id (UUID)
├── event_type (gallery_view, photo_view, photo_download)
├── gallery_id, photo_id
└── created_at

site_settings
├── key (PK)
├── value
└── updated_at
```

---

## API Endpoints

### Public
```
GET  /api/featured                  Featured photos for homepage
GET  /api/galleries                 List public galleries
GET  /api/galleries/:slug           Gallery details (password check if private)
POST /api/galleries/:slug/verify    Verify private gallery password
GET  /api/galleries/:slug/photos    Photos in gallery
GET  /api/galleries/:slug/download  Download gallery as ZIP
GET  /api/photos/:id                Single photo with signed URLs
```

### Admin (JWT Protected)
```
POST /api/auth/login                Authenticate
GET  /api/auth/me                   Current user

POST   /api/photos/upload           Upload photo to gallery
PUT    /api/photos/:id              Update photo metadata
DELETE /api/photos/:id              Delete photo
PUT    /api/photos/reorder          Batch reorder photos

GET    /api/galleries/admin/all     All galleries (public + private)
POST   /api/galleries               Create gallery
PUT    /api/galleries/:slug         Update gallery
DELETE /api/galleries/:slug         Delete gallery
PUT    /api/galleries/reorder       Reorder galleries

GET  /api/admin/stats               Dashboard statistics
GET  /api/admin/analytics           Charts data (30-day trends)
*    /api/admin/homepage/*          Featured photo management

GET  /api/settings                  Site settings
PUT  /api/settings/admin            Update settings
```

---

## Deployment

### Production Stack

The production environment runs via Docker Compose with:
- Multi-stage frontend build (Vite build, served by Nginx)
- Node.js backend with health checks
- PostgreSQL with volume persistence
- Automated database migrations

### Deploy Command

```bash
./deploy.sh
```

This script:
1. Pulls latest code from main branch
2. Runs new SQL migrations (tracked in `_migrations` table)
3. Rebuilds Docker containers
4. Restarts services with zero downtime

### Docker Compose Services

```yaml
frontend    # Nginx serving React SPA, proxies /api to backend
backend     # Express API (port 3001 internal)
db          # PostgreSQL 15 with persistent volume
```

---

## Local Development

### Prerequisites
- Node.js 20+
- Docker and Docker Compose
- AWS account with S3 bucket configured

### Setup

```bash
# Clone repository
git clone https://github.com/jacob-fain/gallery.git
cd gallery

# Start PostgreSQL
docker compose up -d db

# Backend (Terminal 1)
cd backend
cp .env.example .env    # Configure environment variables
npm install
npm run dev             # Runs on localhost:3001

# Frontend (Terminal 2)
cd frontend
npm install
npm run dev             # Runs on localhost:5173
```

### Environment Variables

```bash
# Database
DATABASE_URL=postgresql://gallery:password@localhost:5432/gallery

# AWS S3
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_REGION=us-east-1
AWS_S3_BUCKET=your-bucket-name

# Authentication
JWT_SECRET=                 # Minimum 32 characters

# Application
FRONTEND_URL=http://localhost:5173

# Email (optional)
SMTP_HOST=
SMTP_PORT=
SMTP_USER=
SMTP_PASS=
```

---

## Security

- Passwords hashed with bcrypt (10 rounds)
- JWT tokens with 7-day expiration
- Private gallery access tokens (24-hour expiration)
- S3 signed URLs (1-hour expiration)
- Rate limiting on tracking endpoints
- Non-root Docker containers
- Cloudflare Tunnel (no exposed ports)

---

## License

MIT
