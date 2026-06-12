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
- `GET /api/attendees/lookup?phone=01xxxxxxxxx`
- `PATCH /api/admin/attendees/:id/approve`
- `PATCH /api/admin/attendees/:id/reject`
- `POST /api/scanner/validate`
- `GET /api/export/attendees`
