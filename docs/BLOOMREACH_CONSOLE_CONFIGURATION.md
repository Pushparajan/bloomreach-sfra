# Bloomreach Discovery Console Configuration Guide

**Audience:** Bloomreach account/implementation team, merchandising ops
**Scope:** what must be configured on **Bloomreach's own admin console / product feed**, as distinct from SFCC Business Manager (see `TECHNO_FUNCTIONAL_GUIDE.md` §8 for the SFCC-side setup). This integration cannot function correctly if the fields and settings below aren't present and named exactly as listed — every field name here is read verbatim by this cartridge's code, not just conventionally expected.

---

## 1. Account & Credentials

Bloomreach issues three values when your account/catalog/domain is provisioned. These get entered into SFCC as Site Preferences (`TECHNO_FUNCTIONAL_GUIDE.md` §8.1), never hardcoded:

| Value | SFCC Site Preference | Where it comes from |
|---|---|---|
| Account ID | `bloomreachAccountId` | Bloomreach account provisioning |
| Auth Key | `bloomreachAuthKey` | Bloomreach account provisioning — **treat as a secret**; this integration masks it in all logs, but it must also be handled as a secret in the Bloomreach console/account settings |
| Domain Key | `bloomreachDomainKey` | Identifies which catalog/domain within your account to query |

**API endpoint:** all calls hit the Bloomreach Discovery Product Search API base URL (e.g. `https://core.dxpapi.com/api/v1/core/`) with `account_id`/`auth_key`/`domain_key`/`request_id` on every request. Confirm the exact base URL for your account tier with your Bloomreach representative — it's entered once, in the SFCC Service definition (§8.2), not in this cartridge's code.

---

## 2. Identity Field Mapping (product feed)

The integration enforces a strict identity rule everywhere (`helpers/bloomreachIdentity.js`): a Bloomreach "product" is always an SFCC **Variation Group** (colorway-level), never a bare SKU or base product.

| Bloomreach response field | Must map to | Used for |
|---|---|---|
| `pid` | SFCC Variation Group ID | Every product identity in every response — PDP links, compare, chips, thematic pages |
| `sku` | SFCC Variation (sellable unit) ID | Read but never sent as a product identifier itself |

**Action required:** confirm with your Bloomreach implementation team that the product feed's primary identity field is mapped to `pid` at the Variation Group level (not the base/master product), and that `sku` carries the sellable-variant ID. If your feed uses different field names internally, they must be aliased to `pid`/`sku` in the response — this cartridge does not have a field-remapping layer; it reads these two names directly.

---

## 3. Response Fields (product feed)

Every feature (Boot Finder, Compare, Work Job Landing, Thematic Pages) reads these directly off each Bloomreach hit:

| Field | Type | Notes |
|---|---|---|
| `title` | String | Product display name |
| `thumb_image` | String (URL) | Tile/PDP-link thumbnail image URL |
| `price` | Number | Displayed as-is; no currency conversion in this integration |

**Action required:** confirm these three field names (not e.g. `name`, `image_url`, `sale_price`) are what the feed/response actually returns, or alias them at the Bloomreach feed-mapping layer.

---

## 4. Facet / Filter Attributes (product feed — must be filterable)

These attribute names are used verbatim in every `fq` (filter query) fragment this integration builds. **Each one must exist in your Bloomreach index as a filterable/facetable attribute** with these exact names:

