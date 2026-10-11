# Control Room Reporting — API

Hono + Prisma (SQL Server) API for the Control Room Operations, Incident & Shift Reporting System. The web app lives in its own repository and talks to this API under `/api`.

`shared/` holds `@sr/shared`, the Zod schemas, constants and API types. The frontend repository carries a copy of `shared/src`. Change it in the combined workspace and run `pnpm sync-shared` there, so the two copies stay identical.

## Run locally

Requires Node 22+, pnpm 10 and SQL Server.

```bash
pnpm install
cp .env.example .env                # fill in DB_* and SR_SEED_ADMIN_*
pnpm db:generate && pnpm db:deploy && pnpm db:seed
pnpm dev                            # http://localhost:3000/api/health
```

Optional demo data for development: `pnpm db:seed:samples` adds the mobile unit KDG 143S and the location Mlolongo.

Incidents come in two kinds, following the Excel prototype:

- **Static weighbridges** use the Incident Register flow and are numbered INC-YYYY-NNNN.
- **Mobile weighbridges** use the Mobile Weighbridge flow (vehicle, GPS/dashcam status, platform) and are numbered MWB-YYYY-NNNN.

Manage the mobile units under Admin → Vehicles.

Tests use a separate database. Copy `.env.test.example` to `.env.test` (DB_DATABASE=shiftreporting_test), then run `pnpm test`.

## Deploy: Azure SQL Database + Render

### 1. Azure SQL Database
1. In the Azure portal, create an **Azure SQL Database**. Note:
   - the server name (`yourserver.database.windows.net`);
   - the database name;
   - the server admin login and password.
2. Go to SQL server → **Networking**. Under **Firewall rules**, add:
   - your own PC's IP address, for maintenance;
   - Render's outbound IP addresses, found in your Render service under **Connect → Outbound**.

   Note that "Allow Azure services" does **not** cover Render.

### 2. Render (Web Service)
1. In Render, choose **New → Blueprint** and pick this repository. `render.yaml` sets up the service, a 1 GB disk for snapshots, and the settings below.
2. Fill in the values Render asks for:

| Setting | Value |
|---|---|
| `SR_APP_BASE_URL` | the Vercel address of the web app, e.g. `https://shiftreporting.vercel.app` |
| `DB_SERVER` | `yourserver.database.windows.net` |
| `DB_DATABASE` / `DB_USER` / `DB_PASSWORD` | from Azure |
| `SR_SEED_ADMIN_EMAIL` / `SR_SEED_ADMIN_PASSWORD` | the first administrator; the password must be changed at first sign-in |
| `SR_SMTP_HOST` / `SR_SMTP_USER` / `SR_SMTP_PASSWORD` / `SR_SMTP_FROM` | optional; the sending mailbox (see Email and shift reports below). `SR_SMTP_PASSWORD` is a secret |

3. Each deploy runs these in order:
   - `pnpm install`
   - `prisma generate`
   - `prisma migrate deploy` (creates or updates the tables)
   - the seed (default lists and settings; it creates the administrator only if none exists)
   - then it starts the API on port 10000.
4. Check `https://<service>.onrender.com/api/health`. It should return `{"ok":true}`.

Notes:
- **Plan.** The blueprint uses the **Starter** plan. The free plan sleeps after 15 minutes without traffic, which drops live updates and makes the next visit slow. It also cannot have a disk.
- **Snapshots.** They are stored on the disk at `/var/data/uploads` (`SR_UPLOAD_DIR`). Without a disk, every deploy or restart deletes them.
- **Report PDFs.** They are stored on the same disk at `/var/data/reports` (`SR_REPORT_DIR`). Without a disk, every deploy or restart deletes them. `SR_SMTP_PORT` (`587`) and `SR_SMTP_SECURE` (`false`) are preset in `render.yaml`; change them for port 465.
- **NODE_ENV.** Do not set `NODE_ENV=production` on Render. The build needs the dev tools (`prisma`, `tsx`).
- **Web app address.** If the service name changes, its `onrender.com` address changes too. Update the rewrite in the frontend repository's `vercel.json` to match.

## Email and shift reports

At the end of each shift the Shift Supervisor submits the shift report. The report is frozen, a PDF is stored, and every address in **Settings → System settings → Deputy Director emails** gets an email with the PDF attached. If a report is not submitted within the report deadline (default 30 minutes after the shift ends), the Deputy Director gets an overdue email with the draft PDF and the supervisor gets a reminder (once each).

Configure SMTP through environment variables (on Render, in the service's Environment tab). All are optional: without `SR_SMTP_HOST` emails are logged as skipped.

| Variable | Example |
|---|---|
| `SR_SMTP_HOST` | `smtp.office365.com` (Microsoft 365) or `smtp.gmail.com` |
| `SR_SMTP_PORT` | `587` |
| `SR_SMTP_SECURE` | `false` for 587 (STARTTLS), `true` for 465 |
| `SR_SMTP_USER` / `SR_SMTP_PASSWORD` | the sending mailbox and its password or app password |
| `SR_SMTP_FROM` | `"KeNHA Control Room <controlroom@kenha.co.ke>"` |
| `SR_REPORT_DIR` | folder for stored report PDFs. On Render use the persistent disk, e.g. `/var/data/reports` |

Microsoft 365 requires SMTP AUTH to be enabled for the sending mailbox; Gmail requires 2-step verification and an app password. After setting the variables, restart the backend and use **Admin → Settings → Email → Send test email**, then check **Admin → Email log**. Failed emails are retried after 1, 5, 15 and 60 minutes and can be retried by hand from the log.
