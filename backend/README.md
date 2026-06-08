# ALSHAYEB ETERNUM Backend

Phase 2 backend API scaffold for MongoDB Atlas.

## Setup

1. Copy `.env.example` to `.env`.
2. Add a MongoDB Atlas connection string to `MONGODB_URI`.
3. Install dependencies:

```bash
npm install
```

4. Start development server:

```bash
npm run dev
```

The current React frontend is not connected to this backend yet. The Google Apps Script flow remains untouched until the backend is tested.

## API Surface

- `GET /api/health`
- `GET /api/events`
- `POST /api/events`
- `POST /api/outcomers/register`
- `POST /api/outcomers/payment-proof`
- `GET /api/attendees/lookup?phone=01xxxxxxxxx`
- `PATCH /api/admin/attendees/:id/approve`
- `PATCH /api/admin/attendees/:id/reject`
- `POST /api/scanner/validate`
- `GET /api/export/attendees` placeholder
