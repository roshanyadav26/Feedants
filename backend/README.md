# Feedants backend

## Admin API configuration

Set these variables in the backend process environment. Keep their values private and do not commit them:

- `ADMIN_EMAIL`: admin login email.
- `ADMIN_PASSWORD_HASH`: bcrypt hash for the admin password.
- `ADMIN_JWT_SECRET`: a randomly generated secret of at least 32 characters, used only to sign admin tokens.

Generate a bcrypt password hash locally with the installed `bcryptjs` package, for example:

```sh
node -e "require('bcryptjs').hash(process.stdin.read().trim(), 12).then(console.log)"
```

Supply the password through standard input rather than adding it to shell history. Generate a JWT secret with a cryptographically secure random generator and configure it as an environment variable. The API does not print these values. Admin JWTs expire after one hour.

## Admin endpoints

- `POST /api/admin/login` — JSON body: `{ "email": "...", "password": "..." }`.
- `GET /api/admin/registrations?page=1&limit=20&email=...&registrationStatus=confirmed`
- `GET /api/admin/entries?page=1&limit=20&competition=dance-championship-2026&submissionStatus=submitted`
- `PATCH /api/admin/entries/:id/status` — JSON body: `{ "submissionStatus": "under_review" }`.

All endpoints except login require `Authorization: Bearer <token>`. Pagination limits are 1–100 records per page. Registration statuses are `pending_payment`, `confirmed`, and `cancelled`; entry review statuses are `submitted`, `under_review`, `accepted`, and `rejected`.

Admin endpoints return JSON error messages for invalid input, missing or expired authentication, throttled login attempts, and server errors. Login is limited to five failed attempts per IP within a 15-minute window. Uploaded video files are not exposed through a public static route.
