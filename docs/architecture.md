# Architecture

## Shape

An npm-workspaces monorepo containing a **modular monolith** API and a single React SPA that hosts all four role experiences.

```
apps/api        Express 5 + TypeScript + Mongoose + Socket.IO
apps/web        React 19 + Vite + Tailwind v4 + TanStack Query + React Router
packages/shared Zod schemas, enums, order state machine, pricing, ETA, money utils
```

`packages/shared` is consumed as TypeScript source: Vite compiles it, `tsx` runs it in dev, and `tsup` bundles it into the API build. Pricing, coupon rules, the state machine and the dietary guard are written **once**. The web app uses them for instant previews and the API uses them as the source of truth.

## Key decisions

| Decision | Choice | Trade-off |
|---|---|---|
| Auth | JWT (HS256) in an `httpOnly`, `SameSite=Lax` cookie plus a double-submit CSRF token; `tokenVersion` on the user for revocation | Stateless and simple. Revoking a token needs a DB read per request, which we accept. |
| Password hashing | argon2id (`@node-rs/argon2`, prebuilt binaries) | — |
| Money | Integer paise everywhere | — |
| DB | MongoDB **replica set**, required for transactions. Dev and test use `mongodb-memory-server` replsets. | Production needs Atlas or a replset. |
| Payments | `PaymentProvider` interface with `stripe` and `mock` adapters. The mock adapter signs its events with HMAC and goes through the **same** webhook pipeline as Stripe. | Adding a Razorpay adapter later only means implementing 3 methods. |
| Webhook idempotency | `WebhookEvent` unique on `(provider, eventId)`; payment status is monotonic (terminal states never regress) | — |
| Order idempotency | `Idempotency-Key` header, unique on `(customerId, idempotencyKey)` | — |
| Side effects | Notifications are written **in the same transaction** as the state change (outbox pattern). A background dispatcher sends them with retries and dedupes on a unique `dedupeKey`. | Delivery is eventually consistent. |
| Real-time | Socket.IO, authenticated with the same JWT cookie; rooms are `order:<id>`, `restaurant:<id>`, `partner:<userId>`, `admin` | Single node. Scaling out needs the Redis adapter (deferred). |
| Maps | Google Maps JS (browser key), plus Geocoding and Routes (server key) when configured. Otherwise: haversine distance plus a speed model, and a schematic tracker clearly labelled as such. | — |
| SMS | `SmsProvider` interface with `twilio` and `mock` adapters. Mock records messages to the outbox without sending. | — |
| Location data | The latest location is stored on the assignment. History lives in `LocationUpdate` with a **24 h TTL**. Updates are accepted only from the assigned partner during an active delivery. | — |

## Order state machine (`packages/shared/src/orderState.ts`)

```
PAYMENT_PENDING ─pay ok→ CONFIRMED ─restaurant→ ACCEPTED → PREPARING → READY_FOR_PICKUP
      │  └pay fail→ PAYMENT_FAILED ─retry→ PAYMENT_PENDING                      │ partner
      └cancel→ CANCELLED                                                       PICKED_UP → OUT_FOR_DELIVERY → DELIVERED
CONFIRMED ─restaurant reject→ REJECTED (auto refund)      CONFIRMED ─customer cancel→ CANCELLED (auto refund)
ACCEPTED|PREPARING|READY ─admin→ CANCELLED (refund)
```

Each transition lists the actors allowed to trigger it (`customer`, `restaurant`, `delivery`, `admin`, `system`). `assertTransition()` is the only way to change `order.status`, and every change appends to `order.timeline`.

`refundStatus` (NONE, PENDING, PARTIAL, REFUNDED, FAILED) is orthogonal to `status`. The same applies to `supportStatus` and to the delivery assignment status (OFFERED, ACCEPTED, PICKED_UP, DELIVERED, DECLINED, CANCELLED, REASSIGNED).

## Atomic vs eventual

- **Atomic (in one transaction):** order status change, timeline entry, payment status update, outbox notifications, webhook-event record, coupon usage increment.
- **Eventual:** SMS dispatch (retried with backoff, up to 5 attempts), socket broadcasts (sent after commit; clients also refetch on reconnect), delivery assignment offers (retried every 20 s by the dispatcher job), and refunds at the provider (the `Refund` record moves PROCESSING → SUCCEEDED or FAILED from the webhook or the API response).

## Scaling (deliberately deferred)

Redis for the Socket.IO adapter and rate limits, a queue in place of the polling outbox, CDN image hosting, multi-region deployment, and a search engine. The current code keeps each of these behind a module boundary.
