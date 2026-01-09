# Deployment Guide: jacobfain.gallery

Self-hosted photo gallery on Beelink mini PC with Cloudflare Tunnel.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         INTERNET                                │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    CLOUDFLARE EDGE                              │
│  • Free SSL/TLS termination                                     │
│  • DDoS protection                                              │
│  • Hides home IP address                                        │
└─────────────────────────────────────────────────────────────────┘
                              │
                    (encrypted tunnel, outbound only)
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    BEELINK (Home Server)                        │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                    cloudflared                            │  │
│  │  • Maintains tunnel to Cloudflare                         │  │
│  │  • Routes: jacobfain.gallery → localhost:3001             │  │
│  └───────────────────────────────────────────────────────────┘  │
│                              │                                  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                 Docker Compose Stack                      │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐       │  │
│  │  │  frontend   │  │   backend   │  │  postgres   │       │  │
│  │  │  (nginx)    │  │  (node.js)  │  │    (db)     │       │  │
│  │  │   :80       │  │   :3001     │  │   :5432     │       │  │
│  │  └─────────────┘  └─────────────┘  └─────────────┘       │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                        AWS S3                                   │
│  • Photo storage (jacobfain-gallery-photos)                     │
│  • Signed URLs for secure access                                │
└─────────────────────────────────────────────────────────────────┘
```

## Current State

- [x] Frontend: Vite + React (dev mode)
- [x] Backend: Express + TypeScript (dev mode)
- [x] Database: PostgreSQL in Docker
- [x] Photos: AWS S3 bucket
- [ ] Dockerized frontend
- [ ] Dockerized backend
- [ ] Production docker-compose
- [ ] Domain purchased
- [ ] Cloudflare Tunnel
- [ ] Production environment

---

## Phase 1: Dockerize the Application

### 1.1 Create Backend Dockerfile

Create `backend/Dockerfile`:

```dockerfile
FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy source and build
COPY tsconfig.json ./
COPY src ./src
RUN npm install typescript && npx tsc && rm -rf node_modules && npm ci --only=production

# Run
EXPOSE 3001
CMD ["node", "dist/index.js"]
```

### 1.2 Create Frontend Dockerfile

Create `frontend/Dockerfile`:

```dockerfile
# Build stage
FROM node:20-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Production stage - serve with nginx
FROM nginx:alpine

# Copy built files
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

### 1.3 Create Frontend nginx.conf

Create `frontend/nginx.conf`:

```nginx
server {
    listen 80;
    server_name localhost;
    root /usr/share/nginx/html;
    index index.html;

    # SPA routing - serve index.html for all routes
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Proxy API requests to backend
    location /api/ {
        proxy_pass http://backend:3001/api/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Cache static assets
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # Gzip
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml;
}
```

### 1.4 Create Production docker-compose.yml

Create `docker-compose.prod.yml` in project root:

```yaml
version: '3.8'

services:
  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile
    ports:
      - "80:80"
    depends_on:
      - backend
    restart: unless-stopped
    networks:
      - gallery-network

  backend:
    build:
      context: ./backend
      dockerfile: Dockerfile
    ports:
      - "3001:3001"
    environment:
      - NODE_ENV=production
      - DATABASE_URL=postgresql://gallery:${DB_PASSWORD}@db:5432/gallery
      - AWS_ACCESS_KEY_ID=${AWS_ACCESS_KEY_ID}
      - AWS_SECRET_ACCESS_KEY=${AWS_SECRET_ACCESS_KEY}
      - AWS_REGION=${AWS_REGION}
      - AWS_S3_BUCKET=${AWS_S3_BUCKET}
      - JWT_SECRET=${JWT_SECRET}
      - FRONTEND_URL=${FRONTEND_URL}
      - SMTP_HOST=${SMTP_HOST}
      - SMTP_PORT=${SMTP_PORT}
      - SMTP_USER=${SMTP_USER}
      - SMTP_PASS=${SMTP_PASS}
    depends_on:
      db:
        condition: service_healthy
    restart: unless-stopped
    networks:
      - gallery-network

  db:
    image: postgres:15-alpine
    environment:
      - POSTGRES_USER=gallery
      - POSTGRES_PASSWORD=${DB_PASSWORD}
      - POSTGRES_DB=gallery
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./db/init:/docker-entrypoint-initdb.d:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U gallery"]
      interval: 5s
      timeout: 5s
      retries: 5
    restart: unless-stopped
    networks:
      - gallery-network

  cloudflared:
    image: cloudflare/cloudflared:latest
    command: tunnel --no-autoupdate run
    environment:
      - TUNNEL_TOKEN=${CLOUDFLARE_TUNNEL_TOKEN}
    restart: unless-stopped
    networks:
      - gallery-network
    depends_on:
      - frontend
      - backend

volumes:
  postgres_data:

networks:
  gallery-network:
    driver: bridge
```

