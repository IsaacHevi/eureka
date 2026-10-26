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

Create a named room, choose a nickname, and share its invitation link or full code. Invitations grant immediate access to all history. At most 20 connections may participate at once. Text messages arrive in real time. Rooms expire 24 hours after creation, independent of activity; creators may delete them earlier. No editing or individual message deletion. Synthesized retro notification sounds are opt-in.

Messages, profiles, and room names are encrypted in browsers using Web Crypto AES-256-GCM with random 96-bit nonces. A cryptographically random 256-bit invitation secret derives separate message-encryption and server-access keys through HKDF-SHA-256. The invitation secret is carried in the URL fragment and is not sent to the HTTP server; the derived access key is sent over WebSocket. The server stores only encrypted history, opaque profiles, access credentials, expiry, and connections in memory. It does not receive the message-encryption key. Expired/deleted history is removed from application memory; this is not a guarantee of forensic memory erasure.

All traffic goes through the server; there are no direct peer connections or participant IP fields. Participants cannot obtain each other's IPs through the app's connection protocol. The server/network operator can observe connection IPs and traffic metadata. Shared links or message content can disclose identity or addresses independently.

## Current limits and security boundaries

- This is a first version, not an independently audited secure messenger. It uses standard cryptographic primitives but has not implemented an audited group messaging protocol, forward secrecy, participant identity verification, or key rotation. Anyone holding an invitation can impersonate nicknames and read all room history.
- The browser trusts the app server to deliver honest JavaScript. A compromised server could serve code that steals keys. End-to-end encryption does not eliminate that web-delivery trust.
- Rooms are in-memory on one server. Restarting the server closes every room early. There is no multi-instance coordination or durable encrypted storage.
- The application limits each room to 2,000 messages, messages to 4,000 characters in the UI, and incoming connections to 120 requests per minute. Joining is limited to 30 attempts per minute per directly connected IP. Production needs connection limits and proxy-level abuse controls; proxied users may share a rate-limit bucket.
- Session storage holds current-tab access and is cleared on leave or observed expiry/deletion. Closing the tab normally loses that access; return with the invitation. Creator deletion authority is stored separately in local storage until expiry and restored on rejoining in that browser. Private browsing/storage clearing can lose it. Closed browsers clean expired creator records on their next visit.
- The server cannot remotely erase data retained by offline browsers, screenshots, exports, browser recovery, extensions, or recipients. No screenshot prevention or guaranteed erasure is claimed.
- Delivery is confirmed by the sender seeing its server echo. There is no durable delivery receipt, deduplication across reconnect retries, offline send queue, or push notification support.
- No Microsoft assets or audio files are bundled. The nostalgic presentation and synthesized tones are original implementation assets.

The existing server tests cover live relay, history retrieval, invalid access, creator authorization, deletion, expiration, and HTTP privacy headers. A two-browser Chromium smoke check additionally exercised browser encryption/decryption, joining, real-time replies, refresh, mobile width, and deletion. Run a security review and production deployment hardening before sensitive use.
