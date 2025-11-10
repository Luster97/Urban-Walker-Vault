## Urban Walker Vault — Quick AI Guide

Purpose: Give an AI agent immediate, actionable context for working on this repo (frontend static site + small Node/Express backend with SQLite).

Core architecture
- Frontend: static HTML/CSS/JS (entry: `index.html`, runtime logic in `script.js`). Cart state and offline-first sync use `localStorage` and are implemented client-side.
- Backend: `backend/index.js` — Node.js + Express exposing REST endpoints, persisting to SQLite. There is an in-memory fallback if the file DB is unavailable.

Key patterns & conventions
- Auth: JWT tokens returned by `POST /api/login`; protected endpoints expect `Authorization: Bearer <token>`.
- API layout: admin-only endpoints live under `/api/admin/*`; non-admin routes mirror these without the prefix.
- Response shape: endpoints return objects like `{ success: true }` or `{ error: 'message' }` (see `backend/index.js`).
- Offline cart: `script.js` stores unsynced items with `synced: false` and attempts to sync when backend is reachable.

Essential files to inspect/edit
- `script.js` — client logic for rendering inventory, cart behavior, and sync.
- `inventory.html`, `index.html`, `admin.html` — front-end pages that use `script.js`.
- `backend/index.js` — Express server, routes, DB schema and default admin creation.
- `backend/test_smoke.js` — quick smoke tests you can run locally.

Dev workflow (Windows PowerShell examples)
- Install & run backend:
```powershell
cd backend
npm install
npm start    # default port 3001 (see env var PORT)
```
- Run smoke tests:
```powershell
node backend/test_smoke.js
```
- If port 3001 is in use, set a different port in the same shell:
```powershell
$env:PORT = '3002'; npm start
```

Environment variables
- `PORT` — server listen port (default 3001)
- `DB_FILE` — path to SQLite DB (default `./uwv.db`)
- `JWT_SECRET` — JWT signing key (replace in prod)
- `RECAPTCHA_SECRET` — optional, used during registration if configured

Notable repo facts
- A default admin account is created on first backend startup (see `backend/index.js` and `test_smoke.js`).
- The repo ships an example DB backup (`backend/uwv.db.bak`) — useful for local testing.

When updating code
- Preserve response formats and route paths to avoid breaking the static frontend.
- If changing DB schema, update `backend/index.js` and consider seeding/migration for local dev.

If anything here is unclear or you'd like more detail (examples for endpoints, edit checklist, or tests), tell me which area to expand and I will iterate.

References: `backend/index.js`, `script.js`, `backend/test_smoke.js`, `inventory.html`, `index.html`
# Urban Walker Vault (UWV) Project Guide

This guide helps AI agents understand the essential patterns and workflows of the Urban Walker Vault sneaker e-commerce project.

## Architecture Overview

- **Frontend**: Static HTML/CSS/JS implementation
  - Entry point: `index.html` with main logic in `script.js`
  - Uses `localStorage` for offline cart functionality
  - Client-side authentication using JWT tokens

- **Backend**: Node.js/Express with SQLite (`backend/index.js`)
  - RESTful API design with JWT authentication
  - Automatic fallback to in-memory SQLite if disk DB is unavailable
  - Default admin account created on first run

## Key Integration Points

1. **Authentication Flow**:
   - Registration: POST `/api/register` (supports optional reCAPTCHA)
   - Login: POST `/api/login` returns JWT token
   - Protected routes use `Authorization: Bearer <token>` header

2. **Data Persistence**:
   - Frontend uses `localStorage` fallback when offline
   - Items marked with `synced: false` auto-sync when backend available
   - SQLite DB schema in `backend/index.js` (tables: users, sneakers, purchases, contact_info)

## Development Workflow

1. **Backend Setup**:
   ```powershell
   cd backend
   npm install
   npm start   # Runs on port 3001
   ```

2. **Environment Variables**:
   - `DB_FILE`: SQLite file path (default: `./uwv.db`)
   - `RECAPTCHA_SECRET`: Optional Google reCAPTCHA secret
   - `JWT_SECRET`: JWT signing key (use in production)

3. **Testing**:
   - Run smoke tests: `node backend/test_smoke.js`
   - Default admin: admin@uwv.com / admin123

## Project Conventions

1. **API Patterns**:
   - Admin routes under `/api/admin/*` require admin role
   - Non-admin routes mirror admin routes without the prefix
   - All responses follow `{ success: true/error: 'message' }` format

2. **Frontend Practices**:
   - Cart state maintained in `localStorage`
   - Admin UI shows additional controls when admin JWT present
   - Offline-first design with backend sync

## Common Tasks

- **Adding New Products**: POST to `/api/sneakers` or `/api/admin/sneakers` (admin)
- **User Purchase Flow**: Cart → Checkout → POST `/api/checkout`
- **Admin Dashboard**: View all purchases at `/api/purchase` (admin)