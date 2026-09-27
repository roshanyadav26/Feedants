# Feedants Admin Dashboard

Separate React, Vite, and TypeScript web app for managing Feedants competition registrations and submitted video entries.

## Requirements

- Node.js 20.19+ or 22.12+ (required by the scaffolded Vite version)
- Feedants backend running with its admin API configured

## Run locally

1. From this directory, install dependencies:

   ~~~sh
   npm install
   ~~~

2. Copy `.env.example` to `.env.local` and set the backend API base URL:

   ~~~dotenv
   VITE_API_BASE_URL=http://localhost:5000/api
   ~~~

   Include `/api` in the value. For a phone or another computer, use a backend host address reachable from that browser instead of `localhost`.

3. Start the development server:

   ~~~sh
   npm run dev
   ~~~

4. Open the local URL printed by Vite and sign in with the admin email and password configured on the backend.

The token is stored in browser `sessionStorage` and sent as `Authorization: Bearer <token>` for protected requests. Sign out clears it, and closing the browser tab/session also clears it. The backend token expires after one hour, after which the dashboard asks you to sign in again.

## Available scripts

- `npm run dev` — start the Vite development server
- `npm run build` — type-check and build the production assets
- `npm run preview` — serve the production build locally
- `npm run lint` — lint source files with Oxlint

## Backend API used

- `POST /api/admin/login` — authenticate with `{ "email": "...", "password": "..." }`
- `GET /api/admin/registrations?page=1&limit=20` — paginated registrations
- `GET /api/admin/entries?page=1&limit=20` — paginated video entries
- `PATCH /api/admin/entries/:id/status` — update `submissionStatus`

Review statuses are limited to `submitted`, `under_review`, `accepted`, and `rejected`. The dashboard displays video metadata but does not stream or download uploaded files.

`VITE_API_BASE_URL` is public frontend configuration, not a secret. Never put admin passwords, password hashes, or JWT signing secrets in Vite environment variables; configure those only in the backend environment.

