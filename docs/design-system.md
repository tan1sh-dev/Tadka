# Design system

The source of truth is `apps/web/src/index.css` (Tailwind v4 `@theme` tokens) plus `apps/web/src/components/ui/index.tsx`.

## Identity

A warm "paper" canvas, ink-dark type, and a chilli-tadka brand red with a turmeric accent. Diet colours follow the Indian food-label convention:
- green square with a dot for **veg**;
- red-brown triangle for **non-veg**;
- amber for **egg**.

Restaurants without photos get deterministic, licence-free generated artwork (`FoodArt`). This avoids stock-photo licensing and keeps a consistent look.

## Tokens

| Group | Tokens |
|---|---|
| Surface | `paper #fbf7f0` (page) · `surface #fff` (cards) · `line` / `line-strong` (borders) |
| Text | `ink #1d1a16` · `ink-2` · `muted #6b6255` (≥ 4.5:1 on paper) |
| Brand | `brand-50…700` (500 = `#e2531d`, primary actions) · `turmeric-100/400/600` (highlights, "why" chips, demo labels) |
| Semantic | `leaf-*` (success, veg, online) · `chili-*` (error, non-veg, destructive) · `egg-600` |
| Type | Display: Bricolage Grotesque 700/800 · Body: Inter 400–700 · Numbers: `.num` (tabular figures) |
| Scale | 12 / 14 / 15 (inputs) / 17 (card titles) / 20 / 24 / 30 / 48 px |
| Radius | 8 (chips) · 12 (`rounded-xl`, inputs and buttons) · 16–24 (`rounded-2xl` / `rounded-3xl`, cards, hero, sheets) |
| Elevation | `--shadow-card` (resting) · `--shadow-pop` (hover, modals, toasts) |
| Spacing | Tailwind 4 px scale; page gutter 16 px (mobile) and 32 px (dashboards on desktop); max content width 1152 px |

## Breakpoints

Mobile-first.
- `sm` 640: 2-column grids, centred modals.
- `md` 768: header search, sidebar dashboards, bottom nav hidden.
- `lg` 1024: 3-column grids, sticky cart and bill.

## Components

`Button` (primary, secondary, ghost, danger and success × sm, md and lg; `loading`) · `Field` (label, hint, error wired with `aria-describedby`) · `Input`, `Select`, `Textarea` · `Toggle` (`role=switch`) · `Badge` · `Notice` (info, warn, error, success; `role=status` or `alert`) · `Modal` (native `<dialog>`: focus trap, Esc, bottom sheet on mobile) · `Skeleton`, `Spinner`, `EmptyState`, `ErrorState` (with retry) · `Toaster` · `Stat` · `PageHeader` · `DietMark` · `Rating`.

Domain components: `RestaurantCard`, `PriceBreakdown`, `OrderTimeline`, `TrackingMap` (Google or labelled schematic), `ItemCustomizer` (live Dietary Guard), `LocationPicker`, `AddressForm`, `FoodArt`.

## Patterns

- **Forms.** React Hook Form with the *shared* Zod schemas, so client and server validate with the same rules. Server field errors are mapped back onto fields, and any other error appears in a `Notice`.
- **States.** Every data view covers loading (skeleton or spinner), empty (`EmptyState` with a next action), error (`ErrorState` with retry) and success (toast).
- **Destructive or audited actions** go through a confirmation modal. Admin actions require a reason, which is stored in the audit log.
- **Honesty labels.** "Ad · Sponsored", "Demo restaurant", "Test payment gateway", "Demo mode: simulated route", and "Schematic view · Google Maps not configured".

## Accessibility

- Skip link and landmark regions.
- Visible `:focus-visible` ring (3 px brand).
- Every icon-only button has an `aria-label`.
- Toggles use `role=switch` and filters use `aria-pressed`.
- The live order status, ETA and location status use `aria-live`.
- Diet marks have text alternatives.
- `prefers-reduced-motion` disables animation.
- Touch targets are ≥ 40 px.

Known gaps: no full screen-reader audit has been done yet, and there is no dark theme.

## Copy & i18n

Copy is plain and specific: it says why a fee exists and why the ETA changed. Dates and times use `Intl` with `en-IN` and `Asia/Kolkata`, and money uses `Intl` INR formatting. Strings are colocated per feature. Extracting them to message catalogues for Hindi and Kannada is the first post-MVP i18n step.
