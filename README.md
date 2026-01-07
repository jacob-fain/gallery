# Gallery

A self-hosted photography portfolio with private sharing capabilities.

**Live site:** [jacobfain.gallery](https://jacobfain.gallery)

---

## Overview

Gallery is a personal photography portfolio website that allows photographers to showcase their work publicly and share private galleries with clients via password-protected links.

### Features

**Public Portfolio**
- Homepage with featured work
- Organized public galleries (Street, Portraits, Events, etc.)
- Full-resolution image viewing and download
- View counter per image/gallery
- "Buy me a coffee" support link

**Private Galleries**
- Password-protected galleries for clients
- Shareable links (e.g., `jacobfain.gallery/g/ninas-birthday`)
- Same viewing/download experience as public galleries
- View and download statistics

**Admin Dashboard**
- Secure login
- Drag & drop batch photo uploads
- Create, edit, delete galleries
- Set galleries as public or private (with password)
- Reorder photos, set cover images
- View statistics (views, downloads per gallery/image)
- Feature photos for homepage

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React + TypeScript |
| Backend | Node.js + TypeScript (Express or NestJS) |
| Database | PostgreSQL |
| Storage | AWS S3 |
| Hosting | Self-hosted (home server) + Cloudflare Tunnel |

---

## Architecture

```
                         ┌──────────────────────────────────────────────┐
                         │            Cloudflare                        │
                         │  ┌─────────────┐    ┌─────────────────────┐  │
Internet ───────────────▶│  │    DNS      │───▶│  Tunnel (free)      │  │
                         │  └─────────────┘    └──────────┬──────────┘  │
                         └────────────────────────────────┼─────────────┘
                                                          │
                                                          ▼
                         ┌──────────────────────────────────────────────┐
                         │            Home Server (Beelink)             │
                         │  ┌─────────────────┐    ┌─────────────────┐  │
                         │  │  React Frontend │    │  PostgreSQL     │  │
                         │  │  (Nginx/static) │    │  (Docker)       │  │
                         │  └─────────────────┘    └─────────────────┘  │
                         │  ┌─────────────────┐                         │
                         │  │  Node.js API    │                         │
                         │  │  (Docker)       │                         │
                         │  └────────┬────────┘                         │
                         └───────────┼──────────────────────────────────┘
                                     │
                                     ▼
                         ┌─────────────────────┐
                         │      AWS S3         │
                         │  (Photo Storage)    │
                         │                     │
                         │  - Originals        │
                         │  - Thumbnails       │
                         │  - Web-optimized    │
                         └─────────────────────┘
```

### Why This Architecture?

- **Self-hosted backend**: Free compute, full control, Docker experience
- **AWS S3 for images**: Industry standard, great resume value, images load fast from AWS regardless of home internet speed
- **Cloudflare Tunnel**: Free, secure, no port forwarding needed, your home IP stays hidden
- **PostgreSQL in Docker**: Production database experience, easy to backup

---

## Data Models

### User (Admin)
```
- id: UUID
- email: string
- password_hash: string
- created_at: timestamp
```

### Gallery
```
- id: UUID
- title: string
- slug: string (URL-friendly, e.g., "ninas-birthday")
- description: string (optional)
- cover_image_id: UUID (optional)
- is_public: boolean
- password_hash: string (nullable, for private galleries)
- view_count: integer
- created_at: timestamp
- updated_at: timestamp
```

### Photo
```
- id: UUID
- gallery_id: UUID (foreign key)
- filename: string
- original_filename: string
- s3_key: string
- s3_thumbnail_key: string
- width: integer
- height: integer
- file_size: integer
- sort_order: integer
- is_featured: boolean (for homepage)
- view_count: integer
- download_count: integer
- uploaded_at: timestamp
```

---

## API Endpoints

### Public
```
GET  /api/galleries                    # List public galleries
GET  /api/galleries/:slug              # Get gallery by slug (checks password if private)
POST /api/galleries/:slug/verify       # Verify password for private gallery
GET  /api/galleries/:slug/photos       # Get photos in gallery
GET  /api/photos/:id                   # Get single photo details
GET  /api/photos/:id/download          # Download full-res photo (increments counter)
GET  /api/featured                     # Get featured photos for homepage
```

### Admin (authenticated)
```
POST   /api/admin/login                # Admin login
POST   /api/admin/logout               # Admin logout

GET    /api/admin/galleries            # List all galleries (public + private)
POST   /api/admin/galleries            # Create gallery
PUT    /api/admin/galleries/:id        # Update gallery
DELETE /api/admin/galleries/:id        # Delete gallery

POST   /api/admin/galleries/:id/photos # Upload photos to gallery
PUT    /api/admin/photos/:id           # Update photo (reorder, feature, etc.)
DELETE /api/admin/photos/:id           # Delete photo

GET    /api/admin/stats                # Get overall statistics
```

---

## Pages

### Public
- `/` - Homepage with featured work and gallery links
- `/galleries` - List of public galleries
- `/g/:slug` - Gallery view (password prompt if private)
- `/about` - About page (optional)

### Admin
- `/admin/login` - Admin login
- `/admin` - Dashboard with stats overview
- `/admin/galleries` - Manage galleries
- `/admin/galleries/:id` - Edit gallery, manage photos
- `/admin/upload` - Batch upload interface

---

## Image Processing

On upload, the server will:
1. Accept the original full-resolution image
2. Generate a thumbnail (e.g., 400px wide) for gallery grid view
3. Generate a web-optimized version (e.g., 1600px wide) for viewing
4. Store all versions in S3
5. Save metadata to database

This improves page load performance while preserving full-res for downloads.

---

## Infrastructure

### AWS Services Used

| Service | Purpose | Resume Value |
|---------|---------|--------------|
| S3 | Photo storage (originals, thumbnails, web versions) | High - industry standard |
| IAM | Access policies for S3 | High - security basics |
| CloudFront | CDN for fast image delivery (optional) | High - common in job postings |

### Self-Hosted Services (Docker on Beelink)

| Service | Purpose |
|---------|---------|
| Node.js API | Backend server |
| PostgreSQL | Database |
| Nginx | Serve frontend static files |
| cloudflared | Cloudflare Tunnel client |

### Cloudflare (Free)

| Service | Purpose |
|---------|---------|
| Tunnel | Expose home server to internet securely |
| DNS | Point jacobfain.gallery to tunnel |
| SSL | Free HTTPS certificate |

### Estimated Costs

| Service | Cost |
|---------|------|
| AWS S3 (50GB storage) | ~$1.15/month |
| AWS S3 (egress ~10GB/month) | ~$0.90/month |
| CloudFront (optional, 10GB) | ~$0.85/month |
| Cloudflare Tunnel | Free |
| Cloudflare DNS | Free |
| Domain (jacobfain.gallery) | ~$20/year |

**Total: ~$2-5/month** + $20/year for domain

### Optional: Full AWS Deployment

If you want to move off self-hosted later (for uptime or learning), you can migrate to:

| Service | Purpose | Cost |
|---------|---------|------|
| EC2 t3.micro | Node.js API | ~$8/month |
| RDS db.t3.micro | PostgreSQL | ~$15/month |
| S3 | Photo storage | ~$2/month |
| CloudFront | CDN | ~$1/month |
| Route 53 | DNS | ~$0.50/month |

**Full AWS Total: ~$25-30/month**

---

## Development Roadmap

### Phase 1: Foundation
- [ ] Initialize React + TypeScript frontend
- [ ] Initialize Node.js + TypeScript backend
- [ ] Set up PostgreSQL database schema
- [ ] Set up AWS S3 bucket
- [ ] Basic API endpoints (galleries, photos)
- [ ] Image upload with thumbnail generation

### Phase 2: Public Site
- [ ] Homepage with featured photos
- [ ] Public gallery listing
- [ ] Gallery view with photo grid
- [ ] Full-res image viewing
- [ ] Download functionality
- [ ] View counting
- [ ] Responsive design

### Phase 3: Private Galleries
- [ ] Password protection for galleries
- [ ] Password entry page
- [ ] Shareable links

### Phase 4: Admin Dashboard
- [ ] Admin authentication
- [ ] Gallery management (CRUD)
- [ ] Drag & drop photo upload
- [ ] Photo reordering
- [ ] Set cover images
- [ ] Feature photos for homepage
- [ ] Statistics dashboard

### Phase 5: Polish & Deploy
- [ ] Design refinement
- [ ] Performance optimization
- [ ] Set up AWS infrastructure
- [ ] CI/CD pipeline
- [ ] Domain + SSL setup
- [ ] "Buy me a coffee" integration

### Phase 6: Future Enhancements (Optional)
- [ ] Lightbox image viewer
- [ ] Keyboard navigation
- [ ] Social sharing
- [ ] Download tracking analytics
- [ ] Multiple admin users
- [ ] Bulk download as ZIP

---

## Local Development

### Prerequisites
- Node.js 18+
- PostgreSQL 14+ (or Docker)
- AWS account with S3 bucket

### Setup

```bash
# Clone the repo
git clone https://github.com/yourusername/gallery.git
cd gallery

# Install dependencies
cd backend && npm install
cd ../frontend && npm install

# Set up environment variables
cp backend/.env.example backend/.env
# Edit .env with your database and AWS credentials

# Start PostgreSQL with Docker (optional)
docker run -d \
  --name gallery-db \
  -e POSTGRES_USER=gallery \
  -e POSTGRES_PASSWORD=password \
  -e POSTGRES_DB=gallery \
  -p 5432:5432 \
  postgres:15

# Run database migrations
cd backend && npm run migrate

# Start development servers
# Terminal 1:
cd backend && npm run dev

# Terminal 2:
cd frontend && npm run dev
```

Frontend runs at `http://localhost:3000`
Backend runs at `http://localhost:3001`

### Environment Variables

```bash
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/gallery

# AWS
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key
AWS_REGION=us-east-1
AWS_S3_BUCKET=your-bucket-name

# Auth
JWT_SECRET=your_jwt_secret
ADMIN_EMAIL=your@email.com
ADMIN_PASSWORD_HASH=hashed_password

# App
PORT=3001
FRONTEND_URL=http://localhost:3000
```

---

## Deployment

### Self-Hosted Setup (Beelink/Home Server)

#### Prerequisites
- Docker and Docker Compose installed
- Cloudflare account
- AWS account
- Domain registered and added to Cloudflare

#### 1. Clone and configure

```bash
git clone https://github.com/yourusername/gallery.git
cd gallery
cp .env.example .env
# Edit .env with your AWS credentials and secrets
```

#### 2. Start with Docker Compose

```bash
docker-compose up -d
```

This starts:
- Node.js API on port 3001
- PostgreSQL on port 5432
- Nginx serving frontend on port 80

#### 3. Set up Cloudflare Tunnel

```bash
# Install cloudflared
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o cloudflared
chmod +x cloudflared
sudo mv cloudflared /usr/local/bin/

# Authenticate with Cloudflare
cloudflared tunnel login

# Create tunnel
cloudflared tunnel create gallery

# Configure tunnel (creates ~/.cloudflared/config.yml)
cloudflared tunnel route dns gallery jacobfain.gallery
```

#### 4. Configure tunnel

Create `~/.cloudflared/config.yml`:

```yaml
tunnel: <your-tunnel-id>
credentials-file: /home/<user>/.cloudflared/<tunnel-id>.json

ingress:
  - hostname: jacobfain.gallery
    service: http://localhost:80
  - service: http_status:404
```

#### 5. Run tunnel as service

```bash
sudo cloudflared service install
sudo systemctl start cloudflared
sudo systemctl enable cloudflared
```

#### 6. Set up AWS S3

1. Create S3 bucket: `jacobfain-gallery-photos`
2. Create IAM user with S3 access
3. Configure CORS on bucket for your domain
4. Add credentials to `.env`

### Docker Compose

```yaml
version: '3.8'

services:
  api:
    build: ./backend
    ports:
      - "3001:3001"
    environment:
      - DATABASE_URL=postgresql://gallery:password@db:5432/gallery
    depends_on:
      - db
    restart: unless-stopped

  db:
    image: postgres:15
    volumes:
      - postgres_data:/var/lib/postgresql/data
    environment:
      - POSTGRES_USER=gallery
      - POSTGRES_PASSWORD=password
      - POSTGRES_DB=gallery
    restart: unless-stopped

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
    volumes:
      - ./frontend/dist:/usr/share/nginx/html
      - ./nginx.conf:/etc/nginx/nginx.conf
    depends_on:
      - api
    restart: unless-stopped

volumes:
  postgres_data:
```

---

## License

MIT
