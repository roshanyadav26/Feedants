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

## Participant status email verification

Participant status is available only after proving access to the registration email. The OTP is a cryptographically random six-digit code, stored as an HMAC digest, valid for 10 minutes, limited to five verification attempts, and subject to a 60-second resend cooldown. A successful verification returns a participant status access token valid for 10 minutes. OTP send responses intentionally use the same message whether or not the email is registered.

Configure these backend environment variables in local development and in the Render service settings:

- `EMAIL_USER`: Gmail account used to send verification messages.
- `EMAIL_APP_PASSWORD`: app password for that mail account (not its normal sign-in password).
- `PARTICIPANT_STATUS_TOKEN_SECRET`: a random secret of at least 32 characters, separate from `ADMIN_JWT_SECRET`. It signs participant access tokens and HMACs OTP values with a separate purpose context.

The root `.gitignore` excludes `.env` and `.env.*` while allowing example files. Keep actual credentials only in your local ignored environment or the hosting provider's secret settings; never add them to source control, mobile configuration, or logs.

### Local test flow

1. Set the three variables above in the backend process environment, start MongoDB, and run the backend from `backend/` with `npm run dev`.
2. Use a registered email in the mobile app's **My Status** card and tap **Send OTP**. The API responds with a generic acknowledgement; check that mailbox for the code.
3. Enter the six-digit code and tap **Verify OTP**. The app uses the short-lived access token to request status and displays registration, payment, and submission fields.
4. Try a wrong code five times, an expired code, and a resend within 60 seconds to confirm the API rejects or throttles each action.

The routes are `POST /api/competitions/:slug/status/send-otp`, `POST /api/competitions/:slug/status/verify-otp`, and `GET /api/competitions/:slug/status`. The final GET requires `Authorization: Bearer <accessToken>` and no longer accepts email as authorization.
