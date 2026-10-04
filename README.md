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
- **NODE_ENV.** Do not set `NODE_ENV=production` on Render. The build needs the dev tools (`prisma`, `tsx`).
- **Web app address.** If the service name changes, its `onrender.com` address changes too. Update the rewrite in the frontend repository's `vercel.json` to match.
