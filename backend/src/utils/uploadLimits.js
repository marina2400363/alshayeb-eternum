// Upload ceiling for CUSTOMER-facing Season 2 uploads (Incomer photo, deposit
// payment proof). The API runs as a Vercel serverless function, whose request
// body limit is ~4.5 MB for the WHOLE multipart request (file + form fields +
// boundaries). A larger limit here (it used to be 5 MB) is unreachable: Vercel
// would cut such a request off with a generic 413 before the app could answer.
// 4 MB leaves ~0.5 MB of headroom for the form fields, and it matches the
// frontend's optimized-upload target for proofs (see
// src/season2/features/payments/utils/proof.js).
const MAX_CUSTOMER_UPLOAD_BYTES = 4 * 1024 * 1024;
const MAX_CUSTOMER_UPLOAD_LABEL = "4MB";

// multer's `fileSize` limit rejects a file whose size EQUALS the limit (it
// treats reaching the limit as truncation), so "4MB or smaller" needs limit+1
// for a file of exactly 4 MB to pass.
const MULTER_FILE_SIZE_LIMIT = MAX_CUSTOMER_UPLOAD_BYTES + 1;

module.exports = { MAX_CUSTOMER_UPLOAD_BYTES, MAX_CUSTOMER_UPLOAD_LABEL, MULTER_FILE_SIZE_LIMIT };
