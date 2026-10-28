# Implementation Plan

| Stage | Objective | Main modules | Acceptance / tests |
|---|---|---|---|
| 1 | Discovery and plan | `docs/*` | Docs exist |
| 2 | Foundation | Workspaces, tsconfig, env validation (zod), logger (pino + redaction), error handler, `/api/v1/health`, Mongo replset dev runner | `npm run typecheck`, health test passes |
| 3 | Shared domain | Pricing, coupons, state machine, dietary guard, ETA, craving parser | Vitest unit tests |
| 4 | Auth and RBAC | Users, auth, CSRF, `requireRole`, resource ownership | Supertest: 401/403, cross-user access denied |
| 5 | Discovery | Restaurants, menus, zones, serviceability, search, seed | Integration tests and UI screens |
| 6 | Cart, checkout, payments | Quote, coupons, orders, payment provider (mock and Stripe), webhooks, refunds | Duplicate webhook, bad signature, price change, payment failure |
| 7 | Restaurant ops | Order queue, menu CRUD, analytics | Accept/reject transitions and authorisation |
| 8 | Delivery and tracking | Assignments, location sockets, ETA, map | Partner-only updates, stale handling |
| 9 | Notifications and admin | Outbox dispatcher, Twilio and mock providers, admin screens, audit log | Retry on failure; admin actions audited |
| 10 | Hardening | Lint, a11y pass, Playwright E2E happy path, README | All checks green or documented |

**Main risks:**
- No local MongoDB. Mitigated with `mongodb-memory-server`.
- Stripe India eligibility. Mitigated with the provider interface and the mock adapter.
- No Maps or Twilio keys. Mitigated with labelled fallbacks and the mock provider.
