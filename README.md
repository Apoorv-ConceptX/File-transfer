# Relay · File & Image Toolkit

A complete Next.js repository for a private Google Drive workspace. Deploy the UI and API on Vercel; PostgreSQL keeps checkpoints and Inngest runs jobs after the browser closes.

**You must configure Google OAuth, a PostgreSQL database and Inngest before live jobs work.** Deploying the frontend alone does not run transfers. No credentials are included.

## What is included

- Copy files and folders within Google Drive, including Shared Drives and accessible shared folders.
- Multiple source links/IDs, a destination link/ID, recursive or current-folder-only discovery.
- **Any file type**: JPG, PNG, JSON, JSONL, ZIP, PDF, CSV, XLSX, custom formats, compound extensions (`tar.gz`), or all files including extensionless files.
- Include/exclude extensions, filename substring filter, excluded subfolder names.
- XLSX (first worksheet), CSV and TSV selection lists, with column mapping.
- Match by filename, Drive file ID, equipment ID in a filename, or folder name/ID and its descendant contents.
- Exact case-insensitive filenames, extension-independent matches, or substring matching.
- Preserve hierarchy, flatten, Structure ID folders, or Batch → Structure ID folders.
- Explicit batch labels or automatic groups of 400 unique structures (configurable).
- Preview before copying; no source changes. Skip, rename or report collisions. No overwrite/delete operation.
- Persistent job history, progress, pause/resume, cancellation, retry errors and stalled-job requeue.
- Image metadata and folder inventory exports to CSV. Available metadata includes dimensions, camera, capture time and GPS.
- File reports and selection reports (matched, missing and ambiguous rows).
- Google login with an email allowlist, server-side sessions, PKCE, encrypted refresh tokens and ownership checks.
- Saved presets in your browser. Uploaded selection rows are not saved in presets.

## Deploy to Vercel

### 1. Put this repository on GitHub

Extract the ZIP. The folder containing `package.json` must be the repository root.

```bash
npm ci
npm test
npm run build
```

Node.js 22 or newer is required. Commit `package-lock.json`; keep `.env.local` out of Git.

Create an empty GitHub repository, then run from this directory:

```bash
git init
git add .
git commit -m "Initial Relay file toolkit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPOSITORY.git
git push -u origin main
```

### 2. Create a PostgreSQL database

Neon is a convenient option, including through Vercel's integrations. Any PostgreSQL service reachable by Vercel works.

Copy the **pooled connection string** into `DATABASE_URL`. With Neon, retain the provider's TLS parameters such as `sslmode=require`. Do not disable certificate verification.

Locally, create `.env.local` from `.env.example`, set `DATABASE_URL`, and run:

```bash
npm run db:migrate
```

This creates the tables in `scripts/schema.sql`. It is safe to run again on the same v1 schema. Future schema changes require explicit migrations; `IF NOT EXISTS` does not modify old tables. Do not run this as the Vercel build command: builds should not need database credentials or change a database.

### 3. Import the GitHub repository into Vercel

Choose the **Next.js** framework preset, `npm ci` for installation and `npm run build` for the build. Use the repository root and a Node.js 22+ runtime. Enable Fluid Compute; the background endpoint requests a 300-second maximum duration.

You may deploy once to obtain your stable production hostname. The page displays a setup message until configuration is complete. Use your production hostname, not a temporary preview URL, for OAuth.

### 4. Configure Google OAuth

