### hello

# API reference (v1)

Base path: `/api/v1`. All responses are JSON, and errors use one envelope:

```json
{ "error": { "code": "PRICE_CHANGED", "message": "human readable", "details": {}, "requestId": "uuid" } }
```

**Status codes**
- 400 `VALIDATION_ERROR` (with `details.fieldErrors`) and 401 `UNAUTHORIZED`.
- 403 `FORBIDDEN` / `CSRF`.
- 404 `NOT_FOUND`. This is also returned for other users' resources, so their existence is never confirmed.
- 409 `INVALID_TRANSITION`, `PRICE_CHANGED`, `DUPLICATE` and similar.
- 422 business blockers: `DIETARY_CONFLICT`, `NOT_SERVICEABLE`, `OTP_MISMATCH`.
- 429 `RATE_LIMITED`.
- 502 `PAYMENT_PROVIDER_ERROR`.

Every response carries `x-request-id`; send your own to correlate requests.

**Auth.** Sessions use the httpOnly cookie `tadka_session` (JWT HS256, 7 days, revocable via `tokenVersion`).

**CSRF.** Every non-GET request must send header `x-csrf-token` equal to cookie `tadka_csrf`. Get one from `GET /auth/csrf`.

**Rate limits.**

| Scope | Limit |
|---|---|
| Auth | 20 per 15 min |
| Search | 90 per min |
| Location | 60 per min |
| Global | 600 per min |

Money is always integer **paise**.

## Public / customer

| Method & path | Auth | Purpose |
|---|---|---|
| GET `/health`, GET `/meta` | – | Health (DB state); active providers (payments, SMS, maps, demo location) |
| GET `/auth/csrf` | – | Issue CSRF cookie |
| POST `/auth/register` `{name,email,phone,password,role?:customer\|restaurant\|delivery,smsOptIn}` | – | Create an account and session (admins cannot self-register) |
| POST `/auth/login`, `/auth/logout`, `/auth/logout-all`; GET `/auth/me` | – / session | Session management |
| PATCH `/users/me` `{name?,phone?,smsOptIn?,dietary?}` | session | Profile and Dietary Guard |
| GET/POST `/addresses`, PUT/DELETE `/addresses/:id` | session | Saved addresses (owner-scoped). Each includes `serviceable` |
| GET `/serviceability?lat&lng` | – | Is the point inside an active zone? |
| GET `/restaurants?lat&lng&q&cuisine&veg&minRating&maxEta&maxCostForTwo&sort&page` | optional | Discovery and craving search. Returns cards with `allInForTwo`, `eta`, `why[]`, `matchedItems[]`, a separate `sponsored`, and `understood[]` |
| GET `/restaurants/cuisines` | – | Cuisine list |
| GET `/restaurants/:slug?lat&lng` | optional | Restaurant, fee schedule, menu with per-item `dietary` check, reviews |
| GET `/promotions` | – | Currently valid coupons |
| POST `/carts/quote` `{restaurantId, lines[], addressId? \| location?, couponCode?}` | optional | Server quote: `quote.breakdown[]`, `blockers[]`, `couponError`, `canOrder` |
| POST `/orders` + header `Idempotency-Key` `{…quote, addressId, expectedTotal, instructions}` | customer | Create a PAYMENT_PENDING order and payment attempt. Returns `payment.checkoutUrl`. A replay with the same key returns the same order |
| GET `/orders?page` · GET `/orders/:id` | customer · any party to the order | History; role-appropriate view (least privilege per viewer) |
| POST `/orders/:id/cancel` `{reason}` | customer | Allowed only before the restaurant accepts. Refunds automatically if paid |
| POST `/orders/:id/payment/retry` | customer | New payment attempt after a failure |
| POST `/orders/:id/review` `{foodRating, deliveryRating?, comment}` | customer | One review per delivered order |
| POST `/orders/:id/refund-requests` `{reason, details, amount?}`; GET `/orders/:id/refunds` | customer | Refund requests and their status |
| GET `/payments/:id` | customer (owner) | Payment status |
| POST `/payments/mock/:id/simulate` `{outcome}` | customer (owner), **dev only** | Emits a signed mock provider event through the webhook pipeline |
| POST `/payments/webhook/:provider` | provider signature | Stripe or mock webhooks (raw body; no cookie or CSRF) |
| POST `/notifications/twilio/status` | Twilio signature | SMS delivery-status callbacks |
| POST `/geo/geocode` `{address}` | – | Server geocoding. Returns 503 if Maps isn't configured |

## Restaurant (`role=restaurant`), prefix `/merchant`

| Method & path | Purpose |
|---|---|
| POST, GET, PUT `/restaurant` | Onboard (lands in PENDING approval), view, edit |
| POST `/restaurant/pause` `{paused}` | Temporary closure |
| GET `/menu` | Categories and items |
| POST `/categories`; PUT, DELETE `/categories/:id` | Category management |
| POST `/items`; PUT, DELETE `/items/:id`; PATCH `/items/:id/availability` | Dish management |
| GET `/orders?view=active\|history` | Order queue or history |
| POST `/orders/:id/status` `{to: ACCEPTED\|REJECTED\|PREPARING\|READY_FOR_PICKUP, reason}` | Advance an order. Rejection requires a reason and refunds the customer automatically |
| GET `/analytics?days` | Orders, acceptance rate, average prep time, top items, daily series, commission breakdown |
| GET `/payouts` | Payout statements |

## Delivery partner (`role=delivery`), prefix `/delivery`

