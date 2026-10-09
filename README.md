# NestCare Backend (Express + MongoDB Atlas + Better Auth)

## Run
1. `npm install`
2. Copy `.env.example` to `.env` and fill it in
3. `npm run dev`  ->  "MongoDB connected" + "Server on port 5000"
4. `npm test`     ->  20 tests (auth flow, dashboard logic, route guards)

## Roles
| Who | How they sign in | What they can do |
|---|---|---|
| Family member (caregiver) | Better Auth email + password session | Own patients: full access. Joined patients: view + quick actions |
| Profile owner (family who created the patient) | same | Also: edit/delete patient, invite + pairing codes, sample data |
| Patient | Pairing code once, then a device token (no password) | Sends "opened the app" check-ins only |

## Auth (Better Auth, under /api/auth/*)
sign-up/email, sign-in/email, sign-out, get-session, request-password-reset, reset-password, change-password.
Sessions last 7 days. Password reset tokens last 30 minutes and are **printed in this terminal**
(no email service connected yet - swap `sendResetPassword` in `lib/authConfig.js` for a real mailer).

## Family API (needs login) - also available without /api prefix for patients
- GET/POST /api/patients, POST /api/patients/join {inviteCode}
- GET/PUT/DELETE /api/patients/:id, POST /api/patients/:id/regenerate-codes
- GET /api/patients/:id/dashboard?tz=<getTimezoneOffset>
- POST /api/patients/:id/activities {type: mood|note, value?, message?}
- POST /api/patients/:id/reminders {title, kind, scheduledAt}, PATCH .../reminders/:rid {status}
- POST /api/patients/:id/alerts/:aid/resolve
- POST /api/patients/:id/demo {scenario: normal|stale|empty, tz}
- GET/PUT /api/settings

## Patient device API
- POST /api/patient-device/pair {pairCode} -> {token, patient}
- GET /api/patient-device/me, POST /api/patient-device/checkin, DELETE /api/patient-device/unpair  (Authorization: Bearer <token>)
