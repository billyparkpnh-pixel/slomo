# SLOMO — make the night yours

A complete, dependency-free Node.js 24 application: responsive customer website, reference-based interactive floor plan, persistent SQLite bookings, staff dashboard, and transactional email outbox.

## Preview locally

```sh
cd /workspace/slomo
node --version     # Node.js 24 or newer
npm start
```

Open `http://localhost:3000` in your local browser, or your hosting IDE’s forwarded port 3000. Staff dashboard: `/admin`. `npm run dev` restarts the server when files change. No dependency installation or build is required. HTML/CSS/JS assets are served directly; refresh the browser after editing.

The initial development username is `admin` (the form only asks for the password). On the first run, the server generates a random password in `data/local-admin-password.txt`, readable only by the process owner. Read that file locally to sign in; do not commit or share it. Alternatively set `ADMIN_PASSWORD` to a unique password of at least 12 characters before startup. To rotate an existing password, set `ADMIN_PASSWORD` in `.env` or the process environment and run `npm run admin:password`; restart the app with the same configuration. Rotation revokes all sessions.

Optional configuration: copy `.env.example` to `.env`. Node loads it automatically; existing process variables take precedence. Keep credentials out of Git. The database, uploaded media, local admin password and email outbox are all under `data/`, which is ignored.

## What is implemented

- Original chrome/cyan SLOMO campaign design, full-screen hero, silver editorial experience section, visual highlights, bottle packages, mobile navigation, motion controls and responsive booking UI. Self-hosted fonts and SVG artwork keep the public site independent of third-party CDNs.
- 60 visible tables traced from the supplied reference. DJ booth, bar, entrance, columns, VIP rows and visible WC are preserved. Desktop defaults to a rotated view; mobile defaults to the original portrait orientation. Rotate or enlarge the plan as needed. Tables support mouse, touch and keyboard selection.
- Orange VIP V1–V10: 2 bottles of whiskey. Green tables: 1 bottle of whiskey. Turquoise tables: 6 bottles of beer. T48/T49 occupy the two red-marked positions confirmed in conversation. T39/T40 are not visible in the supplied crop and have not been invented.
- Reservations collect a date, table, guest count, name, phone and email, with privacy/terms consent. Availability and capacities are enforced by the server. A unique partial SQLite index and transaction prevent concurrent double bookings. Idempotency keys prevent duplicate submissions. Dates use **Asia/Phnom_Penh**, with a 90-day booking window.
- Unique booking reference and private cancellation code; downloadable reservation; lookup by reference and email; cancellation with the private code. No payment is collected online.
- Staff login, reservation search/date filters, cancellations, CSV export, date-specific holds, table capacities/minimums, contact details, original-logo/video upload, and email outbox with retry.
- Scrypt password hashes, random hashed session tokens, HttpOnly/SameSite cookies, CSRF and origin checks, input validation, request-size limits, durable rate limits, CSP, escaped emails and CSV-formula protection. Production adds Secure cookies and HSTS.

## References and outstanding venue decisions

The three chat images were visible to the builder but their original files were not mounted in this checkout. The reference video was not attached. The current logo is a **vector reconstruction**, not the original photograph; the floor plan is an interactive transcription, not a generic layout. The public redesign uses original chrome/cyan vector studies inspired by the supplied reference strip. No stock nightclub photos or unrelated branding were substituted. Instagram and TikTok reference pages were blocked by the cloud network, so actual club photos/video could not be imported from those links. The Instagram contact link is https://www.instagram.com/slomocambodia/.

Upload the original illuminated-logo image and video in **Staff → Venue & media**, or set trusted HTTPS URLs there. Supported image types: PNG/JPEG/WebP, 5 MB maximum; videos: MP4/WebM, 25 MB maximum. Uploads are saved on the persistent data disk. The floor-plan crop cuts off part of the right side; confirm whether additional tables or room details need adding before launch. The provided branding screenshot informs the contact details; verify those with the venue.

Guest capacities were not specified: provisional limits are turquoise 6, green 8, VIP 12. Staff can edit them. Confirm these limits, arrival/opening times, minimum orders, contact details, age policy and legal/privacy/retention wording with the venue before accepting real customers. Table edits affect new bookings; existing bookings keep the minimum order agreed at submission.

**Development defaults to DEMO_MODE=true.** T18 and V4 are demonstration holds, and the site explicitly labels all bookings as preview/test reservations. Staff can override demo holds for a particular date. Set `DEMO_MODE=false` for actual operations. All confirmed bookings remain unavailable regardless of an “available” hold override; cancel the booking to release its table.

## Public design files

`public/index.html`, `public/site.css`, `public/site.js`, and the presentation code in `public/app.js` define the customer experience. `public/visuals/` contains the original SVG brand artwork. The admin dashboard continues to load its existing `styles.css`, `admin.css` and `admin.js`; the public stylesheet is isolated from it. Backend modules, database schema, table coordinates, and the shared floor-plan renderer are unchanged by the redesign.

