# Product Requirements: Tadka (MVP)

Tadka is an India-first food delivery marketplace. Its position is **"honest food delivery"**: the full price up front, ETAs given as ranges with reasons, and dietary rules that are actually enforced.

## Users and jobs

| Role | Core jobs |
|---|---|
| Customer | Find food that fits taste, diet and budget; pay a predictable total; know when it arrives |
| Restaurant owner | Keep the menu and availability accurate; process orders quickly; understand payouts |
| Delivery partner | Go online, accept deliveries, navigate, prove delivery, see earnings |
| Admin | Approve supply, monitor orders, resolve refunds, configure fees, zones and coupons, audit actions |

## Functional scope (MVP)

**Customer**
- Register/login (email + password, Indian mobile number).
- Profile, saved addresses (house, locality, landmark, PIN) and a serviceability check.
- Discovery: cuisines, collections, filters (veg, rating, cost, ETA, open now), sort options, and craving search.
- Restaurant page with menu search, category navigation and customisation (variants and add-ons).
- Single-restaurant cart and a server quote; coupons; full fee breakdown.
- Checkout, then payment (Stripe Checkout or a mock gateway), then order tracking (timeline, map, ETA range).
- Order history, reviews, cancellation before acceptance, and refund requests.

**Restaurant**
- Onboarding, which leaves the restaurant PENDING until admin approval.
- Profile, opening hours and a temporary pause.
- Menu category and item CRUD with availability.
- Live order queue (Socket.IO) with accept or reject and status updates.
- History and analytics: GMV, orders, popular items, and commission breakdown.

**Delivery partner**
- Registration with admin approval; online/offline toggle.
- Offers: accept or decline. Pickup, then drop with a delivery OTP.
- Location sharing only while on an active delivery, plus navigation deep links.
- History and earnings.

**Admin**
- Users and roles; approve or suspend restaurants and partners.
- Order monitor, refunds, coupons, service zones and platform fee config.
- Review moderation, audit log, notification outbox and metrics.

## Non-functional requirements

- Money is stored as integer **paise**, the server is authoritative on totals, and orders store immutable snapshots.
- Security: argon2id hashing, httpOnly JWT cookie, double-submit CSRF, role and resource authorisation, rate limits, helmet, and mongo-sanitize.
- Accessibility: keyboard reachable, visible focus, contrast AA, form errors announced.
- Responsive from 360 px up.
- Timestamps stored in UTC and shown in IST (`Asia/Kolkata`).
- i18n readiness: all UI copy is centralised per feature, and dates and currency use `Intl`.

## Compliance notes (need professional review; not claimed as compliant)

- **DPDP Act 2023:** consent, purpose limitation, and deletion requests for addresses, phone numbers and location.
- **FSSAI:** restaurants must hold a licence. We collect the licence number at onboarding and admins verify it manually.
- **GST:** 5% on restaurant food via the e-commerce operator, 18% on platform and delivery fees. These rates are configurable and must be confirmed by a tax advisor.
- **SMS:** TRAI DLT registration of sender ID and templates is required for Indian SMS.
- **Gig-worker welfare fees** (Karnataka Act 2025, Social Security Code) may apply to the operator.

## Out of scope (MVP)

Native apps, multi-city ops tooling, group or scheduled orders, real KYC, file uploads (images are https URLs), and UPI (pending an eligible gateway).