### 1.5 Create Production .env Template

Create `.env.production.example`:

```bash
# Database
DB_PASSWORD=your_secure_password_here

# AWS S3
AWS_ACCESS_KEY_ID=your_aws_key
AWS_SECRET_ACCESS_KEY=your_aws_secret
AWS_REGION=us-east-1
AWS_S3_BUCKET=jacobfain-gallery-photos

# Auth
JWT_SECRET=generate_a_long_random_string_here

# App
FRONTEND_URL=https://jacobfain.gallery
NODE_ENV=production

# SMTP (Gmail)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your_email@gmail.com
SMTP_PASS=your_app_password

# Cloudflare (added in Phase 3)
CLOUDFLARE_TUNNEL_TOKEN=your_tunnel_token
```

### 1.6 Test Locally

```bash
# Create production env file
cp .env.production.example .env.production

# Edit with your values
nano .env.production

# Build and run
docker-compose -f docker-compose.prod.yml --env-file .env.production up --build

# Test at http://localhost
```

**Checkpoint:** App runs fully in Docker containers locally.

---

## Phase 2: Domain & Cloudflare Setup

### 2.1 Buy Domain

1. Go to [Namecheap](https://namecheap.com), [Porkbun](https://porkbun.com), or [Cloudflare Registrar](https://dash.cloudflare.com)
2. Search for `jacobfain.gallery`
3. Purchase (~$20-30/year for .gallery TLD)

### 2.2 Add Domain to Cloudflare

1. Create free account at [dash.cloudflare.com](https://dash.cloudflare.com)
2. Click "Add a Site"
3. Enter `jacobfain.gallery`
4. Select **Free** plan
5. Cloudflare will scan existing DNS records

### 2.3 Update Nameservers

1. Cloudflare will give you 2 nameservers (e.g., `ada.ns.cloudflare.com`)
2. Go to your domain registrar
3. Update nameservers to Cloudflare's
4. Wait for propagation (5 min - 24 hours)

### 2.4 Configure SSL Settings

In Cloudflare Dashboard → SSL/TLS:

1. Set encryption mode to **Full (strict)**
2. Enable "Always Use HTTPS"
3. Enable "Automatic HTTPS Rewrites"

**Checkpoint:** Domain is on Cloudflare with SSL ready.

---

## Phase 3: Cloudflare Tunnel Setup

### 3.1 Create Tunnel in Dashboard

1. Cloudflare Dashboard → Zero Trust → Networks → Tunnels
2. Click "Create a tunnel"
3. Select "Cloudflared" connector
4. Name it `gallery`
5. Copy the tunnel token (starts with `eyJ...`)

### 3.2 Configure Public Hostnames

In the tunnel configuration, add these public hostnames:

| Subdomain | Domain | Service |
|-----------|--------|---------|
| (empty) | jacobfain.gallery | http://frontend:80 |
| api | jacobfain.gallery | http://backend:3001 |
| admin | jacobfain.gallery | http://frontend:80 |

### 3.3 Update Environment

Add tunnel token to `.env.production`:

```bash
CLOUDFLARE_TUNNEL_TOKEN=eyJ...your_token_here
```

### 3.4 Update Frontend for Production API

Update `frontend/src/api/client.ts` to handle production:

```typescript
const API_BASE = import.meta.env.VITE_API_URL ||
  (window.location.hostname.includes('jacobfain.gallery')
    ? 'https://api.jacobfain.gallery/api'
    : `http://${window.location.hostname}:3001/api`);
```

Or set in frontend build:

```bash
# In docker-compose, add build arg:
frontend:
  build:
    context: ./frontend
    args:
      - VITE_API_URL=https://api.jacobfain.gallery/api
```

**Checkpoint:** Tunnel is configured and ready.

---

## Phase 4: Deploy to Beelink

### 4.1 Prepare Beelink

```bash
# SSH into Beelink
ssh user@beelink

# Install Docker if not present
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER

# Install Docker Compose
sudo apt install docker-compose-plugin

# Create app directory
mkdir -p ~/gallery
cd ~/gallery
```

### 4.2 Clone and Configure

```bash
# Clone repository
git clone https://github.com/yourusername/gallery.git .

# Create production env file
cp .env.production.example .env.production
nano .env.production  # Add your secrets
```

### 4.3 Deploy

```bash
# Build and start
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build

# Check logs
docker compose -f docker-compose.prod.yml logs -f

# Verify all containers running
docker compose -f docker-compose.prod.yml ps
```

### 4.4 Initialize Database

```bash
# Run migrations (if any new ones)
docker compose -f docker-compose.prod.yml exec db psql -U gallery -d gallery -f /docker-entrypoint-initdb.d/006_performance_indexes.sql
```

**Checkpoint:** App is running on Beelink, accessible via Cloudflare Tunnel.

---

## Phase 5: Backups & Maintenance

### 5.1 Database Backup Script

Create `scripts/backup-db.sh`:

```bash
#!/bin/bash
set -e

BACKUP_DIR="/home/$USER/backups/gallery"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/gallery_$TIMESTAMP.sql.gz"

# Create backup directory
mkdir -p $BACKUP_DIR

# Dump and compress
docker compose -f /home/$USER/gallery/docker-compose.prod.yml exec -T db \
  pg_dump -U gallery gallery | gzip > $BACKUP_FILE

# Upload to S3 (optional)
# aws s3 cp $BACKUP_FILE s3://jacobfain-gallery-photos/backups/

# Keep only last 7 days
find $BACKUP_DIR -name "*.sql.gz" -mtime +7 -delete

echo "Backup completed: $BACKUP_FILE"
```

### 5.2 Setup Cron Job

```bash
# Make executable
chmod +x ~/gallery/scripts/backup-db.sh

# Add to crontab (daily at 3 AM)
crontab -e
# Add line:
0 3 * * * /home/$USER/gallery/scripts/backup-db.sh >> /home/$USER/backups/backup.log 2>&1
```

### 5.3 Auto-Start on Boot

Docker Compose with `restart: unless-stopped` handles this, but verify:

```bash
# Enable Docker to start on boot
sudo systemctl enable docker

# Test by rebooting
sudo reboot
```

### 5.4 Update Procedure

```bash
cd ~/gallery

# Pull latest code
git pull origin main

# Rebuild and restart
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build

# Verify
docker compose -f docker-compose.prod.yml ps
```

**Checkpoint:** Automated backups and easy updates configured.

---

## Phase 6: Go Live Checklist

### Pre-Launch

- [ ] All containers running: `docker compose ps`
- [ ] Frontend loads: https://jacobfain.gallery
- [ ] Admin works: https://admin.jacobfain.gallery
- [ ] API responds: https://api.jacobfain.gallery/api/health
- [ ] Photos load from S3
- [ ] Contact form sends email
- [ ] Login works (you'll need to re-login due to new JWT_SECRET)
- [ ] Upload photos works
- [ ] Download ZIP works

### Security Check

- [ ] No ports open on router (verify with https://canyouseeme.org)
- [ ] SSL certificate valid (check browser padlock)
- [ ] Home IP hidden (check https://whatismyipaddress.com while on site)
- [ ] Rate limiting works

### Post-Launch

- [ ] Test from mobile device
- [ ] Test from different network (not home)
- [ ] Share with a friend to test
- [ ] Set up uptime monitoring (optional): [UptimeRobot](https://uptimerobot.com) (free)

---

## Troubleshooting

### Tunnel not connecting

```bash
# Check cloudflared logs
docker compose -f docker-compose.prod.yml logs cloudflared

# Verify token is correct
echo $CLOUDFLARE_TUNNEL_TOKEN
```

### Database connection issues

```bash
# Check db is healthy
docker compose -f docker-compose.prod.yml ps db

# Check logs
docker compose -f docker-compose.prod.yml logs db

# Connect manually
docker compose -f docker-compose.prod.yml exec db psql -U gallery -d gallery
```

### Frontend can't reach API

```bash
# Check backend is running
curl http://localhost:3001/api/health

# Check nginx config
docker compose -f docker-compose.prod.yml exec frontend cat /etc/nginx/conf.d/default.conf
```

### View all logs

```bash
docker compose -f docker-compose.prod.yml logs -f --tail=100
```

---

## Cost Summary

| Item | Cost |
|------|------|
| Domain (jacobfain.gallery) | ~$25/year |
| Cloudflare (tunnel, SSL, DNS) | **Free** |
| AWS S3 | ~$1-5/month |
| Beelink electricity | ~$3-5/month |
| **Total** | **~$5-10/month** |

---

## Quick Reference Commands

```bash
# Start
docker compose -f docker-compose.prod.yml --env-file .env.production up -d

# Stop
docker compose -f docker-compose.prod.yml down

# Rebuild
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build

# Logs
docker compose -f docker-compose.prod.yml logs -f

# Shell into container
docker compose -f docker-compose.prod.yml exec backend sh
docker compose -f docker-compose.prod.yml exec db psql -U gallery

# Backup now
./scripts/backup-db.sh
```
