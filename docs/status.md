# Status report: 2026-10-28

## Verification actually run

| Command | Result |
|---|---|
| `npm run typecheck` (shared, api, web) | ✅ exit 0 |
| `npm run lint` | ✅ 0 errors, 0 warnings |
| `npm test`: shared unit tests | ✅ 28 / 28 |
| `npm test`: API integration (in-memory MongoDB 7 replica set) | ✅ 31 / 31 |
| `npx playwright test` (Chromium, against the dev stack with seeded data) | ✅ 2 / 2 |
| `npm run build` and starting `dist/server.js` (`/health` → 200) | ✅ |
| Manual visual check (Playwright screenshots, 1366 px and 390 px): home, search, restaurant | ✅ no console errors |

## Definition of Done

**Status key**
- ✅ done and tested
- 🟡 implemented, but awaiting credentials or only partially covered
- ⬜ not done

| Item | Status | Notes |
|---|---|---|
| Register, login, browse, menus | ✅ | Integration and E2E |
| Search, filters, cart, customisation | ✅ | Craving parser unit-tested; customisation in E2E |
| Server-validated prices and promotions | ✅ | Client price fields ignored (test); `PRICE_CHANGED` lock |
| Test checkout via configured provider or test adapter | ✅ / 🟡 | Mock adapter goes through the real webhook pipeline. Stripe adapter is written but **not run against Stripe** (no keys) |
| Webhooks verified and idempotent | ✅ | Bad signature, duplicate event, stale event, amount mismatch, late payment after cancel |
| Restaurants manage menus and orders | ✅ | |
| Partners manage deliveries | ✅ | Offer, accept, pickup, start, OTP delivery |
| Validated order transitions | ✅ | Shared state machine; invalid jumps return 409 |
| Tracking uses authorised location | ✅ | Assigned partner only; staleness, accuracy, speed and timestamp checks; room isolation tested over Socket.IO. Demo route is labelled on both sides and forced off in production |
| Maps fallback states | ✅ / 🟡 | Schematic fallback verified. **Google Maps, Places and Routes code paths are untested without keys** |
| Twilio integrated or mocked and tested | ✅ / 🟡 | Outbox, dedupe, retries, opt-out and admin retry tested with the mock. Twilio adapter and signed status callback are **not exercised against Twilio** |
| Admin core tasks | ✅ | Approvals, orders, cancel, reassign, refunds, coupons, zones, fees, reviews, outbox, payouts, audit |
| RBAC and resource-level access tested | ✅ | |
| Responsive and accessible core screens | ✅ / 🟡 | Mobile-first and keyboard-reachable with ARIA patterns; **no screen-reader audit or axe run yet** |
| Setup docs, no secrets committed | ✅ | `.env` is gitignored; `.env.example` only |
| ≥ 3 differentiated features end to end | ✅ | Honest Price, Dietary Guard, Explained ETA, craving search with "why" (+ commission transparency) |

## Known limitations / next steps

1. **Payments in India.**
   - Verify Stripe India eligibility, or add a Razorpay adapter with UPI behind `PaymentProvider`.
   - Run the Stripe test-mode flow with `stripe listen`.
2. **Image uploads.** Images are https URLs only; there is no file storage. Add S3 or R2 signed uploads with type and size validation.
3. **Masked calling.** Partner and customer see each other's numbers only during an active delivery. Use a telephony proxy (e.g. Exotel) in production.
4. **Scaling.** Socket.IO and rate limits are single-node. Add the Redis adapter and store before running more than one API instance. The outbox and dispatch run as polling jobs in-process; move them to a worker for scale.
5. **Performance.** The main web chunk is 263 KB gzipped. Split lucide and socket.io-client from the customer entry, and add image CDN and caching for discovery.
6. **Accessibility.** Run axe and a screen-reader pass. Dark theme is not implemented.
7. **Compliance** needs professional review: DPDP Act consent and deletion flows, FSSAI verification process, GST treatment, TRAI DLT SMS templates, and gig-worker welfare levies.
8. **Product backlog:** group ordering, scheduled orders, rescue meals, Hindi and Kannada UI, native partner app, smarter dispatch.

## Deliberate MVP decisions

- **Coupons are platform-funded.** Restaurant payouts are calculated on the item total before any discount.
- **Partner earnings** are ₹25 plus ₹8 per km (restaurant → customer), shown before the partner accepts.
- **Restaurant response time.** A restaurant that doesn't respond within 10 minutes is auto-rejected and the customer is refunded.
- **Unpaid orders** are cancelled after 1 hour.
- **Empty opening hours** mean "open 24 h".
