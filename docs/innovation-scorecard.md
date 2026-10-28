# Innovation Scorecard

Each candidate is scored 1–5 on seven criteria. For **Cost**, **OpsCx** (operational complexity) and **Risk** (data/privacy risk), a higher score means *lower* cost or risk, so a higher total is always better.

| # | Idea | Value | Differ. | Feasib. | Cost | Revenue/Retention | OpsCx | Risk | **Total** |
|---|---|---|---|---|---|---|---|---|---|
| 1 | **Honest Price**: all-in cost on cards + price lock | 5 | 4 | 5 | 4 | 4 | 5 | 5 | **32** |
| 2 | **Explained ETA ranges** (event-driven) | 4 | 4 | 4 | 4 | 4 | 4 | 5 | **29** |
| 3 | **Dietary Guard** (server-enforced profile) | 5 | 5 | 4 | 4 | 4 | 4 | 4 | **30** |
| 4 | **Craving search + "why this matches"** | 4 | 4 | 4 | 3 | 4 | 4 | 4 | **27** |
| 5 | Rescue meals (merchant end-of-day discounts) | 3 | 4 | 4 | 3 | 3 | 3 | 5 | 25 |
| 6 | Group ordering with split selections | 4 | 3 | 3 | 2 | 4 | 3 | 4 | 23 |
| 7 | Budget meal bundles | 3 | 3 | 3 | 3 | 3 | 3 | 5 | 23 |
| 8 | Scheduled / recurring orders | 4 | 2 | 3 | 3 | 4 | 2 | 5 | 23 |
| 9 | Reduced-packaging opt-in | 3 | 3 | 5 | 5 | 2 | 4 | 5 | 27 |
| 10 | Local-gem discovery boost | 3 | 3 | 4 | 4 | 3 | 4 | 5 | 26 |
| 11 | Commission-transparency payouts for restaurants | 4 | 4 | 4 | 4 | 3 | 4 | 5 | 28 |
| 12 | Regional-language UI (Hindi first) | 4 | 2 | 3 | 2 | 3 | 3 | 5 | 22 |
| 13 | Batched delivery / route optimisation | 3 | 2 | 2 | 1 | 3 | 1 | 4 | 16 |
| 14 | Demand forecasting for merchants | 3 | 3 | 2 | 2 | 3 | 3 | 4 | 20 |

## MVP selection

1. **Honest Price**
   - **Problem:** Fees appear late; the platform fee is up roughly 8× since 2023.
   - **User:** Price-sensitive customers.
   - **Journey:** A card shows "≈ ₹X all-in for two". The cart shows the full breakdown, which the server re-quotes. The quote carries a `quoteHash`. If the server total changes at checkout, the order is rejected with a diff (`PRICE_CHANGED`) rather than silently charged.
   - **Backend/frontend:** A shared `computeQuote()` runs on both sides; the server's result is authoritative.
   - **Data:** Platform config and restaurant fees.
   - **Failure modes:** The price changed, or the coupon expired, in which case the user is shown the new total.
   - **Metric:** Cart-to-paid conversion and the share of support tickets tagged "unexpected charge".
   - **Why better:** No surprises, and every fee is explained.
2. **Dietary Guard**
   - **Problem:** Restrictions such as Jain, vegetarian, egg-free or allergies can't be enforced.
   - **User:** Customers with dietary needs (a large segment in India).
   - **Journey:** Set the profile. Menus mark conflicting items with the reason. The server returns `DIETARY_CONFLICT` when such an item reaches cart quote or order creation.
   - **Data:** Merchant-declared diet and allergen fields, with a disclaimer.
   - **Failure modes:** Missing or incorrect merchant data. The UI says "declared by restaurant".
   - **Metric:** Orders by guarded users, and complaints about a wrong-diet item.
   - **Why better:** Recommendations can never override the restriction.
3. **Explained ETA ranges**
   - **Problem:** Single-number ETAs are false precision.
   - **Journey:** The tracking page shows a range plus the reason for the last change (accepted, ready, picked up, location update).
   - **Backend:** `estimateEta()` combines restaurant prep history and distance with a speed model (the Google Routes API when configured). It is recalculated on each order event.
   - **Failure modes:** No location data, in which case the range widens and is labelled.
   - **Metric:** ETA accuracy, i.e. the percentage of deliveries that land inside the range.
4. **Craving search with explanations**
   - **Problem:** Filters don't match how people think ("something light", "biryani under 300").
   - **Journey:** A free-text query is parsed into tags, a budget and a diet. Results carry "why" chips.
   - **Backend:** A deterministic parser plus a MongoDB text/tag match, with no ML dependency.
   - **Failure modes:** Unparseable query, which falls back to keyword search.
   - **Metric:** Search-to-menu-view conversion.

**Also in the MVP (cheap):** #11, commission transparency in restaurant analytics.

## Post-MVP backlog

Rescue meals, reduced-packaging opt-in, group ordering, scheduled orders, budget bundles, Hindi UI, local-gem boost, merchant forecasting, batching and routing, UPI via an eligible provider, and a native delivery app.