| Attribute | Type | Used by | Example values |
|---|---|---|---|
| `job_type` | Multi-value string | Boot Finder, Work Job Landing, Thematic Pages | `electrical`, `construction`, `welding`, `agriculture`, `oil-gas`, `warehouse` |
| `Toe_Shape` | String | Boot Finder, Compare, Thematic Pages | e.g. `Composite`, `Steel`, `Alloy` — confirm exact values against your feed |
| `Safety_Toe` | String | Boot Finder, Compare | Toe protection type |
| `Shaft_Height` | String | Boot Finder (categorical mode) | Categorical height label |
| `shaft_height_in` | Number (range-filterable) | Boot Finder (numeric mode, feature-flagged) | Inches, used as a `[min TO max]` range filter |
| `safety_specs` | Multi-value string | Boot Finder, Thematic Pages (feature-flagged) | e.g. `EH`, `SD`, `PR` — confirm exact values against your feed |
| `feature_waterproof` | Boolean | Boot Finder (feature-flagged) | |
| `warmth_rating` | String | Boot Finder (feature-flagged) | Insulation level |
| `inventory_level` | Number | Inventory-bury rule (all attribute-query features) | Used in a range filter to deprioritize low stock, not hard-exclude. Products with no value still match, so an unpopulated field degrades to a no-op rather than emptying results — but the bury then does nothing, so confirm it is actually populated |

**Action required:** confirm every attribute above is (a) present and populated in the feed, (b) configured as filterable in Bloomreach's attribute/facet settings, and (c) confirm the *exact* value strings for `job_type`, `Toe_Shape`, and `safety_specs` — see `THEMATIC_PAGE_COMBINATIONS.md`, which depends on these being accurate.

Fields missing or unpopulated degrade the corresponding feature silently (fewer/no results for that filter) rather than erroring — there is no hard validation on the SFCC side that these exist in the index.

---

## 5. Ranking / Sort Fields (must be sortable)

| Field | Type | Used for | Source |
|---|---|---|---|
| `bvRating` | Number, sortable | Primary sort signal everywhere ranking applies | Bazaarvoice (or equivalent review platform) average rating, synced into the feed |
| `bvReviewCount` | Number, sortable | Secondary sort signal, only when `finderReviewCountBoostEnabled` is on | Bazaarvoice review count |
| `sales_rank_bucket` | Number, sortable | Tertiary tiebreak, only when `finderSalesRankTiebreakEnabled` is on; also drives the "Best Seller" tile badge (R-39) | Sales-velocity bucket from your merchandising/analytics system. **Confirm the scale** — the badge threshold assumes 1–10 where 10 is best |
| `cart_add_count` | Number | "In N+ Carts" tile badge (R-39) — **this field is an assumption, not confirmed to exist** | See §5.1 below |

Sort order used by this integration: `bvRating desc[, bvReviewCount desc][, sales_rank_bucket desc]` — configure these as numeric, sortable fields; no complex Bloomreach Sorting Rule object is assumed or required, since the sort is passed directly as a query parameter on every request.

### 5.1 `cart_add_count` — Action Required Before R-39 Badges Ship

The "In N+ Carts" tile badge (R-39, see `TECHNO_FUNCTIONAL_GUIDE.md` §5.7.2) reads a field named `cart_add_count` — a rolling add-to-cart velocity signal, modeled on the badge treatment already live on the storefront's category pages. **This field is an assumption made during implementation; it has not been confirmed to exist in your Bloomreach feed or index.**

Please confirm one of the following with the Bloomreach account team:
1. The field exists under this exact name and is populated → nothing to do.
2. It exists under a **different** name (e.g. a merchandising "trending"/velocity score) → tell the engineering team the real name; only `helpers/productBadgeBuilder.js` and the `CART_ADD_COUNT` entry in `bloomreachConstants.js` change.
3. No such signal is available → the badge is simply never emitted (the code omits it when the field is absent, rather than failing or fabricating a number). Confirm you're comfortable shipping without it.

The other two badges (`Top Rated`, `Best Seller`) rely only on `bvRating`/`bvReviewCount`/`sales_rank_bucket`, which are already confirmed fields — though `sales_rank_bucket`'s **scale** still needs confirming, since the Best Seller threshold assumes 1–10 with 10 best.

---

## 6. Request Types Actually Used

