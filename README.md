# Tadka — honest food delivery (MERN MVP)

An India-first food delivery marketplace with four role-specific apps: customer, restaurant, delivery partner and admin. It is built around three promises:

1. **Honest Price.** Every restaurant card shows the estimated *all-in* cost for two. The bill itemises every fee with a reason. A server-checked price lock means the total can never silently change between the cart and payment.
2. **Explained ETA ranges.** Arrival is shown as a window (for example 7:42–7:55 pm) with a confidence level and the reason for the last change. It is recalculated from real order events and the partner's live GPS.
3. **Dietary Guard.** Veg, eggetarian, Jain and vegan profiles plus allergens. The server enforces them, including add-ons that change a dish's diet.

Plus **craving search** ("spicy veg under 150") with "why this matches" reasons, and **commission transparency** for restaurants.

Product and engineering docs live in [`docs/`](docs): competitor analysis, PRD, innovation scorecard, architecture, API, design system, and [current status](docs/status.md).

## Stack

npm workspaces monorepo · **API**: Node 20+, Express 5, TypeScript, MongoDB/Mongoose (replica set), Zod, Socket.IO, pino · **Web**: React 19, Vite 6, Tailwind v4, TanStack Query, React Router 7, React Hook Form + Zod · **Shared**: pricing, coupons, order state machine, ETA, Dietary Guard and schemas, used by both sides · **Integrations** (behind interfaces with mock adapters): Stripe, Twilio, Google Maps.

```
apps/api         REST /api/v1 + Socket.IO, modular monolith (src/modules/*)
apps/web         SPA for all four roles (customer bundle excludes the dashboards)
packages/shared  domain logic + validation shared by API and web
docs/            research, PRD, architecture, API, design system, status
```

## Quick start (local, no external accounts needed)

Requires Node ≥ 20 (tested on 24) and npm ≥ 10.

```bash
git clone https://github.com/tan1sh-dev/Tadka.git && cd Tadka
npm install
cp .env.example .env          # dev defaults work as-is (mock payments/SMS, demo location on)

npm run dev:db                # terminal 1: local MongoDB replica set on :27017 (data in .data/mongo)
npm run seed                  # once: demo restaurants, menus, coupons, zone, accounts
npm run dev                   # terminal 2: API on :4000 + web on :5173
```

Open http://localhost:5173. **Demo accounts** are for development only; the password for all of them is `Tadka@2026`.

| Role | Email | Lands on |
|---|---|---|
| Customer | customer@tadka.dev | `/` |
| Restaurant owner | owner@tadka.dev (Kaveri Tiffin Room; `owner2`…`owner9` for the others) | `/partner/restaurant` |
| Delivery partner | rider@tadka.dev (approved), rider2@tadka.dev (pending) | `/partner/delivery` |
| Admin | admin@tadka.dev | `/admin` |

**Try the full loop.**
1. As the rider, go online.
2. As the customer, order from Kaveri Tiffin Room. It is the only demo kitchen open 24 h, so it always works.
3. Pay on the clearly labelled **test gateway**.
4. As the owner, accept, then mark the order preparing and ready.
5. As the rider, accept, pick up and start the trip, then enter the customer's OTP.

Use three browser profiles or windows. Without real GPS movement you can switch on **Demo route** in the rider app. The customer then sees a "Demo mode: simulated" label.

`npm run dev:db` uses `mongodb-memory-server`, which downloads a MongoDB binary (about 600 MB) on first run. If you already have MongoDB, Docker or Atlas, point `MONGODB_URI` at any **replica set**. Transactions are required. For Docker:
`docker run -d -p 27017:27017 mongo:7 --replSet rs0` followed by `docker exec <id> mongosh --eval "rs.initiate()"`.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | API (tsx watch) + Vite dev server with `/api` and `/socket.io` proxy |
| `npm run dev:db` | Persistent single-node replica set for development |
| `npm run seed` / `npm run seed -- --reset` | Seed demo data. It refuses to run in production or on a database containing non-demo users. |
| `npm run typecheck` | TypeScript across shared, API and web |
| `npm run lint` | ESLint (flat config, typescript-eslint, react-hooks) |
| `npm test` | Unit tests (shared) and API integration tests on an in-memory replica set |
| `npm run e2e` | Playwright end-to-end tests. Needs the dev stack running and seeded; they create real orders in the dev DB. Run `npx playwright install chromium` first. |
| `npm run build` | API bundle (`apps/api/dist`) and web bundle (`apps/web/dist`) |
| `npm start -w @tadka/api` | Run the built API. With `NODE_ENV=production` it also serves `apps/web/dist` on the same origin. |

