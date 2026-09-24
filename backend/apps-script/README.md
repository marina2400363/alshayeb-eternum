# Full Payment auto-detect (Google Sheets → backend)

`FullPaymentOnEdit.gs` makes an accountant's `DONE` in column I take effect within
seconds, with no admin pressing **Sync Full Payment**.

- Sheet edit in column I → installable on-edit trigger → `POST /api/sheets/full-payment-edit`
  (`Authorization: Bearer <CRON_SECRET>`, body `{ spreadsheetId, sheetName }`).
- The backend runs the **existing** Full Payment read-back for that School's sheet
  (exact, trimmed, case-insensitive `DONE`; updates `FullPaymentStatus`; sends the
  "Full Payment Complete" email once, guarded by `completionSentAt`).
- The manual button and the GitHub workflow stay as backup / reconciliation.

## One-time setup — repeat for EACH School finance sheet

The script is identical for every School; only the spreadsheet it is pasted into differs.

1. Open the School's finance Google Sheet → **Extensions → Apps Script**.
2. Replace the contents of `Code.gs` with `FullPaymentOnEdit.gs`. Save.
3. **Project Settings** (gear icon) → **Script properties** → **Add script property**, twice:
   - `BACKEND_URL` = `https://www.alshayebexperience.com/api/sheets/full-payment-edit`
   - `CRON_SECRET` = the same value as the `CRON_SECRET` environment variable on Vercel
4. Back in the editor, pick `installFullPaymentTrigger` in the function dropdown → **Run**.
   Approve the permission prompt (it needs to call the backend and manage this sheet's trigger).
5. Open the School's finance tab, pick `testFullPaymentBackend` → **Run**.
   **Executions** must show `Full Payment sync OK (HTTP 200)`.
   (HTTP 401 → wrong `CRON_SECRET`; HTTP 404 → this spreadsheet isn't linked to a School
   under Admin → Finance.)
6. Confirm: **Triggers** (clock icon) lists `handleFullPaymentEdit` · From spreadsheet · On edit.

The trigger runs as the person who installed it. Use the account that owns the sheet, and
do not remove that account's access.

## Notes

- Use the `www` URL directly. The script refuses to follow redirects so the secret can never be
  forwarded to another host.
- Only edits that touch column I below the header call the backend. Edits made by scripts or the
  Sheets API (including the backend's own sheet updates) do not fire on-edit triggers, so there is no loop.
- Anyone with **Editor** access to the spreadsheet can open its Apps Script project and read Script
  properties. Keep editor access to the accountant and admins only.
- Rotating `CRON_SECRET`: update it on Vercel, in the GitHub secret, and in each sheet's script properties.
