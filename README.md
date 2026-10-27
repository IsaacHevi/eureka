# Eureka

A real-time, account-free, temporary group chat with a Windows XP-inspired interface. Node.js 24 and a modern browser are recommended.

## Run

```sh
npm ci --cache /workspace/.npm
npm start
```

The server listens on port 3000 (`PORT` overrides it). Open it locally in a browser. Production must use HTTPS/WSS: browser cryptography is available only in secure contexts, with localhost allowed for development. Behind a reverse proxy, set `PUBLIC_ORIGIN` to the exact public HTTPS origin. Do not log invitation URLs, WebSocket payloads, or IP addresses at the proxy. No analytics, remote fonts, or third-party browser resources are used.

```sh
npm test
```

## Behavior

Create a named room, choose a nickname, and share its invitation link or full code. Invitations grant immediate access to all history. At most 20 connections may participate at once. Text messages arrive in real time. Rooms expire 24 hours after creation, independent of activity; creators may delete them earlier. No editing or individual message deletion. Synthesized retro notification sounds and browser pop-up alerts are opt-in.

Messages, profiles, and room names are encrypted in browsers using Web Crypto AES-256-GCM with random 96-bit nonces. A cryptographically random 256-bit invitation secret derives separate message-encryption and server-access keys through HKDF-SHA-256. The invitation secret is carried in the URL fragment and is not sent to the HTTP server; the derived access key is sent over WebSocket. The server stores encrypted history, opaque profiles, access credentials, and expiry in Supabase when configured; active connections remain in server memory. Local development defaults to memory storage. It does not receive the message-encryption key. Deleted rooms are removed from the database immediately. Expired rooms become inaccessible at their deadline and are removed by a database job approximately every minute. This is not a guarantee of forensic erasure or deletion from provider backups.

All traffic goes through the server; there are no direct peer connections or participant IP fields. Participants cannot obtain each other's IPs through the app's connection protocol. The server/network operator can observe connection IPs and traffic metadata. Shared links or message content can disclose identity or addresses independently.

## Current limits and security boundaries

- This is a first version, not an independently audited secure messenger. It uses standard cryptographic primitives but has not implemented an audited group messaging protocol, forward secrecy, participant identity verification, or key rotation. Anyone holding an invitation can impersonate nicknames and read all room history.
- The browser trusts the app server to deliver honest JavaScript. A compromised server could serve code that steals keys. End-to-end encryption does not eliminate that web-delivery trust.
- Production requires Supabase storage so rooms, invitations, creator credentials, and encrypted history survive Render sleep/restarts. Live connections remain single-instance; do not scale Render past one instance without adding coordinated message delivery and presence. Local memory-only mode loses rooms on restart.
- The application limits each room to 2,000 messages, messages to 4,000 characters in the UI, and incoming connections to 120 requests per minute. Joining is limited to 30 attempts per minute per directly connected IP. Production needs connection limits and proxy-level abuse controls; proxied users may share a rate-limit bucket.
- Session storage holds current-tab access and is cleared on leave or observed expiry/deletion. Closing the tab normally loses that access; return with the invitation. Creator deletion authority is stored separately in local storage until expiry and restored on rejoining in that browser. Private browsing/storage clearing can lose it. Closed browsers clean expired creator records on their next visit.
- The server cannot remotely erase data retained by offline browsers, screenshots, exports, browser recovery, extensions, or recipients. No screenshot prevention or guaranteed erasure is claimed.
- Delivery is confirmed by the sender seeing its server echo. There is no durable delivery receipt, deduplication across reconnect retries, offline send queue, or push notification support.
- No Microsoft assets or audio files are bundled. The nostalgic presentation and synthesized tones are original implementation assets.

The existing server tests cover live relay, history retrieval, invalid access, creator authorization, deletion, expiration, and HTTP privacy headers. A two-browser Chromium smoke check additionally exercised browser encryption/decryption, joining, real-time replies, refresh, mobile width, and deletion. Run a security review and production deployment hardening before sensitive use.

## Message alerts

Click **Enable alerts**, then allow notifications in the browser prompt. This also unlocks the retro sound player during the click so incoming messages can play sound in a background tab. **Sound: on/off** mutes sound independently; **Alerts: on** turns pop-ups off. Preferences are remembered locally without storing messages or keys. After refresh, interact with the page to let the browser resume sound.

New messages from other participants play sound when enabled. If the tab is hidden or unfocused, they also increment the tab-title unread count and display a generic “New message in your private chat” notification when permitted. Names, room titles, message contents, and invitations are never included in notification payloads. Clicking a notification returns to Eureka. Focusing the tab or leaving/closing the room clears unread indicators and notifications. History loading and your own messages do not trigger alerts.

The service worker displays notifications on compatible browsers; it does not cache the app or retain keys/messages, and it does not subscribe to a push service. **The Eureka tab must remain open and connected.** Closed or suspended tabs cannot reliably receive alerts. Desktop Chromium is browser-tested; Safari/Firefox behavior and OS banners still depend on permissions and device settings. iPhone/iPad web notifications require a Home Screen web app and push support, which this version does not implement. Do Not Disturb, blocked permissions, browser autoplay policy, mobile background suspension, and private-browsing restrictions may suppress sound or notifications.

`npm test` also covers foreground/background alert behavior, generic notification contents, focus clearing, mute/disable, denied/unsupported permissions, and service-worker delivery selection.

## Free persistent storage on Render

1. Create a **Free** Supabase project. Do not enable paid upgrades, paid add-ons, or a custom domain.
2. In the Supabase SQL Editor, run [supabase/setup.sql](supabase/setup.sql). It creates a private table, an atomic message append function, and the scheduled expiry cleanup. Confirm the entire script succeeds, including the `pg_cron` schedule. Tables and RPCs are denied to anonymous and signed-in browser roles; only the server secret has access.
3. In Render → Eureka → Environment, set `SUPABASE_URL` to the project's HTTPS URL and `SUPABASE_SECRET_KEY` to its **secret server API key** (or legacy `service_role` key). Never use a publishable/anon key. Never paste the secret into chat, source code, a URL, or browser code.
4. Deploy the storage update. On Render, startup deliberately fails if storage settings are missing, instead of silently creating disposable rooms. Keep `PUBLIC_ORIGIN` set to your public Eureka origin.
5. Create a fresh room, send a message, refresh, and join with a second browser. Restart the Render service, then rejoin using the original invitation: history, expiry, and creator deletion rights should still work.

Existing rooms lost before this fix cannot be recovered. Deploy only **after** the database and environment variables are configured. Supabase's free plan has quotas and may pause inactive projects; provider outages or pauses can temporarily prevent access. No paid plan is required for this setup, but this is not a guarantee of unlimited capacity or permanent free pricing. A paused database must be resumed to regain access. Expiry cleanup cannot run while the database is paused, although expired rooms remain inaccessible when it resumes.

The PostgreSQL tests execute the actual schema and append function with PGlite. Separate server tests replace the application server while retaining its backing store and check original invitations, history, expiry, deletion authority, and no resurrection of deleted rooms. Supabase credentials, remote REST configuration, cron extension availability, and hosted restart behavior must also be verified after deployment; these are not proven by local tests.
