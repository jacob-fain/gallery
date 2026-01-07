# Backend Setup Plan

Express + TypeScript API for the Gallery project.

## Structure

```
backend/
├── src/
│   ├── index.ts              # Entry point, starts server
│   ├── app.ts                # Express app config, middleware
│   ├── config/
│   │   └── db.ts             # Database connection pool
│   ├── routes/
│   │   ├── index.ts          # Route aggregator
│   │   ├── galleries.ts      # Public gallery routes
│   │   ├── photos.ts         # Public photo routes
│   │   └── admin.ts          # Admin routes (later)
│   ├── controllers/
│   │   ├── galleryController.ts
│   │   └── photoController.ts
│   ├── services/
│   │   ├── galleryService.ts # Business logic
│   │   └── photoService.ts
│   └── types/
│       └── index.ts          # TypeScript interfaces
├── package.json
├── tsconfig.json
└── .env
```

## Dependencies

**Production:**
- express
- pg (PostgreSQL client)
- dotenv
- cors

**Development:**
- typescript
- ts-node-dev (hot reload)
- @types/express
- @types/node
- @types/pg
- @types/cors

## Tasks

### 1. Initialize Project
- Create backend directory
- npm init
- Install dependencies
- Configure TypeScript (tsconfig.json)
- Add scripts to package.json

### 2. Basic Express Setup
- Create src/app.ts with middleware (cors, json parsing)
- Create src/index.ts entry point
- Add health check route: GET /api/health

### 3. Database Connection
- Create src/config/db.ts with pg Pool
- Load DATABASE_URL from .env
- Test connection on startup

### 4. Types
- Define Gallery, Photo, User interfaces matching DB schema

### 5. First Routes (Public)
- GET /api/galleries - List public galleries
- GET /api/galleries/:slug - Get single gallery
- GET /api/galleries/:slug/photos - Get photos in gallery

### 6. Test
- Start server
- Hit endpoints
- Verify DB queries work

## Not in This PR
- Admin routes (auth required)
- S3 integration
- Image upload
- Password verification for private galleries
