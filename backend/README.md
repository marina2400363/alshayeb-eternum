# ALSHAYEB ETERNUM Backend

Phase 2 backend API scaffold for MongoDB Atlas.

## Setup

1. Copy `.env.example` to `.env`.
2. Add a MongoDB Atlas connection string to `MONGODB_URI`.
3. Add Cloudinary credentials for payment proof screenshot storage:

```bash
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
```

4. Install dependencies:

```bash
npm install
```

5. Start development server:

```bash
npm run dev
```

Payment proof screenshots are uploaded to Cloudinary. MongoDB stores only lightweight proof metadata such as URL, public ID, original file name, MIME type, and upload timestamp.

## API Surface

- `GET /api/health`
- `GET /api/events`
- `POST /api/events`
- `POST /api/outcomers/register`
- `POST /api/outcomers/payment-proof`
- `GET /api/attendees/lookup?phone=01xxxxxxxxx` (legacy — Season 1 ticket/QR flows depend on its full response; do not change its shape)
- `GET /api/attendees/season2/lookup?phone=01xxxxxxxxx` (Season 2 — phone only, always Incomers, returns only `{ id, fullName, phone, attendeeType }`)
- `PATCH /api/admin/attendees/:id/approve`
- `PATCH /api/admin/attendees/:id/reject`
- `POST /api/scanner/validate`
- `GET /api/export/attendees`

## Rate limiting (Season 2)

Mongo-backed fixed-window limiter (`src/middleware/rateLimit.js`, rules in
`src/config/rateLimits.js`); safe on Vercel serverless because counters live in
the `ratelimits` collection, not instance memory. Identities are HMAC-hashed
(`RATE_LIMIT_SECRET`, else `JWT_SECRET`); no phone/email/IP is stored. Blocked
requests get `429` with a `Retry-After` header. Customer routes fail open on a
limiter store error; admin login fails closed (503). `RATE_LIMIT_MODE` is
`enforce` (default), `log` or `off`.

Create the TTL index once in production (explicitly — never `syncIndexes`):

```js
db.ratelimits.createIndex({ expireAt: 1 }, { expireAfterSeconds: 0, name: "ratelimits_expireAt_ttl" })
```

`GET /api/cron/sync-all` and `GET /api/rooms/force-sync` require
`Authorization: Bearer <CRON_SECRET>` (see `.env.example`).
