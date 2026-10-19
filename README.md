# The Upcycle Collective — TUC Token Event System

A Solana-based community token system built for **The Upcycle Collective**, a circular-economy event in Kuching, Sarawak. Attendees donate reusable materials and earn **wTUC**, a community token they can spend at vendor booths around the event — all through a browser wallet with no crypto knowledge required (email login via [Privy](https://privy.io)).

Live site: [upcycle-collective.vercel.app](https://upcycle-collective.vercel.app)

## What's in here

A static frontend (`public/`) plus a set of Vercel serverless API routes (`api/`, built from `src/api/`) that handle all on-chain actions server-side — the browser never touches a private key or an RPC API key directly.

| Page | Purpose |
|---|---|
| `website.html` (also served at `/`) | Marketing homepage |
| `tickets.html` | Event ticket purchase (Stripe Checkout) |
| `wallet.html` | The attendee wallet app — login, balance, donate, track, redeem, profile |
| `dashboard.html` | Public token activity dashboard |
| `checkin.html` | Event check-in (Solana Pay QR) |
| `workshop-qr.html` / `attend.html` | Workshop attendance QRs, scanned in the TUC wallet |
| `tokenomics.html` | Token supply / distribution info |

### API routes (`src/api/` → built to `api/`)

- `checkin.js` — memo-only attendee/vendor check-in (Solana Pay)
- `donate.js` — donation code generation + redemption, mints wTUC
- `transfer.js` — wallet-to-wallet transfers
- `tickets.js` — Stripe Checkout session creation for event tickets
- `tokenomics.js` — token supply data for the dashboard
- `vendor-history.js` — vendor transaction history lookups
- `pay/*.js` — per-vendor Solana Pay payment endpoints
- `rpc.js` — server-side proxy for Solana JSON-RPC and Helius's Enhanced Transactions API, so the RPC API key never reaches the browser

Shared helpers (Solana connection, organiser keypair, JSON response helpers) live in `src/api/_utils.js`.

## Stack

- **Frontend**: plain HTML/CSS/vanilla JS (no framework, no build step for the pages themselves)
- **Backend**: Vercel serverless functions (Node 22), bundled with esbuild via `build.js`
- **Chain**: Solana (`@solana/web3.js`, `@solana/spl-token`), RPC via [Helius](https://helius.dev)
- **Auth**: [Privy](https://privy.io) (email login → embedded Solana wallet), bundled separately as `public/privy-login.js`
- **Payments**: Stripe Checkout (ticketing)

## Setup

```bash
npm install
cp .env.example .env   # fill in the values below
npm run build           # bundles src/api/*.js → api/*.js and privy-login.jsx → public/privy-login.js
```

Required environment variables (see `.env.example` for the full annotated list):

| Variable | What it's for |
|---|---|
| `ORGANISER_PRIVATE_KEY` | Base58 secret key for the wallet that mints/sends wTUC server-side |
| `ORGANISER_AIRDROP_PIN` | PIN gating the wallet app's organiser airdrop panel |
| `TOKEN_MINT` | The wTUC token mint address |
| `HELIUS_RPC` | Solana RPC endpoint (with API key) |
| `PRIVY_APP_ID` | Privy app ID for wallet login |
| `VENDOR_*` | Public wallet addresses for each vendor booth |
| `STRIPE_SECRET_KEY` + `STRIPE_PRICE_*` | Stripe ticketing — run `npm run setup-tickets` after setting the secret key to generate price IDs |

Deployment is via Vercel (`outputDirectory: public`, `api/` auto-detected as serverless functions — see `vercel.json`).

## Notes

- On-chain actions (minting, transfers) are memo-tagged (`wTUC:...`) and only ever executed server-side by the organiser keypair — client pages just request an action and the API validates + signs it.
- `local-only/` holds standalone offline tools (a scavenger-hunt game, kahoot-style quiz) not part of the deployed site — they hit the production API directly when opened locally.
- `scripts/` holds one-off setup scripts (token deployment, Stripe price setup, on-chain metadata URI updates) — not part of the running app.