In [Google Cloud Console](https://console.cloud.google.com/):

1. Create/select a project and enable **Google Drive API**.
2. Configure the Google Auth Platform consent screen. For a Workspace-only tool, use an internal audience if your organisation supports it. For external testing, add your Google account as a test user.
3. Create an OAuth client with type **Web application**.
4. Add this exact authorised redirect URI:

   ```text
   https://YOUR-PRODUCTION-DOMAIN/api/auth/callback
   ```

5. For local development, also add `http://localhost:3000/api/auth/callback`.
6. Copy the client ID and client secret into Vercel environment variables.

The app requests `openid email profile` and the full `https://www.googleapis.com/auth/drive` scope. The full Drive scope is needed to discover and copy arbitrary existing folders; `drive.file` alone is insufficient for this workflow. The application itself only lists, reads metadata, creates destination folders and copies files. It has no delete/overwrite UI or API.

Google may require verification/security assessment for external production apps using restricted scopes; organisational policy can also block access. An external consent screen left in Testing can issue refresh tokens that expire after seven days. Account sign-in, Workspace policy and Drive copy restrictions still apply. See Google's OAuth documentation linked below.

### 5. Connect Inngest

Create an [Inngest](https://www.inngest.com/) account/app and use the official Vercel integration, or manually set both Cloud keys:

- `INNGEST_EVENT_KEY`
- `INNGEST_SIGNING_KEY`

Sync the production app endpoint:

```text
https://YOUR-PRODUCTION-DOMAIN/api/inngest
```

Confirm that **drive-job-worker** appears in the Inngest dashboard. The Vercel integration can sync deployments automatically. Keys must belong to the same Inngest environment. **Remove `INNGEST_DEV` from the Vercel production environment.**

If Vercel Deployment Protection blocks the worker endpoint, configure Inngest's documented protection bypass for that deployment. Do not remove the app's Google sign-in/allowlist checks. See Inngest's Vercel guide for platform-specific setup.

### 6. Set production environment variables

| Variable               | Value                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------- |
| `APP_URL`              | Exact stable production origin, e.g. `https://relay-yourname.vercel.app`; no trailing slash |
| `ALLOWED_EMAILS`       | Your Google email; comma-separated addresses if more people need access                     |
| `GOOGLE_CLIENT_ID`     | OAuth web client ID                                                                         |
| `GOOGLE_CLIENT_SECRET` | OAuth web client secret                                                                     |
| `TOKEN_ENCRYPTION_KEY` | A persistent random 32-byte key, base64 encoded                                             |
| `DATABASE_URL`         | PostgreSQL connection string with TLS enabled                                               |
| `INNGEST_EVENT_KEY`    | Inngest production event key                                                                |
| `INNGEST_SIGNING_KEY`  | Inngest production signing key                                                              |

Generate the encryption key locally:

```bash
openssl rand -base64 32
```

Or with Node.js:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Do not prefix secrets with `NEXT_PUBLIC_`. Do not commit them. Keep the encryption key stable and backed up: changing it makes stored Google refresh tokens unreadable; users must reconnect after a key change.

Redeploy after setting the variables. Open the app, click **Connect Google**, grant Drive access, and test with a small source and destination first.

### 7. Verify the first job

1. Create a small source with a JPG, JSON, ZIP and one subfolder.
2. Choose **All files**, scan recursively and verify the preview. Destination must remain unchanged.
3. Start copying. Close the browser tab and check Inngest's run history.
4. Reopen the app and verify copied files and CSV statuses.
5. Run a second copy with **Skip existing** and verify that existing filenames are skipped.
6. Test pause/resume on a larger sample before a production-scale job.

## Local development

```bash
npm ci
cp .env.example .env.local
# Fill Google OAuth, database, allowlist and encryption settings.
# Keep APP_URL=http://localhost:3000 and INNGEST_DEV=1 locally.
npm run db:migrate
npm run dev
```

In a second terminal:

```bash
npm run inngest:dev
```

Open `http://localhost:3000` for Relay and `http://localhost:8288` for the local Inngest dashboard. Jobs require both processes during local development. In production, Inngest Cloud triggers the Vercel endpoint; no Colab or continuously running laptop is needed.

## Spreadsheet examples

See `examples/filename-selection.csv`, `examples/folder-selection.csv` and `examples/equipment-selection.csv`.

Typical mapping:

| Spreadsheet column                            | UI mapping                                |
| --------------------------------------------- | ----------------------------------------- |
| `filename` / `file_location_vendor`           | Match values → Filenames                  |
| `file_id`                                     | Match values → Drive file IDs             |
| `equipment_id`                                | Match values → Equipment IDs in filenames |
| `Structure ID` containing source folder names | Match values → Folder names or IDs        |
| `structure_id`                                | Structure ID destination mapping          |
| `batch`                                       | Optional explicit batch label             |

Choose the correct **Values represent** setting. Equipment matching uses identifier boundaries: `123` matches `pole_123_Dx.jpg` but not `pole_1234_Dx.jpg`. Folder matching is exact by name (case-insensitive) or ID, and includes descendant files when recursive search is enabled. Missing folder rows with no eligible descendant files are reported as missing. Folder-list selection omits empty folders.

Filename matching is deliberately conservative: one filename reference matching multiple source files is marked ambiguous and excluded, even when the bytes might be identical. Equipment/folder selection intentionally allows multiple files. A file assigned to multiple different destination folders is also excluded. Use exact Drive file IDs to disambiguate files.

Keep IDs and leading zeros as **text** in Excel. The parser uses the first worksheet; it cannot restore zeros or digits already lost by Excel's numeric formatting. Legacy `.xls` is not supported; save it as `.xlsx` first. Limits: 25,000 rows, 10 MB local selection-file size, 3 MB serialised job configuration. Split larger lists across jobs.

## Copy and folder behaviour

- A single folder source copies its **contents** into the destination. With preserve layout, its descendant folders are recreated; the source root itself is not wrapped in another folder.
- Multiple sources get distinct root prefixes (`name__DriveID`) in preserve layout to avoid accidental merging. A direct file source is placed at destination root.
- Empty folders are preserved for unfiltered whole-tree copies. When extensions, filename filters or selection lists are used, only folders needed by eligible files are created.
- Nested Drive shortcuts are reported as skipped and not followed. A shortcut supplied as a top-level source/destination link is resolved first. This prevents shortcut cycles and unexpected traversal outside the requested tree.
- The destination cannot equal a source folder or be inside it. Listing/copying obeys your Google account's permissions and Shared Drive restrictions.
- **Skip existing compares names, not contents.** It reports the item as skipped without claiming checksum equivalence.
- Rename adds the complete source file ID before the last extension. If that deterministic name already exists, the item becomes an error; the app does not create endless numbered duplicates.
- Duplicate destination folders with the same name are rejected; resolve them before retrying. Duplicate source folder paths are rejected rather than merged silently.
- Copies verify binary size and MD5 checksum where Google supplies them. Source changes after preview become per-file errors; create a new preview for the new version.
- Google-native documents do not expose binary size/MD5; the app checks modified time before copying but cannot provide byte-level verification for them.
- Pause/cancel stops at a work boundary. An already running Drive request or scan page can finish. Cancellation leaves completed copies intact.
- Job completion does **not** mean all files succeeded. Review copied/skipped/error/ambiguous counters and reports. Retry errors after fixing permissions or destination collisions. Changed sources or ambiguous selections require a new preview.
- Scanning is a snapshot, not continuous syncing. New source uploads require a fresh scan.

## Metadata and inventory

Metadata comes from Drive's `imageMediaMetadata`, with common fields as columns and the full available object in `image_metadata`. GPS, camera and capture time may be blank. This version does not download images to extract binary EXIF or unpack ZIPs. JSON and ZIP are copied as normal opaque files.

Reports are fetched in 200-row pages and assembled into a CSV in the browser, avoiding one oversized response. Export when scanning/copying has stopped for a stable report. CSV values are quoted and leading formula characters neutralised for spreadsheet safety. The filename column can therefore acquire a leading apostrophe for formula-like names.

## Architecture and operating costs

- **Next.js 16 / React 19**, TypeScript, no external frontend service.
- **PostgreSQL** via `pg`: users, sessions, jobs, scan cursor, file manifests, selection matches, destination folder mapping and tick receipts.
- **Inngest SDK v4**: one durable work step and one durable continuation event per chunk, with five automatic retries. A chunk scans one Drive page (up to 100 entries), creates up to three empty folders, or copies up to five files.
- Worker-step concurrency is limited to one across the app, preventing overlapping app-managed destination folder creation. Several jobs share this queue; the UI stays available while they wait.
- Job generations invalidate stale events after pause/resume. A generation/sequence receipt makes successful chunk replay idempotent. Per-copy Drive app properties reconcile a lost response before issuing another copy.
- Google does not supply a transactional exactly-once file-copy API here. Marker reconciliation greatly reduces duplicate risk, but cannot guarantee exactly-once delivery under all network/indexing failures. Review reports/destination after uncertain failures.
- A 20,000-file job needs roughly 4,000 copy chunks plus scan/folder chunks. This consumes Inngest runs/steps, Vercel execution time, Drive quota and database storage. Choose service plans for your actual volume; there is no unlimited/free-running guarantee.
- Vercel duration and Google request timeouts can interrupt a slow chunk. Previously recorded work remains, and retries reconcile it. For unusually deep/slow trees, lower the worker batch size.

The database retains filenames, source/destination IDs, selection data and image metadata (including GPS when available). Host the database in an appropriate region, restrict access, and apply your own retention policy. Sign-out removes the browser session; queued jobs continue using the encrypted offline Google credential. To revoke access, revoke the Google app grant and remove the account's email from the allowlist. Existing worker steps do not depend on an open browser session.

## Commands

```bash
npm run dev          # Local UI/API
npm run inngest:dev  # Local durable job server
npm run db:migrate   # Initialise v1 database tables
npm run typecheck    # TypeScript
npm test            # Rules + PostgreSQL-backed worker tests (PGlite, mocked Google API)
npm run build       # Production build
npm run start       # Production server
```

Tests cover mixed formats, recursive discovery/pagination, current-folder filtering, selection ambiguity, folder contents, lost-response recovery, stale generations, pause/resume, rate limits, collision skipping, changed sources, metadata read-only behaviour, encryption and CSV injection handling. They do not call a live Google account or Inngest Cloud.

## Troubleshooting

| Symptom                     | Check                                                                                                             |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Setup banner                | Required environment variables, then redeploy                                                                     |
| `redirect_uri_mismatch`     | Google redirect URI and `APP_URL` must match your current hostname exactly                                        |
| Google email rejected       | Add the exact verified Google email to `ALLOWED_EMAILS`; redeploy                                                 |
| Connection fails            | Run migration; verify database TLS/network and OAuth client secret                                                |
| Job sits in scanning        | Inngest app synced, event/signing keys, production `INNGEST_DEV` removed, deployment protection bypass configured |
| Job stalled after an outage | Use **Requeue stalled job** after two minutes; inspect Inngest logs                                               |
| Google credential expired   | Connect Google again, then resume the saved job                                                                   |
| Missing files               | Check recursion, file types, selected spreadsheet column, exact IDs and folder permissions                        |
| Ambiguous matches           | Use exact Drive file IDs or a narrower source; create a new preview                                               |
| Shared Drive copy denied    | Check source copy restrictions and destination write permissions; the app does not bypass them                    |
| Completed with errors       | Download the file report, fix the reported issue, then retry errors                                               |

## Official references

- [Vercel function limits](https://vercel.com/docs/functions/limitations)
- [Inngest on Vercel](https://www.inngest.com/docs/durable-execution/deploying-functions/platforms/vercel)
- [Inngest checkpointing](https://www.inngest.com/docs/durable-execution/guides-and-advanced/checkpointing)
- [Google OAuth web-server flow](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Google OAuth token expiration](https://developers.google.com/identity/protocols/oauth2#expiration)
- [Drive files resource and metadata](https://developers.google.com/workspace/drive/api/reference/rest/v3/files)

MIT licensed. See LICENSE.