The bottle cards show the real table minimums, not invented event or promotional prices. Category controls highlight tables without hiding or moving them. Guest capacities and minimums are shown from the availability API when a table is selected. Original media configured through the existing admin settings is still supported; invalid video gracefully falls back to the graphic hero.

## Automated emails

With no mail credentials, confirmation and cancellation emails are saved in SQLite with status **local**, and no external message is sent. View their content in **Staff → Email outbox**. Customer-facing confirmation explicitly states local delivery mode.

For real delivery:

1. Create a Resend account and verify a domain you control, including the required DNS records.
2. Securely configure `RESEND_API_KEY` and `MAIL_FROM` (for example, `SLOMO <bookings@your-verified-domain.com>`) on the server. Optionally set `ADMIN_EMAIL` for staff copies. Do not enter credentials into chat or the public website.
3. Allow HTTPS access to `api.resend.com`. Restart the server.
4. Make a test reservation using an inbox you control; verify delivery and cancellation, including spam folders. In the dashboard, **sent** means accepted by Resend, not proof of inbox delivery. Use the provider dashboard for bounce/delivery reports.

Bookings and email jobs are committed in the same transaction. The worker runs after bookings and every 30 seconds, retries failed sends up to 5 attempts, and uses provider idempotency keys. Staff can retry local/failed emails after configuring the provider. Local messages do not automatically send after credentials are added; this prevents accidentally sending old preview reservations.

External delivery has **not** been verified here: credentials were absent and the cloud network proxy refused connections. The local outbox, templates and retry logic are tested. No email is sent before configuration.

## Test

```sh
npm run check
npm test
# Optional browser suite, if Python Playwright and Chromium are installed:
python3 tests/browser.py
```

Backend tests use temporary SQLite databases and loopback servers. Browser tests start a separate test server and cover desktop/mobile booking, unique references, downloads, lookup, cancellation, keyboard selection, terms, admin authentication, holds, email inspection, CSV export, logout, and overflow at 320/390/768/1440 pixels. Screenshots are generated in ignored `test-results/`. `CHROMIUM_PATH` can override `/usr/bin/chromium`. The app itself has no Python or browser-tool dependencies. Tests require permission to open local sockets.

## Publish the website

Use a **single, long-running Node.js 24 service with a persistent disk and HTTPS**. This SQLite deployment is not suitable for ephemeral/serverless hosting, static-only hosting, multiple independent replicas or network-shared SQLite. A snapshot of the cloud workspace is not a public deployment.

1. Push this code to your Git provider, then create a Node web service on a host that supports persistent storage. No build/install command is needed; start with `npm start` from the repository root. Use health path `/api/health`.
2. Mount a persistent disk, for example at `/var/lib/slomo`, and configure `DATA_DIR=/var/lib/slomo`. Ensure the Node process can write there. Preserve this disk across deployments.
3. Set `NODE_ENV=production`, `DEMO_MODE=false`, `HOST=0.0.0.0`, `PORT` as assigned by the host, `SITE_URL=https://your-real-domain`, and a strong `ADMIN_PASSWORD`. Production refuses HTTP site URLs, missing passwords and enabled demo mode.
4. Set the verified mail-provider variables above. Add your domain and HTTPS certificate through the host. The public site and `/api` must share one origin; secure cookies require HTTPS. Set `SITE_URL` to that exact origin for CSRF protection and email links. Keep the underlying app port private behind the host's HTTPS proxy. Set `TRUST_PROXY_HOPS` to the exact number of trusted proxies between visitors and Node (often `1`, confirm with the host) so rate limits distinguish visitors. Leave its default `0` for direct local access; never enable proxy trust on a directly exposed app port.
5. Sign in at `/admin`, upload original assets, verify venue settings/capacities, and test a full reservation, customer email, dashboard entry and cancellation on the public domain. Only then share the site with customers.

For container hosts, a `Dockerfile` is included. Set the same environment variables and attach a **writable persistent volume at `/app/data` owned by UID 1000**. No image build or container deployment was performed in this environment; the native Node runtime is the verified path.

If you want to publish the **development cloud environment** for future coding tasks, review its saved startup instructions in environment settings, then publish it through that UI. Running processes do not survive a snapshot; future tasks must run `npm start` again. This is distinct from deploying the customer website.

## Operations and backups

- Back up `slomo.sqlite` using SQLite's online backup mechanism, plus the `media/` directory. For a simple maintenance backup, stop the service, then copy the entire data directory (including any WAL/SHM files); keep the backup outside the web root with restricted access. Test a restore before launch. Never copy just the live main database while ignoring its WAL.
- Store backups encrypted with your hosting provider and restrict staff credentials. This version has one shared administrator account; add individual roles/audit logging if your staff workflow requires them.
- Schedule venue-approved retention/deletion of guest records and email content. There is no automated retention policy. Never publish the data directory or use real guest information for tests.
- Monitor `/api/health`, provider email failures and disk capacity. Keep Node 24 patched. Set a reverse-proxy body limit of at least 25 MB if uploading video.
- No online payments, stock inventory, SMS, marketing, or POS integration is included. Those were not requested. Booking minimums are order requirements, not online prices.