| Request shape | Used by | Notes |
|---|---|---|
| Attribute filter query (`fq`) | Boot Finder, Work Job Landing, Compare (ID lookup), Thematic Pages job | The vast majority of traffic |
| Keyword search (`q`) | Free-text Site Search (pre-existing, not part of this integration's custom features) | `helpers/bloomreachSearchHelper.js` scaffolds this shape but has no live caller in this codebase today — confirm with whichever team owns free-text search whether it's already wired elsewhere |
| Autosuggest (`request_type=suggest`) | Autocomplete | Same status as keyword search above — scaffolded, not currently invoked by any controller in this cartridge |

**Action required:** if free-text Search/Autosuggest already has a real Bloomreach integration elsewhere in your storefront codebase (outside this cartridge), confirm it uses the same account/domain, and note that this cartridge's `bloomreachSearchHelper.js` is not the thing actually serving those routes today.

---

## 7. 1:1 (Individual-Level) Personalization — `user_id` (R-38)

This integration can send `user_id` (the logged-in shopper's SFCC customer id) to Bloomreach for Boot Finder, Compare, and Work Job Landing's personalized-strip fragment — but **only when the SFCC-side flag `personalizationOneToOneEnabled` is turned on**, which itself requires two confirmations outside of engineering (see `TECHNO_FUNCTIONAL_GUIDE.md` §7.4):

1. **License tier:** confirm with your Bloomreach account team whether your current license/subscription includes **individual-level personalization** (distinct from segment/session-level personalization, which may already be included). This is very likely a **console/account-level entitlement Bloomreach must enable on their side**, not something togglable from the SFCC integration alone.
2. **Consent classification:** a privacy/legal sign-off for sending an identifier to Bloomreach for individual profiling — distinct from any existing analytics/pixel consent basis.

**Do not request Bloomreach enable this capability, and do not turn on `personalizationOneToOneEnabled` in SFCC, until both are confirmed.** Until then, `user_id` is never sent by this integration under any code path — this is enforced in code (see `helpers/bloomreachPersonalizationIdentity.js`), not just documented policy.

**Identity value caveat:** the current implementation sends the raw SFCC `Customer.ID` as a documented placeholder (no real pixel/analytics identity scheme exists in this codebase to mirror — see `helpers/bloomreachPersonalizationIdentity.js`'s own comments). **Confirm with Bloomreach what identifier format they expect** (raw id, a hash, a pseudonymous token) before this is enabled — the value sent may need to change to match.

---

## 8. Response Shape Confirmation

The integration assumes a standard Bloomreach JSON response shape:

```json
{ "response": { "docs": [ { "pid": "...", "sku": "...", "title": "...", "thumb_image": "...", "price": 0, "...": "..." } ], "numFound": 0 } }
```

Confirm this matches your account's actual response envelope — if Bloomreach wraps results differently for your tier/region, `services/bloomreachService.js` is the single place that would need updating (every other module in this cartridge only depends on `response.docs`).

---

## Setup Checklist (Bloomreach-side)

1. [ ] Confirm account ID, auth key, domain key issued and securely shared with the SFCC team.
2. [ ] Confirm API base URL for this account/tier.
3. [ ] Confirm `pid`/`sku` identity field mapping (§2).
4. [ ] Confirm `title`/`thumb_image`/`price` response field names (§3).
5. [ ] Confirm all facet/filter attributes in §4 are present, filterable, and populated with the exact expected values.
6. [ ] Confirm `bvRating`/`bvReviewCount`/`sales_rank_bucket` are present, numeric, and sortable (§5), **including `sales_rank_bucket`'s scale**.
6a. [ ] Resolve the `cart_add_count` question in §5.1 — confirm the field, give its real name, or confirm shipping without that badge.
6b. [ ] Confirm whether `fq` boosts (`field:"value"^weight`) affect scoring on this account, or whether `fq` is a pure filter. Everything this integration treats as a *soft boost* — Boot Finder's near-match questions and the `inventory_level` bury — depends on the former. If `fq` is a pure filter, those boosts are inert (the bury becomes a no-op; the soft-boosted questions become hard filters) and boosting must move to whatever separate mechanism the account exposes.
7. [ ] Clarify whether free-text Search/Autosuggest is served by this cartridge or a separate existing integration (§6).
8. [ ] If/when 1:1 personalization is pursued: confirm license entitlement and get privacy/legal sign-off **before** any enablement request (§7).
9. [ ] Confirm the response envelope shape matches §8.