## Configuration

See [`.env.example`](.env.example) for every variable. The app validates configuration at startup and exits with a clear message if anything is wrong. Production startup **refuses** the mock payment provider, a missing `JWT_SECRET`, and incomplete Stripe or Twilio credentials. Demo location is forced off.

### Stripe (payments)
1. Set `PAYMENT_PROVIDER=stripe`, `STRIPE_SECRET_KEY=sk_test_…`.
2. Forward webhooks locally with `stripe listen --forward-to localhost:4000/api/v1/payments/webhook/stripe`. Put the printed `whsec_…` in `STRIPE_WEBHOOK_SECRET`.
3. Subscribe the production endpoint to: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `refund.created`, `refund.updated`.

> ⚠️ **India eligibility.** Public sources (not verified against Stripe's own docs) report that Stripe India accounts are invite-only and lack domestic UPI. Confirm eligibility before launch. Payments sit behind `PaymentProvider` (`apps/api/src/modules/payments/payment.provider.ts`). A Razorpay or Cashfree adapter implements three methods: `createCheckout`, `verifyWebhook` and `refund`.

### Twilio (SMS)
1. Set `SMS_PROVIDER=twilio`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and either `TWILIO_FROM_NUMBER` or `TWILIO_MESSAGING_SERVICE_SID`.
2. Status callbacks go to `APP_BASE_URL/api/v1/notifications/twilio/status` and are signature-verified. `APP_BASE_URL` must be publicly reachable; use a tunnel in development.
3. Indian A2P SMS needs TRAI **DLT** registration of the sender and templates. Templates live in `notifications.service.ts → SMS_TEMPLATES`.

With `SMS_PROVIDER=mock` nothing is sent. Messages appear in **Admin → Operations → SMS outbox**. Numbers ending in `0000` fail deliberately so you can exercise the retry path.

### Google Maps
- **Browser key** `VITE_GOOGLE_MAPS_API_KEY`. Restrict it to your HTTP referrers and to Maps JavaScript API and Places API. It enables Places autocomplete and the live map.
- **Server key** `GOOGLE_MAPS_SERVER_KEY`. Restrict it by server IP and to Geocoding API and Routes API. It enables two-wheeler route times for ETAs.

Without keys, the app uses preset demo areas, the device's GPS, a haversine speed model, and a **schematic map labelled as such** that plots the real coordinates.

## Testing status

These were run on 2026-10-28; full results are in [docs/status.md](docs/status.md).

| Suite | Result |
|---|---|
| Shared unit tests (pricing, coupons, state machine, Dietary Guard, ETA, craving parser, IST hours) | 28 / 28 ✅ |
| API integration (auth, RBAC and resource access, CSRF, injection, quotes, idempotency, webhooks incl. duplicates, bad signature and amount mismatch, payment failure and retry, full lifecycle, refunds, SMS retry and opt-out, Socket.IO room isolation) | 31 / 31 ✅ |
| Playwright E2E (customer → restaurant → rider → OTP → review → admin; protected-route redirect) | 2 / 2 ✅ |
| Typecheck + ESLint | clean ✅ |

## Troubleshooting

- **`Transaction numbers are only allowed on a replica set member`.** Your MongoDB isn't a replica set. Use `npm run dev:db` or initiate one (see above).
- **`Security token missing or invalid` (403 CSRF).** Cookies are blocked or the page is stale. Reload; the app fetches a fresh token automatically.
- **"We're not in your area yet".** The demo zone covers about 10 km around Koramangala, Bengaluru. Pick one of the "Popular areas", or add a zone in Admin → Fees & zones.
- **The rider gets no offers.** The rider must be online, approved, free, and within 8 km of the restaurant, with a location fresher than 15 minutes. Offers expire after 60 s, and dispatch retries every 5 s.
- **First `npm test` is slow.** mongodb-memory-server is downloading MongoDB; later runs reuse the cached binary.
- **CI.** GitHub Actions (`.github/workflows/ci.yml`) runs typecheck, lint, unit and integration tests, and both builds on every push to `main` and on pull requests.
