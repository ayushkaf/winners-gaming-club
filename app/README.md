# Winners Gaming Club

A four-tier demo-credit slots platform built on the validated Golden Charge and
Thunder Herd engines in `../core/`, `../models/`, `../sim/`. **No real money
moves anywhere in this codebase** — no payment processing, no real KYC, no
withdrawal logic. Every balance is a Demo Credit, labeled as such everywhere
it's shown.

## Why this exists

This is a portfolio/demo build showcasing a full-stack platform around the
Toro Math Lab engines: authentication, an append-only ledger (balance is
always `SUM(ledger)`, never a mutable stored field), server-authoritative
game resolution, live admin/owner tooling, and a real-time support chat —
without ever building the real-money rails a licensed operator would need
(payment processor, KYC/AML, RNG certification, gambling license). Those are
a business and legal undertaking, not a coding task, and are explicitly out
of scope.

## Architecture

Owner → Developer → Admin → User. Only `role='user'` accounts can play; every
other role manages the platform.

- **Owner** (`/owner`): feature toggles, min/max bet, signup-bonus multiplier,
  the full RTP / model-comparison table and validation-report viewer (kept
  off the public site — see below), system log viewer, staff-account
  management (create admin/developer/owner, disable, change role). Engine
  math itself (`core/`, `models/`, the tuned coin weights) is not editable
  here — only presentational config.
- **Developer** (`/admin`): everything an admin can do, plus visibility
  across every admin's players — the cross-cutting operational tier between
  admin and owner.
- **Admin** (`/admin`): user search/create/disable, per-user ledger view,
  manual Demo Credit adjustment (reason required, written to the ledger with
  admin ID + timestamp), live support chat, RTP/analytics — scoped to only
  the players assigned to that admin's Staff ID (e.g. `ADMIN01`). A player
  created by an admin is auto-assigned to them; players can also be
  transferred between admins/developers, or a player can self-route by
  quoting a Staff ID at signup or in their first support message.
- **User** (`/play`, `/history`, `/chat`, `/account`): signup with a fixed,
  non-configurable 20-credit bonus, an optional self-reported (never
  verified) address, play both games at any bet from the configured minimum
  (1 Demo Credit by default) up to the configured maximum, full personal
  transaction history, support chat (with photo/screenshot attachments) for
  when balance hits zero, and a simulated "Add Demo Credits" page.

### The demo credit supply chain

Credits originate in exactly one place: the owner mints them (`/wallet`,
owner only — a `owner_mint` ledger row created from nothing, fully audited).
Everyone else's balance is a `SUM(ledger)` of transfers received down the
chain: Owner → Developer/Admin/User, Developer → Admin/User, Admin → User.
Every transfer (`server/ledger.js#transferCredits`) is balance-checked
against the sender's real float — nobody can hand out more than they've
actually received, admins included. `/wallet` is the shared send/receive
page for every staff role; `server/routes/payments.js` enforces who may send
to whom (owner → anyone; developer → admin/user; admin → their own assigned
players only).

### Fake payment gateway

Each admin/developer has their own Payment Gateway page (`/gateway`) to
toggle Visa/Mastercard, PayPal, Apple Pay, and Google Pay on or off, with a
fake merchant-ID/API-key field and a status note. **Nothing here is real** —
no card network, PayPal, Apple Pay, or Google Pay is ever contacted; every
credential is an obviously-fake placeholder string, and there is no card-
number entry form anywhere (so nothing here could be mistaken for or reused
as a real payment-collection form). A player only sees the methods their
*assigned* admin currently has enabled; picking one on `/account/topup` is
a simulated instant transfer from that admin's float to the player's balance
— same `transferCredits()` mechanic, tagged `fake_payment` in the ledger for
clarity. Developers cannot edit an admin's gateway (only that admin or the
owner can); the owner can edit anyone's via `/gateway?staffId=ADMIN01`.

Every spin is resolved server-side (`server/engineBridge.js`, which imports
`core/` and `models/` **unmodified** and replicates the exact control flow of
`modelA.playRound` / `modelB.playRound`) inside one SQLite transaction that
writes the stake and any win as immutable ledger rows. The client only
animates a result the server already committed. Bets scale every payout
proportionally to the engine's tuned 30-credit reference bet, with each
individual credit figure rounded at the moment it's emitted (not the round
total) so what's displayed always sums to exactly what's written to the
ledger — at very small bets the smallest reference-scale pays can round down
to 0, the same way a real machine behaves below its usual denomination.

Public site vs. owner dashboard: the marketing site explains how the games
work and what they pay, but never shows RTP, hit rate, volatility, or the
validation reports — that's operator information, kept on `/owner` only.

## Stack

- Node.js + Express, EJS views, no front-end framework
- `node:sqlite` (Node's built-in driver — zero native dependencies, zero
  build step)
- `bcryptjs` + `jsonwebtoken` (httpOnly cookie sessions), `ws` for chat,
  `multer` for chat image/screenshot uploads (`data/uploads/chat/`, served through an authenticated route,
  random filenames, image-type/size validated)
- Procedural WebAudio sound engine (`public/js/audio.js`) — every sound,
  including the tiered win jingles, is synthesized at runtime; there are no
  audio files in the project
- Procedural art engine (`public/js/art.js`) — every symbol is layered
  vector shapes with an auto-applied light-to-dark gradient, a shared drop
  shadow, and hand-placed specular highlights on the rounder/metallic icons;
  no raster images anywhere

## Running it

```
cd app
npm install
npm run build:reeldata   # regenerate public/js/reeldata.js from the real strips (run after any model change)
npm run seed             # creates the first owner account (prints credentials)
npm run test:ledger      # proves balance == SUM(ledger) under load, no negative balances
npm start                # http://localhost:3000
```

Set `WGC_OWNER_EMAIL` / `WGC_OWNER_PASSWORD` before `npm run seed` to choose
the first owner's credentials instead of the printed default. Set
`WGC_JWT_SECRET` in production — the fallback in `server/auth.js` is a
dev-only placeholder.

## Ledger integrity

`server/test_ledger_integrity.js` is the executable proof of the
non-negotiable rule: balance is always `SUM(ledger.amount)`, spins that would
go negative are rejected with zero partial writes, and admin adjustments
always require a reason and record the admin's ID. Run it any time with
`npm run test:ledger` — it uses an in-memory database and never touches real
data.

## What's deliberately not here

Real payment processing, real KYC/AML, real withdrawal logic, real-money
wagering of any kind. The Payment Gateway pages and "Add Demo Credits" flow
look and function like a real payment system (methods can be toggled,
credentials edited, purchases made) but are entirely simulated — grep the
codebase for `fake_payment` / `FAKE_CREDENTIAL_PLACEHOLDER` and you'll find
no card network, PayPal, Apple Pay, or Google Pay SDK, API client, or
credential anywhere. If real processing is ever needed, it's a separate
integration against a licensed operator's payment/KYC/RNG-certification
stack — a business and legal undertaking that has to precede any code.
