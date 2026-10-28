# Competitor Analysis — Zomato & Swiggy (food delivery)

_Last updated: 2026-10-27_

## Evidence and limitations

| Source | What was possible | Status |
|---|---|---|
| swiggy.com (live fetch) | Page is client-rendered; the fetch returned no content | **Not verified live** |
| zomato.com/…/delivery (live fetch) | Request timed out | **Not verified live** |
| News coverage (2023–2026) | Platform-fee history, commission disputes, gig-worker regulation | Verified via cited articles |
| General public product knowledge | Widely documented consumer workflows (location → discover → menu → cart → pay → track) | **Hypothesis-grade**: observed behaviour, may have changed |

We did not access private APIs, bypass bot protection, or reuse any branding or assets. Nothing below claims knowledge of competitor internals.

### Verified market facts (with sources)

- **Platform fees keep rising.** Both platforms started a per-order platform fee of about ₹2 in 2023. In March 2026, Zomato raised it to ₹14.90 before GST and Swiggy to ₹17.58 including GST. This fee is separate from delivery and restaurant charges. ([Outlook Business](https://www.outlookbusiness.com/corporate/swiggy-platform-fee-hike-brings-it-on-par-with-zomato-charges), [5paisa](https://www.5paisa.com/news/swiggy-raises-platform-fee-by-17-to-rs1758-per-order-matches-zomato-pricing), [IANS](https://ianslive.in/swiggy-hikes-platform-fee-by-17-pc-to-rs-1758-per-order--20260324114713))
- **Restaurant commissions are contested.** NRAI told the CCI in 2021 that commissions were 25–35% of order value. The CCI opened a probe in 2022, and the DG report followed in 2024. We found no final order in our sources. ([Tribune](https://www.tribuneindia.com/news/business/competition-commission-probe-finds-zomato-swiggy-violating-competition-norms/), [The News Minute](https://thenewsminute.com/money/restaurants-association-approaches-competition-commission-against-zomato-swiggy-151825))
- **Delivery-partner welfare is now regulated.** Karnataka's Platform Based Gig Workers Act, 2025 adds a welfare fee on aggregators. The central Code on Social Security requires contributions of 1–2% of turnover; reported implementation dates differ between sources. ([India Code](https://www.indiacode.nic.in/handle/123456789/22201), [TechCrunch](https://techcrunch.com/2025/11/24/indias-gig-workers-win-legal-status-but-access-to-social-security-remains-elusive), [Storyboard18](https://www.storyboard18.com/amp/how-it-works/indias-labour-reforms-zepto-swiggy-eternal-among-platforms-to-pay-1-2-of-turnover-for-gig-workers-welfare-84622.htm))
- **Stripe India is limited.** Several secondary sources say Stripe India has been invite-only since 2024 and does not support domestic UPI. This conflicts with other sources and is **not confirmed against Stripe's own documentation**. ([EximPe](https://eximpe.com/blog/psp/stripe-for-india-what-works-what-doesnt-and-where-global-merchants-lose-indian-customers), [Mewayz](https://mewayz.com/blog/stripe-vs-razorpay-india-2026)) → **Design consequence:** payments sit behind a `PaymentProvider` interface, so a Razorpay or Cashfree adapter can be added.

## Competitor matrix

| Area | Existing approach (observed / reported) | Customer pain point | Opportunity | Proposed improvement (Tadka) |
|---|---|---|---|---|
| Fees | Item prices on menu; platform, delivery, packaging, small-cart and GST appear in cart/bill details | Total is unclear until late; platform fee up roughly 8× since 2023 | Show the real cost early | **Honest Price**: estimated all-in cost on every restaurant card, one shared pricing engine, and a server-issued price lock between cart and payment |
| Delivery time | Single-number ETA ("30 min") on cards | One number implies precision; delays go unexplained | Communicate uncertainty | **Explained ETA ranges** ("28–36 min"), recalculated on real events with a visible reason |
| Discovery | Cuisine tiles, filters (rating, veg, offers), promoted listings | Filter fatigue; hard to say what you actually want | Intent-based search | **Craving search** ("something spicy under ₹300") with "why this matches" chips |
| Dietary needs | Veg toggle; item veg/non-veg marks | Jain, egg-free and allergen needs can't be enforced; an accidental add is easy | Make restrictions binding | **Dietary Guard**: profile-level rules enforced on the server at cart and order time |
| Ads | "Promoted" or "Ad" labels on some listings | Ranking incentives aren't visible | Clear disclosure | Every sponsored slot is labelled; it never changes the "why" ranking |
| Tracking | Map with partner pin, status steps | Stale pins aren't flagged | Show data freshness | "Last updated 40 s ago" and stale-location banners |
| Refunds/support | Chat bot, then agent | Slow and opaque | Visible refund state | Refund request with status timeline; admin audit trail |
| Restaurant tools | Partner app with orders, menu and payouts | Commission opacity | Transparent payout math | Per-order commission breakdown in restaurant analytics |
| Delivery partner | Assignment offers, earnings | Pressure from very short delivery promises | Fairer workflows | No 10-minute promises; earnings shown per delivery (base + distance) |
| Ops/admin | Not publicly observable | — | — | Audit logs, a notification outbox, and configurable fees and zones |
