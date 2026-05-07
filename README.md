### [View Site ( jacobfain.gallery )](https://jacobfain.gallery)


A self-hosted photography portfolio with private gallery sharing, image optimization, and analytics.


![Homepage](assets/homepage.png)


## Overview

Gallery is a full-stack photography portfolio platform designed for photographers who want complete control over their work. It combines a public-facing portfolio with password-protected client galleries, all backed by a comprehensive admin dashboard.

The system runs on self-hosted infrastructure with cloud storage, striking a balance between cost efficiency and performance. Photos are stored on AWS S3 with automatic optimization, while compute runs on a home server exposed securely through Cloudflare Tunnel.

## Technology Stack

| Layer | Technologies |
|-------|--------------|
| Frontend | React 19, TypeScript, Vite, React Router 6 |
| Backend | Node.js 20, Express 5, TypeScript |
| Database | PostgreSQL 15 |
| Storage | AWS S3 (signed URLs, three-tier image storage) |
| Auth | JWT, bcrypt |
| Infrastructure | Docker, Nginx, Cloudflare Tunnel |

## License

MIT