| Method & path | Purpose |
|---|---|
| GET `/me` | Profile, live offers (with estimated earnings), active delivery |
| PATCH `/me` `{vehicle, vehicleNumber}` | Update vehicle details |
| POST `/availability` `{online, location?}` | Going online requires a location |
| POST `/heartbeat` `{lat,lng}` | Idle dispatch position (no history kept) |
| POST `/offers/:orderId/accept\|decline` | Respond to an offer. Accepting checks atomically that the partner is free and the offer is still valid |
| POST `/orders/:orderId/pickup\|start\|deliver` `{otp}` | Delivery steps |
| POST `/location` | REST fallback for location (Socket.IO is primary) |
| GET `/history` | Deliveries and earnings |

## Admin (`role=admin`), prefix `/admin`

Every mutating route writes an `AuditLog` entry with the actor, the change and the IP address.

| Method & path | Purpose |
|---|---|
| GET `/metrics` | Operational metrics |
| GET `/users?role&q`; PATCH `/users/:id` `{status?, role?}` | User management. Any change revokes the user's sessions |
| GET `/restaurants?approval`; POST `/restaurants/:id/approval`; PATCH `/restaurants/:id` `{sponsored, commissionBps}` | Restaurant approval and settings |
| GET `/partners?approval`; POST `/partners/:userId/approval` | Partner approval |
| GET `/orders?status&q`; GET `/orders/:id` | Order monitoring, with payments, refunds, notifications and audit trail |
| POST `/orders/:id/cancel` `{reason}`; POST `/orders/:id/reassign` | Cancel (refunds if paid) or reassign the delivery |
| GET `/refunds?status`; POST `/refunds/:id/approve\|reject\|retry` `{amount?, note}` | Refund administration |
| GET/POST `/coupons`, PUT `/coupons/:id` | Promotions |
| GET/POST `/zones`, PUT `/zones/:id` | Service zones |
| GET/PUT `/config/pricing` | Fee configuration |
| GET `/reviews`, PATCH `/reviews/:id` `{hidden, reason}` | Review moderation. The restaurant rating is recomputed on change |
| GET `/notifications?status`, POST `/notifications/:id/retry` | SMS outbox |
| GET `/audit` | Audit log |
| POST `/payouts/generate` `{periodStart, periodEnd}` (idempotent per restaurant and period); GET `/payouts`; POST `/payouts/:id/mark-paid` | Payouts |

## Order state machine

The state machine is defined in `packages/shared/src/orderState.ts`; see [architecture.md](architecture.md).

| From → To | Allowed actors |
|---|---|
| PAYMENT_PENDING → CONFIRMED / PAYMENT_FAILED | system (verified webhook only) |
| PAYMENT_PENDING / PAYMENT_FAILED → CANCELLED | customer, admin, system (1 h timeout) |
| PAYMENT_FAILED → PAYMENT_PENDING | customer (retry) |
| CONFIRMED → ACCEPTED | restaurant |
| CONFIRMED → REJECTED | restaurant, system (10 min timeout) |
| CONFIRMED → CANCELLED | customer, admin |
| ACCEPTED → PREPARING → READY_FOR_PICKUP | restaurant |
| ACCEPTED / PREPARING / READY → CANCELLED | admin |
| READY_FOR_PICKUP → PICKED_UP → OUT_FOR_DELIVERY → DELIVERED | delivery (DELIVERED requires the customer's OTP) |

## Socket.IO

**Connecting.**
- Connect to the same origin at `/socket.io` with the session cookie; unauthenticated sockets are rejected (`unauthorized`).
- In production the handshake `Origin` must equal `WEB_ORIGIN`.

**Rooms joined automatically.**
- `user:<id>` for everyone.
- `restaurant:<restaurantId>` for owners.
- `partner:<userId>` for partners.
- `admin` for admins.

**Client → server**

| Event | Payload | Ack |
|---|---|---|
| `order:subscribe` | `{orderId}` | `{ok:true}` or `{ok:false,error:'not_found'}`. Uses the same access rule as `GET /orders/:id` |
| `order:unsubscribe` | `{orderId}` | – |
| `location:update` (partners only) | `{orderId, lat, lng, accuracy?, recordedAt(ms), source:'gps'\|'demo'}` | `{accepted:true}` or `{accepted:false, reason}` |

**Location update reasons.** `location:update` can be refused with these reasons:
- `forbidden`
- `invalid_payload`
- `demo_disabled`
- `stale_or_future_timestamp`: accepted window is −120 s … +30 s.
- `low_accuracy`: accuracy worse than 500 m.
- `not_assigned`: only the assigned partner during ACCEPTED or PICKED_UP.
- `throttled`: less than 2 s since the last update.
- `implausible_jump`: faster than 120 km/h.

**Server → client**

| Event | Payload | Sent to |
|---|---|---|
| `order:updated` | `{orderId, status, eta, updatedAt}` | Change signal only; clients refetch their role's REST view. Sent to the order, restaurant, partner and admin rooms |
| `order:new` | `{orderId, orderNumber}` | Restaurant room |
| `order:location` | `{orderId, lat, lng, accuracy, at, source, eta}` | Order room only |
| `delivery:offer` | `{orderId, expiresAt}` | Partner room |
| `delivery:cancelled` | `{orderId}` | Partner room |

**Reconnection and staleness.**
- On every `connect`, clients re-subscribe and refetch to fill any gap.
- The customer UI marks a location stale after 45 s without an update.
- Location breadcrumbs expire after 24 h (TTL index). Only the latest point is kept on the assignment, and it is shown only while the delivery is active.
