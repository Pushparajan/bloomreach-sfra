# Techno-Functional Guide: Bloomreach × SFRA Integration

**Audience:** Managers — SFRA/SFCC, Bloomreach, UI/UX  
**Version:** 1.0  
**Last Updated:** 2026-07-29

---

## Table of Contents

1. [Executive Overview](#1-executive-overview)
2. [Platform Architecture](#2-platform-architecture)
3. [SFRA / SFCC Layer](#3-sfra--sfcc-layer)
4. [Bloomreach Configuration](#4-bloomreach-configuration)
5. [Features — Functional Walkthroughs](#5-features--functional-walkthroughs)
6. [UI/UX Breakdown](#6-uiux-breakdown)
7. [Feature Flags & Toggles](#7-feature-flags--toggles)
8. [Business Manager Configuration](#8-business-manager-configuration)
9. [Custom Objects (Merchandising)](#9-custom-objects-merchandising)
10. [Data Flow & Dependencies](#10-data-flow--dependencies)
11. [Operational Runbook](#11-operational-runbook)
12. [Risks & Mitigations](#12-risks--mitigations)
13. [Glossary](#13-glossary)

---

## 1. Executive Overview

This integration connects **Salesforce Commerce Cloud (SFCC) SFRA** — the storefront framework that powers the e-commerce site — to **Bloomreach Discovery** — an AI-driven product search and merchandising engine. The result is a set of personalized, attribute-driven shopping experiences that go beyond keyword search:

| Feature | Business Purpose |
|---|---|
| **Boot Finder** | Guided questionnaire that narrows product results to the shopper's job/lifestyle needs |
| **Product Comparison** | Side-by-side attribute comparison of 2–4 selected boots |
| **Work Job Landing** | Dedicated landing pages per trade/job type, powered by Bloomreach product ranking |
| **Thematic Page Generation** | Automated SEO content pages created by a nightly batch job |
| **Loomi (Future)** | Conversational/natural-language search (license-gated stub, not active) |

All five features share a **single service layer** — one connection to Bloomreach, one configuration block, one query-building module — so changes to ranking rules or credentials propagate everywhere automatically.

---

## 2. Platform Architecture

### 2.1 High-Level System Map

```
Shopper's Browser
       │
       ▼
SFCC SFRA Storefront
  ├── app_ariat_search_experience  ← controllers, templates, client JS
  │       BootFinder.js
  │       Compare.js
  │       Work.js
  │       Loomi.js (stub)
  │
  └── int_ariat_bloomreach         ← integration layer (shared across all features)
          bloomreachService.js     ← single HTTP service to Bloomreach API
          bloomreachAttributeQueryHelper.js  ← shared query/filter builder
          featureFlags.js          ← all feature toggles in one place
          bloomreachConstants.js   ← field names, flag IDs
          bloomreachIdentity.js    ← VG/SKU ID enforcement
          bloomreachLogger.js      ← structured, credential-safe logging
          inventoryBuryHelper.js   ← low-stock demotion rule
          thematicPageCombinations.js ← shared reader for the ThematicPageCombination matrix
          thematicPageLookup.js    ← lets Boot Finder reuse a matching Thematic Page's product set
          GenerateThematicPages.js ← nightly batch job
                │
                ▼
       Bloomreach Discovery API
       (account_id / auth_key / domain_key from SFCC Site Preferences)
```

### 2.2 Two-Cartridge Model

| Cartridge | Role | Who Touches It |
|---|---|---|
| `int_ariat_bloomreach` | Integration plumbing — credentials, query construction, logging, batch job | Backend engineers, DevOps |
| `app_ariat_search_experience` | Storefront UI — controllers, templates, client-side JavaScript | Frontend engineers, UX team |

This separation means UI changes (templates, interactions) never require touching the API integration layer, and API or credential changes never require modifying any template.

---

## 3. SFRA / SFCC Layer

### 3.1 What SFRA Is

**SFRA (Storefront Reference Architecture)** is Salesforce's standard framework for building Commerce Cloud storefronts. It uses:
- **Controllers** (server-side Node.js-like scripts) that handle HTTP requests and produce page data.
- **ISML Templates** (`.isml` files) that render HTML — similar to JSP or Blade templates.
- **Client-side JavaScript** bundled with the cartridge for browser interactions.
- **Site Preferences** — named configuration values stored in Business Manager that controllers read at runtime.

### 3.2 Cartridge Path

SFCC resolves code by searching cartridges in a declared order (the **cartridge path**). The required path for this integration is:

```
app_ariat_search_experience:int_ariat_bloomreach:[base_sfra_cartridges]
```

- `app_ariat_search_experience` must come before base SFRA so its controllers and templates take precedence.
- `int_ariat_bloomreach` must come before base SFRA so its shared scripts are resolvable via `*/cartridge/scripts/...` aliases.

**Action required:** Confirm cartridge path in Business Manager under **Administration > Sites > Manage Sites > [Site] > Settings**.

### 3.3 Controllers Overview

| Controller | Route | Cache Policy | What It Does |
|---|---|---|---|
| `BootFinder-Show` | `GET /BootFinder-Show` | No-cache (personalized) | Renders the Boot Finder modal shell with question data embedded |
| `BootFinder-Results` | `GET /BootFinder-Results?answers=<JSON>` | No-cache (personalized) | AJAX endpoint that queries Bloomreach with the shopper's answers |
| `Compare-Show` | `GET /Compare-Show?pids=id1,id2,...` | No-cache (personalized) | Renders side-by-side comparison table for 2–4 product IDs |
| `Work-JobLanding` | `GET /Work-JobLanding?jobType=<slug>` | Standard page cache | Renders the shell: trade/job-type landing page (hero, copy, product grid, personalized-strip placeholder) |
| `Work-PersonalizedStrip` | `GET /Work-PersonalizedStrip?jobType=<slug>` | No-cache (R-38) | Fetched client-side by the shell; content-zone fallback or 1:1-personalized strip (see §5.3, §4.7) |
| `Product-Show` | `GET /Product-Show?pid=<id>` | Base cartridge's own cache policy (unchanged) | PDP shell — extended (`server.extend`), not overridden; only appends `personalizedStripUrl` |
| `Product-PersonalizedStrip` | `GET /Product-PersonalizedStrip?pid=<id>` | No-cache (R-38) | Fetched client-side by the PDP shell; "Recommended With This" fragment or nothing (see §5.6) |
| `Search-Show` | `GET /Search-Show?cgid=<id>` | Base cartridge's own cache policy (unchanged) | Category/PLP shell — extended, not overridden; only appends `personalizedRailUrl` for job-type-mapped categories |
| `Search-PersonalizedRail` | `GET /Search-PersonalizedRail?cgid=<id>` | No-cache (R-38) | Fetched client-side by the Category shell; "Recommended for You" rail or nothing (see §5.6) |
| `Loomi-Query` | `GET /Loomi-Query?q=<text>` | — | Returns `{available: false}` while license gate is closed |

### 3.4 Middleware

Two cache middlewares control how pages are served:

- **`interactiveCache.applyNoCache`** — applied to Boot Finder, Compare, Work-PersonalizedStrip, Product-PersonalizedStrip, and Search-PersonalizedRail (R-38). Forces a fresh server call every time. Ensures personalized state (answers, selections, 1:1-personalized content) is never served from a shared cache.
- **`cache.applyDefaultCache`** — applied to Work-JobLanding's shell. Allows SFCC's standard page cache to absorb repeat traffic since the shell's own content is not shopper-specific. `Product-Show` and `Search-Show`'s own cache policy is whatever the base cartridge already configures - this integration only appends data via `server.extend`/`server.append` and never touches their caching.

### 3.5 Error Handling Pattern

All features follow the same pattern:
1. If the Bloomreach service returns an error, the three live shopper-facing routes (Boot Finder Results, Work Job Landing, Compare-Show) fall back to `helpers/dwSearchFallbackHelper` — SFCC's native `ProductSearchModel`/`ProductMgr` — instead of failing immediately. Only if that fallback also fails (or throws) does the route render a graceful error template with HTTP `502 Bad Gateway`. See §3.6 below.
2. Sensitive values (credentials) are stripped from all log messages before writing.
3. No error is surfaced as an uncaught exception — shoppers always see a human-readable fallback.

### 3.6 dw Search Fallback

`helpers/dwSearchFallbackHelper` maps SFCC product search/lookup results into the same doc shape a Bloomreach hit has (`pid`, `title`, `thumb_image`, `price`, every field in `bloomreachConstants.ATTRIBUTES`, `bvRating`, `bvReviewCount`), so nothing downstream — rationale chips, `compareModel`, thematic markup — needs to know or care which source produced the docs.

- **Scope:** only the three live routes use it. `GenerateThematicPages` (the nightly batch job) deliberately does not — a stale-but-valid page from the last successful run is a better outcome for a background job than a same-run substitute, so it keeps its existing skip-and-log-error behavior.
- **Accepted degradation:** SFCC's attribute refinement (`ProductSearchModel.addRefinementValues`) has no boost concept, so every answer becomes a hard filter in the fallback — Bloomreach's soft-boosted questions (shaft height, waterproof, insulation) may narrow results more strictly than usual. Range answers (e.g. `shaft_height_in` as `{min, max}`) aren't refinable this way and are skipped entirely rather than guessed at. Ranking is reproduced by sorting the mapped docs by `bvRating` (then `bvReviewCount`/`sales_rank_bucket` per the same feature flags the live query uses) rather than a Business Manager Sorting Rule, since no such rule is assumed to exist.
- **ASSUMPTION:** every `ATTRIBUTES` field name and `bvRating`/`bvReviewCount` are real, refinable SFCC Product custom/system attribute IDs (plausible for `bvRating`/`bvReviewCount` given a Bazaarvoice-style integration already syncs review data onto Product). Verify against the real catalog before shipping; only this module needs to change if the IDs differ.

---

## 4. Bloomreach Configuration

### 4.1 Credentials (Site Preferences)

All Bloomreach credentials are stored as **SFCC Custom Site Preferences** — they are never hardcoded in source code.

| Preference ID | Purpose | Where to Set |
|---|---|---|
| `bloomreachAccountId` | Your Bloomreach account identifier | BM > Merchant Tools > Site Preferences > Custom Preferences |
| `bloomreachAuthKey` | API authentication key (secret) | Same location — this value is **redacted from all logs** |
| `bloomreachDomainKey` | Identifies which Bloomreach catalog/domain to query | Same location |

> **Security Note:** `bloomreachAuthKey` is masked in service logs via `filterLogMessage` in the service layer. Never log or expose this value in templates or error messages.

### 4.2 API Communication

- **Protocol:** HTTPS GET requests only.
- **Endpoint:** Bloomreach Discovery Product Search API.
- **Request shape:** All calls include `account_id`, `auth_key`, `domain_key`, and a `request_id` (timestamp-based, auto-generated per call). Boot Finder Results, Compare-Show, and Work-JobLanding's `PersonalizedStrip` fragment additionally include `user_id` when `personalization.oneToOne.enabled` is on and the shopper is authenticated - see §4.7.
- **Response shape:** Standard Bloomreach JSON — `{ response: { docs: [...], numFound: N } }`.

### 4.3 Query Types Used

| Query Pattern | Used By | Description |
|---|---|---|
| **Keyword search** (`q` param) | Site Search (pre-existing) | Free-text query |
| **Attribute filter query** (`fq` param) | Boot Finder, Work Landing | Filter/boost by product attributes |
| **Product ID lookup** (`fq: pid:...`) | Compare Tool | Fetch specific VG records by ID |
| **Autosuggest** (`request_type: suggest`) | Autocomplete | Prefix-based suggestions |

### 4.4 Index Field Dependencies

The integration expects these fields to be **present and populated in your Bloomreach index**. If any are missing, the corresponding feature will degrade silently (fewer results, no ranking signal — not a hard failure):

| Field Name | Used By | Notes |
|---|---|---|
| `job_type` | Boot Finder, Work Landing, Thematic Pages | Multi-value string |
| `Toe_Shape` | Boot Finder, Thematic Pages | e.g. "Composite", "Steel", "Alloy" |
| `safety_specs` | Boot Finder, Thematic Pages | e.g. "EH", "SD", "PR" |
| `Shaft_Height` | Boot Finder (string mode) | Categorical height label |
| `shaft_height_in` | Boot Finder (range mode — feature-flagged) | Numeric inches |
| `Safety_Toe` | Boot Finder, Compare | Toe protection type |
| `feature_waterproof` | Boot Finder | Boolean |
| `warmth_rating` | Boot Finder | Insulation level |
| `bvRating` | Ranking sort | Bazaarvoice average rating |
| `bvReviewCount` | Ranking sort (feature-flagged) | Number of reviews |
| `sales_rank_bucket` | Ranking tiebreak (feature-flagged) | Sales velocity bucket |

**Action required:** Work with your Bloomreach implementation team to confirm all above fields are indexed and populated in your product feed.

### 4.5 Ranking Logic

Results from Boot Finder and Work Landing are sorted by review quality, not keyword relevance:

```
Primary:   bvRating DESC
Secondary: bvReviewCount DESC  (only when REVIEW_COUNT_BOOST flag is ON)
Tiebreak:  sales_rank_bucket DESC  (only when SALES_RANK_TIEBREAK flag is ON)
```

This ensures highly-rated, well-reviewed boots surface first, with sales velocity as the final differentiator.

### 4.6 Inventory Burying

When enabled via the `lowStockBuryThreshold` site preference, the integration automatically appends a filter fragment that demotes (buries) low-stock products in Bloomreach results. Products below the threshold are pushed to the bottom of results without being removed entirely.

### 4.7 1:1 (Individual-Level) Personalisation — `user_id` (R-38)

This is distinct from everything else in this section: it is gated by a dedicated master flag (`PERSONALIZATION_ONE_TO_ONE`, §7.4), not just an index-field dependency, and that flag has business/legal prerequisites before it may ever be turned on - see §7.4 before reading further.

`helpers/bloomreachPersonalizationIdentity.resolveShopperIdentity(currentCustomer)` returns `{ userId, isLoggedIn }`. `userId` is `dw.customer.Customer.ID` **only when both** `personalization.oneToOne.enabled` is on **and** the shopper is authenticated; it is `null` in every other case (flag off, guest, or ambiguous identity) - the flag check lives inside this single function precisely so no call site can leak a `user_id` while the flag is off, no matter how many call sites are added in the future.

**Scope - five call sites, one exclusion pattern:**

| Route | Sends `user_id`? | How |
|---|---|---|
| Boot Finder Results | Yes, when eligible | `resolveShopperIdentity(...).userId` passed into `bloomreachAttributeQueryHelper.queryByAttributes` |
| Compare-Show | Yes, when eligible | Same, passed into `bloomreachProductLookupHelper.lookupByIds` |
| Work-JobLanding **shell** | No, never | Never calls `resolveShopperIdentity` at all |
| Work-JobLanding's `PersonalizedStrip` **fragment** (§5.3) | Yes, when eligible | Same pattern as Boot Finder/Compare, but only within this separate, uncached fragment - not the cached shell |
| `Product-Show` **shell** (PDP) | No, never | Only extended via `server.append` to append a fragment URL; never calls `resolveShopperIdentity` |
| `Product-PersonalizedStrip` **fragment** (§5.6) | Yes, when eligible | Same pattern, within a separate, uncached fragment |
| `Search-Show` **shell** (Category/PLP) | No, never | Only extended to append a fragment URL for job-type-mapped categories; never calls `resolveShopperIdentity` |
| `Search-PersonalizedRail` **fragment** (§5.6) | Yes, when eligible, and only for job-type-mapped categories | Same pattern, within a separate, uncached fragment |
| Free-Text Search/Autosuggest | No, never | Never calls `resolveShopperIdentity` at all; explicitly out of scope for R-38 (see §5.3's note on why) |

The exclusions are structural, not runtime checks: those call sites simply never call `resolveShopperIdentity` or pass a `userId`. Since `bloomreachService` already drops `undefined` params before building the request, an anonymous shopper's (or flag-off) request is byte-for-byte identical to before this feature existed.

**ASSUMPTION (ships as a documented placeholder, not a confirmed final value):** no pixel/analytics identity mechanism exists anywhere in this codebase to mirror (`client/default/js/shared/gtmEvents.js` itself documents that no real GTM dataLayer implementation was found). "Logged in user id" therefore resolves to the raw SFCC `Customer.ID` today. Two follow-ups before this ships for real: (1) confirm with the Bloomreach account team what identity value they actually expect (raw id vs. a hash vs. something else), and (2) once a real pixel/tracking identity mechanism is built, update it and `resolveShopperIdentity` together so query-time personalization and behavioral-history identity never diverge - see that module's header comment for why divergence defeats the point of sending an identifier at all.

---

## 5. Features — Functional Walkthroughs

### 5.1 Boot Finder

**Business goal:** Help shoppers who don't know which boot is right for their job find the best match quickly.

**Functional flow:**

```
1. Shopper sees the Boot Finder entry card on the page.
2. Shopper clicks "Start" → AJAX call to BootFinder-Show.
3. Modal opens with questions (sourced from server, embedded in HTML).
4. Shopper answers questions one at a time in the browser (no server calls per answer).
5. After final answer (or "Show results now"), browser sends all answers to BootFinder-Results.
6. Server checks whether the answers exactly match a pre-generated Thematic Page combination
   (job_type/toe_shape/safety_specs only, nothing else answered) that is currently online - if so,
   it reuses that page's stored product set instead of calling Bloomreach again (see Thematic Page
   Reuse below). Otherwise, server builds a Bloomreach filter query from answers and fetches
   matching products live.
7. Server filters results further: if shopper answered size/width, only orderable variants in that size/width are shown.
8. Results grid renders inside the modal with product cards and rationale chips.
```

**Thematic Page reuse:** `helpers/thematicPageLookup.findDocs` matches Boot Finder's answers against the same `ThematicPageCombination` matrix `GenerateThematicPages` uses, and - only when `job_type`/`Toe_Shape`/`safety_specs` are the *only* answers present and the matching page is online - returns that page's stored `productData` instead of issuing a live query. This saves a Bloomreach call and guarantees parity with the SEO page for that exact combination, at the cost of the live query's per-request sort boosts (`REVIEW_COUNT_BOOST`/`SALES_RANK_TIEBREAK`) - reused results keep the sort order from when the page was generated. Any other question answered (shaft height, waterproof, insulation) - or any lookup failure - falls back to the normal live query, so this is purely a performance optimization, never a behavior change for a fully-refined search.

**Error handling, per [Bloomreach's documented Thematic API error handling](https://documentation.bloomreach.com/discovery/reference/error-handling-for-the-thematic-api):** a missing/unmatched combination ("bad theme name"), an offline page, a parse failure, or **zero stored products** are all treated identically as "not available" and fall back to the live query - the doc is explicit that zero products must trigger the fallback path, never render as a valid empty result, which is also why `GenerateThematicPages` takes a zero-product combination's page offline rather than publishing it. Our reuse layer never calls Bloomreach's Thematic API live and never renders a customer-facing page directly, so the doc's timeout/redirect-to-homepage guidance doesn't apply here - a lookup failure just means "run the live query," not "show an error page."

**If the live query itself fails** (Bloomreach unreachable), Boot Finder falls back a second time - to SFCC's native search via `helpers/dwSearchFallbackHelper` - before ever showing the 502 error template. See §3.6.

**Questions the finder can ask:**

| Question | Field | Flag | Always Active? |
|---|---|---|---|
| What type of work do you do? | `job_type` | `JOB_TYPE` | No |
| Safety toe type | `Safety_Toe` | _(none)_ | Yes |
| Toe shape | `Toe_Shape` | _(none)_ | Yes |
| What shaft height do you prefer? | `shaft_height_in` or `Shaft_Height` | `SHAFT_HEIGHT_RANGE` | No |
| Do you need waterproof boots? | `feature_waterproof` | `WATERPROOF_QUESTION` | No |
| What insulation level? | `warmth_rating` | `INSULATION_QUESTION` | No |
| What safety specs do you need? | `safety_specs` | `SAFETY_SPEC_REFINEMENT` | No |
| Size and width | variant filters | _(built-in)_ | Yes |

**Rationale chips:** Each result card shows short labels like "Electrical Ready", "Composite Toe", "8\" Shaft" explaining why that product matched the shopper's answers. These are generated server-side from the answer/result match.

**GTM events fired:**

| Event | When |
|---|---|
| `finder_start` | Modal opens |
| `finder_question_answered` | Shopper selects an answer |
| `finder_complete` | All answers gathered, results fetched |
| `finder_result_click` | Shopper clicks a result product |

---

### 5.2 Product Comparison

**Business goal:** Let shoppers compare 2–4 boots side by side to make a confident purchase decision.

**Functional flow:**

```
1. Shopper checks comparison checkboxes on product tiles (PLP, Boot Finder results, Thematic Pages).
2. Client JS stores selected product IDs in sessionStorage.
3. When 2+ items are selected, a "Compare"/"View Comparison" button/bar appears.
4. Shopper clicks it → browser navigates to Compare-Show with IDs in URL (plus a `theme`
   param when the trigger came from a Thematic Page - see data-theme-key in §5.4).
5. Server checks whether a `theme` param was sent and, if so, whether that Thematic Page is
   online and its stored product set contains every requested ID - if so, it reuses that data.
   Otherwise (no theme param, page offline, or any ID not in that page's set), server fetches
   full product data for each ID from Bloomreach live.
6. Comparison table renders with each product as a column and attributes as rows.
7. Shopper can remove a product (re-requests with fewer IDs) or click "View Product".
```

**Constraints:**
- Minimum 2 products required.
- Maximum 4 products enforced (extra IDs are silently truncated server-side).

**Thematic Page fallback:** `helpers/thematicPageLookup.findDocsByCombinationKey` looks up the exact Thematic Page by key and returns its stored `productData` only when every requested ID is present in it; a partial match (e.g. the shopper added a product from elsewhere on the site) or any lookup failure falls back to the normal live Bloomreach call automatically. Comparisons started anywhere other than a Thematic Page (PLP, Boot Finder) always use the live call, since there's no `theme` param to look up.

**If the live Bloomreach call itself fails**, Compare-Show falls back a second time - to SFCC's native product lookup via `helpers/dwSearchFallbackHelper` - before showing the 502 error template. See §3.6.

**Attribute rows shown** (feature-flagged rows excluded if their flag is off):
- Product name, image, price
- Safety toe type, toe shape, shaft height
- Waterproof rating, insulation, safety specs
- BV rating and review count

---

### 5.3 Work Job Landing

**Business goal:** Provide trade-specific entry points (e.g. `/work/electrical`, `/work/construction`) with curated product listings and editorial content.

**Functional flow:**

```
1. Shopper lands on /Work-JobLanding?jobType=electrical (or equivalent SEO-friendly URL).
2. Server validates the job type is known and the JOB_TYPE feature flag is on.
3. Server queries Bloomreach for products matching that job type (soft-boosted, not hard-filtered).
4. If that query fails (Bloomreach unreachable), server falls back to SFCC's native search via
   `helpers/dwSearchFallbackHelper` (see §3.6) before treating it as a service failure.
5. Shell template renders: H1 heading + product grid + a placeholder for the personalized
   content-zone strip (see below) + Boot Finder entry card.
6. Browser fetches Work-PersonalizedStrip client-side and injects the response into that
   placeholder once loaded - the shell itself never waits on this.
7. If both Bloomreach and the dw search fallback fail on the shell's own product query →
   shows an error message but page still loads.
8. If no products found → shows a "no products" message.
```

**Caching:** The shell (hero/copy/tiles, H1, and the generic job-type product grid) uses standard SFCC page cache, so repeat visitors and crawlers benefit from cached HTML - none of this varies per shopper. Unlike Boot Finder, there is no personalized state **in the shell**.

**R-38 - Shell/Fragment split for 1:1 personalization:** the one part of this page that CAN vary per individual shopper - the content-zone slot - has been pulled out of the cached shell into a separate, uncached fragment endpoint, `Work-PersonalizedStrip` (`controllers/Work.js`), fetched client-side by `client/default/js/work/jobLandingPersonalizedStrip.js` after the shell loads. This keeps the shell's own cacheability completely untouched while still allowing the one genuinely personal piece of the page to be personalized:

- **Flag off, or guest, or the Bloomreach call fails/returns nothing:** the fragment renders the SAME existing Page Designer content zone (`work-joblanding-{slug}`) this page has always used - reused unchanged, not rebuilt, per the integration spec. This is the fallback, not an error state.
- **Flag on and shopper logged in:** the fragment calls Bloomreach with `user_id` (see §4.7) for a small (8-item) personalized product strip, tagged distinctly in logs as `WorkJobLandingPersonalized` so this code path's health can be monitored separately from the shell's own `WorkJobLanding`-tagged query during rollout.
- **Client-side fetch failure** (network error, non-2xx - rare, since the far more common flag-off/guest/failure cases above are all still HTML-success responses handled entirely server-side): the shell's skeleton placeholder is simply removed. The shell's hero, copy, product grid, and Boot Finder entry card are entirely unaffected either way.
- No shared/CDN cache TTL is applied to this fragment's response, by design - a per-user micro-cache would be a reasonable rapid-reload optimization but is not implemented (see "Assumptions Made" in the R-38 implementation).

**Boot Finder entry card** is included at the bottom of the Work Landing page, providing a natural next-step for shoppers.

---

### 5.4 Thematic Page Generation (Batch Job)

**Business goal:** Auto-generate SEO-optimized content pages for attribute combinations (e.g. "electrical safety toe composite boots") without requiring developer involvement for each combination.

**Functional flow:**

```
1. Merchandisers/SEO team create ThematicPageCombination records in Business Manager.
   Each record defines: job_type + safety_spec + toe_shape combination + enabled flag.
2. Nightly batch job (GenerateThematicPages.js) runs via SFCC Job Schedules.
3. Job reads all enabled combinations, skips those blocked by feature gates.
4. For each combination: queries Bloomreach → gets matching product list.
5. Job creates or updates a SFCC Content Asset under folder "work-thematic-pages".
   - Content ID: work-{combinationKey}
   - Writes JSON-LD ItemList structured data markup for SEO, plus a real product
     grid so shoppers can act on the page directly (see below).
   - Sets content ONLINE if products found, OFFLINE if no products (prevents empty pages from being indexed).
6. Job supports a "dry-run" mode for safe testing without writing content assets.
```

**Key safeguard:** If Bloomreach returns zero products for a combination, the content asset is set offline automatically. This prevents empty thematic pages from being crawled and indexed, which would hurt SEO.

**Comparison Tool integration:** Each product tile in the generated grid carries the same compare-checkbox markup as `components/compareControl.isml` (`data-compare-select` / `data-vg-id` / `data-name` / `data-image`), and the page includes a "View Comparison" trigger using the same `data-compare-view` contract the site's `compare.js` already listens for. Because `compare.js`'s handlers are delegated at the document level and the `Compare-Show` route is unchanged, shoppers can select 2–4 products straight from a thematic page and jump into the existing Comparison Tool — no new controller, service, or credentials were introduced for this.

---

### 5.5 Loomi (Future Feature Stub)

Loomi is a conversational/natural-language search capability from Bloomreach. It is **not active** — the controller exists as a placeholder only.

- While `loomiEnabled` = `false` (required default), the endpoint returns `{ "available": false }`.
- No AI service is called, no license key is referenced, no UI is built.
- **Do not activate without a separate, explicit approval and licensing agreement.**

### 5.6 PDP & Category Page 1:1 Personalization (R-38)

**Business goal:** extend the same shell/fragment 1:1-personalization pattern built for Work Job Landing onto the two core storefront page types - the Product Detail Page (PDP) and Category/PLP browse pages - both owned by the base cartridge, not this one.

**Architecture:** identical principle to Work-JobLanding (§5.3) - a cached shell (untouched, whatever the base cartridge already renders/caches) plus a separate, uncached fragment fetched client-side, carrying `user_id` only when eligible (§4.7). Neither fragment ever re-ranks or replaces the shell's own content; each only **adds** a personalized section. Full-grid/full-PDP personalization is explicitly out of scope for this pattern - same boundary already drawn around free-text Search/Autosuggest - it would need a cache-variant redesign or the Next.js end state.

| Page | Shell (owned by base cartridge, untouched) | Fragment (this cartridge) |
|---|---|---|
| PDP | Images, price, size/color, reviews, SEO | `Product-PersonalizedStrip` - "Recommended With This" |
| Category/PLP | Header, facet UI, product grid | `Search-PersonalizedRail` - "Recommended for You" rail, **added**, not re-ranking the grid |

**No base-cartridge template change required.** Since the real base PDP/Category templates aren't part of this repo, `controllers/Product.js` and `controllers/Search.js` extend the base controllers (`server.extend(module.superModule)`, standard SFRA override) to append a fragment URL onto `res.getViewData()` for forward-compatibility, but the client-side fetch (`client/default/js/shared/personalizedFragment.js`) doesn't depend on it - it derives the fragment's URL from the current page's own URL and injects the response into `#maincontent` (SFRA's standard accessibility skip-link target). This is a documented **ASSUMPTION**, not a confirmed base-template hook: a real implementation would ideally place each fragment more precisely (e.g. directly after the main product grid), which requires a small base-cartridge template change this repository cannot make on its own - see "Assumptions Made" below.

**Category → job type mapping:** the rail only renders for categories that map to one of this integration's existing job types (`shared/jobTypeHelper` - the same taxonomy Work-JobLanding and Boot Finder's Q1 already use), reusing an existing mechanism rather than inventing a generic category-to-Bloomreach-facet mapping for the whole catalog. Every other category renders no rail at all.

**PDP recommendation basis - two flagged gaps:**
- No dedicated Bloomreach "similar items"/"related products" widget endpoint is confirmed for this integration; the PDP fragment approximates "related" by filtering on the *current* product's own `job_type` attribute (excluding the product being viewed), not a confirmed recommendations API shape. Confirm the real shape with the Bloomreach account team before shipping.
- "Recently viewed" is **not implemented** - no product-view-history mechanism exists anywhere in this codebase to build it from. The PDP fragment is "recommended with this" only.

**Fallback behavior differs from Work-JobLanding:** Work Job Landing's fragment falls back to an existing segment-level Page Designer content zone when not eligible. No equivalent pre-existing non-personalized recommendation zone was found for the PDP or Category pages, so both fragments simply render nothing (the client-side placeholder collapses) when the flag is off, the shopper is a guest, or Bloomreach fails - not an error state, just an empty one.

**Logging:** tagged `PDPPersonalized` and `CategoryPersonalizedRail` respectively, distinct from every other feature's tag, so each can be monitored separately during rollout.

---

## 6. UI/UX Breakdown

### 6.1 Boot Finder Entry Point

**Component:** `bootFinderEntry.isml` / `bootFinderModal.isml`

The Boot Finder has two entry surfaces:

1. **Entry card** — a dismissible card on product listing pages and the Work Job Landing. Dismissed state is stored in `sessionStorage` so it does not re-appear in the same session.
2. **Modal** — launched when the shopper clicks "Start". The modal is appended to the document body and handles all question/result states internally via the `bootFinder.js` client script.

**Question types supported in the UI:**

| Type | Rendered As |
|---|---|
| `single-select` | Button group — one selection at a time |
| `boolean` | Yes/No toggle buttons |
| `shaft-height` | Height selection (range or categorical depending on flag) |
| `variant` | Size and width selector |
| `multi-select` | Checkbox-style multi-option buttons |

**Navigation:** Shopper can skip any question (answer is omitted from Bloomreach query) or click "Show results now" at any point to see results with partial answers.

**Results display:** Product cards include thumbnail, name, price, BV rating, and rationale chips. Each card links to the full product detail page.

---

### 6.2 Comparison Tool

**Component:** `compareControl.isml` / `compare.js` / `compare/table.isml`

**Selection widget** (shown on PLP and Boot Finder results):
- A checkbox on each product tile labeled "Compare".
- A sticky compare bar appears when 2+ items are selected, showing selected product thumbnails and a "Compare" button.
- At the maximum (4 items), additional checkboxes are disabled with a tooltip.
- Selections persist in `sessionStorage` across navigation within the session.

**Comparison table** (rendered on the Compare page):
- Products as columns, attributes as rows.
- A "×" remove button on each column to drop a product and refresh.
- A "View Product" CTA on each column.
- Rows whose feature flag is off are excluded entirely — no empty rows or "N/A" noise.

---

### 6.3 Work Job Landing

**Template:** `work/jobLanding.isml`

The page is structured in three zones:

1. **Page Designer zone** — editorial content managed by merchandisers in Business Manager (hero image, copy, editorial tiles). This zone only renders if a matching Page Designer page exists (naming convention: `work-joblanding-{slug}`).
2. **Product grid** — Bloomreach-powered, ranked by review score.
3. **Boot Finder entry card** — always present, drives shoppers into the guided experience.

**States handled gracefully:**
- Bloomreach service down → error message shown; rest of page still renders.
- No matching products → friendly "no products" message.
- Unknown job type or flag off → 404-style "not found" template.

---

### 6.4 GTM / Analytics

All behavioral events are pushed to `window.dataLayer` (GTM) via `gtmEvents.js`.

| Event Name | Feature | Payload |
|---|---|---|
| `finder_start` | Boot Finder | _(empty)_ |
| `finder_question_answered` | Boot Finder | `{ question_id, answer }` |
| `finder_complete` | Boot Finder | `{ answers }` (all collected answers) |
| `finder_result_click` | Boot Finder | `{ vg_id }` (product clicked) |

> **Note:** Comparison and Work Landing interactions do not currently fire dedicated GTM events. If reporting on those is needed, GTM tag additions should be scoped separately.

---

## 7. Feature Flags & Toggles

All feature flags are SFCC Custom Site Preferences, managed in Business Manager. They are read through a single `featureFlags.isEnabled(flagKey)` helper — no direct preference lookups exist in controllers.

### 7.1 Flag Reference Table

| Logical Flag Name | Preference ID in SFCC | Default | Controls |
|---|---|---|---|
| `JOB_TYPE` | `finderJobTypeEnabled` | `false` | Job Type question in Boot Finder; Work Job Landing pages |
| `SHAFT_HEIGHT_RANGE` | `finderShaftHeightRangeEnabled` | `false` | Uses numeric `shaft_height_in` field (range query) vs. categorical `Shaft_Height` |
| `SAFETY_SPEC_REFINEMENT` | `finderSafetySpecRefinementEnabled` | `false` | Safety specs question in Boot Finder |
| `WATERPROOF_QUESTION` | `finderWaterproofQuestionEnabled` | `false` | Waterproof question in Boot Finder |
| `INSULATION_QUESTION` | `finderInsulationQuestionEnabled` | `false` | Insulation/warmth question in Boot Finder |
| `REVIEW_COUNT_BOOST` | `finderReviewCountBoostEnabled` | `false` | Adds `bvReviewCount` as secondary sort signal |
| `SALES_RANK_TIEBREAK` | `finderSalesRankTiebreakEnabled` | `false` | Adds `sales_rank_bucket` as tertiary sort tiebreak |
| `LOOMI_ENABLED` | `loomiEnabled` | `false` | Loomi conversational search (stub — do not enable) |
| `PERSONALIZATION_ONE_TO_ONE` | `personalizationOneToOneEnabled` | `false` | **R-38 — see §7.4.** Master switch for sending `user_id` to Bloomreach for 1:1 personalization (Boot Finder, Compare, Work-JobLanding's `PersonalizedStrip` fragment only) |

### 7.2 Flag Behavior Guarantees

- **A question whose flag is off is invisible to the shopper** — it is removed from the question list before the modal renders.
- **A stale client that answered a disabled question** (flag turned off mid-session) will have that answer silently dropped server-side before the Bloomreach query runs.
- **Flags can be toggled in Business Manager with no code deployment.** Changes take effect on the next request.

### 7.4 `PERSONALIZATION_ONE_TO_ONE` — Business/Legal Gates Before Enabling

Unlike every other flag in this table, `personalizationOneToOneEnabled` is **not** an engineering readiness switch — flipping it on sends an identifier to a third party (Bloomreach) for individual-level shopper profiling, which is a business and legal decision, not a code-deploy decision. **Do not enable this flag in any environment, including Staging, without both of the following confirmed first:**

1. A confirmed Bloomreach license tier that includes individual-level (not just segment-level) personalization.
2. A consent classification from the privacy/legal contact for *this specific* data flow. Sending an identifier to Bloomreach for individual profiling is a different consent question than any existing analytics/pixel classification on the site — do not assume an existing consent basis covers this without an explicit confirmation.

If asked to enable this flag as part of a code change or deployment checklist, that request should be declined and redirected to whoever owns the two confirmations above — they are prerequisites to this flag's existence, not steps this integration's engineering work can satisfy.

See `helpers/bloomreachPersonalizationIdentity.js` for the identity resolution this flag gates, and §4.4 for what it changes when on.

### 7.3 Recommended Activation Sequence

1. Confirm Bloomreach index contains the relevant field(s) for the feature.
2. Enable the flag in a lower environment (Staging).
3. QA the Boot Finder modal, verify results contain expected products.
4. Enable in Production.

---

## 8. Business Manager Configuration

### 8.1 Site Preferences to Create

Navigate to: **Merchant Tools > Site Preferences > Custom Preferences**

Create a custom preference group (e.g. `Bloomreach`) and add the following attributes:

| Attribute ID | Type | Required | Notes |
|---|---|---|---|
| `bloomreachAccountId` | String | Yes | Provided by Bloomreach |
| `bloomreachAuthKey` | String (password) | Yes | API secret — use secure/masked field type |
| `bloomreachDomainKey` | String | Yes | Provided by Bloomreach |
| `finderJobTypeEnabled` | Boolean | Yes | Feature flag |
| `finderShaftHeightRangeEnabled` | Boolean | Yes | Feature flag |
| `finderSafetySpecRefinementEnabled` | Boolean | Yes | Feature flag |
| `finderWaterproofQuestionEnabled` | Boolean | Yes | Feature flag |
| `finderInsulationQuestionEnabled` | Boolean | Yes | Feature flag |
| `finderReviewCountBoostEnabled` | Boolean | Yes | Feature flag |
| `finderSalesRankTiebreakEnabled` | Boolean | Yes | Feature flag |
| `loomiEnabled` | Boolean | Yes | Must remain `false` |
| `personalizationOneToOneEnabled` | Boolean | Yes | **Must remain `false`** until both R-38 business/legal gates are confirmed — see §7.4 |
| `lowStockBuryThreshold` | Number | No | Threshold for inventory burying (e.g. `5`) |

### 8.2 SFCC Service Registration

The integration registers a service named `bloomreach.http.search` via SFCC's Service Framework.

Navigate to: **Administration > Operations > Services**

Ensure this service is registered with:
- **Type:** HTTP
- **URL:** Bloomreach Discovery API base URL (e.g. `https://core.dxpapi.com/api/v1/core/`)
- **Credentials:** Leave blank (credentials are injected dynamically per request from site preferences)
- **Communication Timeout:** Recommend 5000ms (5 seconds)

### 8.3 Job Schedule (Thematic Pages)

Navigate to: **Administration > Operations > Jobs**

Create a job step that executes `GenerateThematicPages` from `int_ariat_bloomreach`. Recommended schedule:
- **Frequency:** Nightly (e.g. 2:00 AM)
- **Chain before:** Sitemap generation job (so thematic page online/offline state is reflected in the same sitemap run)
- **Parameters:** `dryRun=false` for production; `dryRun=true` for test runs

---

## 9. Custom Objects (Merchandising)

### 9.1 ThematicPageCombination

Import the custom object type definition from:  
`metadata/thematic-page-combination-custom-object.xml`

Navigate to: **Administration > Site Development > Import & Export** to import.

**Fields per record:**

| Field | Type | Required | Description |
|---|---|---|---|
| `combinationKey` | String (key) | Yes | Unique ID, e.g. `electrical-eh-composite` |
| `jobType` | String | Yes | Must match a valid `job_type` value in Bloomreach |
| `safetySpec` | String | No | Optional, e.g. `EH`, `SD`, `PR` |
| `toeShape` | String | No | Optional, e.g. `Composite`, `Steel` |
| `enabled` | Boolean | Yes | Toggle individual combinations on/off |

**Managing combinations:**  
Navigate to: **Merchant Tools > Custom Objects > Custom Object Editor > ThematicPageCombination**

Merchandisers and SEO managers can add, edit, or disable combinations without developer involvement. The next nightly job run will create, update, or take offline the corresponding content asset.

### 9.2 Generated Content Assets

The job writes content assets to the `work-thematic-pages` folder with IDs following the pattern `work-{combinationKey}`.

Navigate to: **Merchant Tools > Content > Content Assets > work-thematic-pages**

Each asset contains:
- JSON-LD `ItemList` structured data markup (for Google rich results)
- A product grid with Comparison Tool checkboxes and a "View Comparison" trigger (see §5.4)
- `custom.productData`: the raw Bloomreach hits as JSON, so Boot Finder can reuse this exact product
  set for a matching job_type/toe_shape/safety_specs combination (see §5.1)
- Online/offline state controlled automatically by the job

---

## 10. Data Flow & Dependencies

### 10.1 Request Lifecycle (Boot Finder Results)

```
Browser
  │  GET /BootFinder-Results?answers={"job_type":"electrical","Safety_Toe":"Composite"}
  ▼
BootFinder Controller (Results)
  │  Parse and validate answers against active feature flags
  │  Build fq filter: job_type:"electrical"^1.5 AND Safety_Toe:"Composite"^1.5
  │  + inventory bury fragment (if threshold set)
  │  Sort: bvRating DESC [,bvReviewCount DESC] [,sales_rank_bucket DESC]
  ▼
bloomreachAttributeQueryHelper → bloomreachService
  │  GET https://[bloomreach-api]/?fq=...&sort=...&rows=24&account_id=...
  ▼
Bloomreach Discovery API
  │  Returns: { response: { docs: [{pid, title, thumb_image, price, bvRating, ...}] } }
  ▼
BootFinder Controller
  │  Extract VG IDs from results
  │  If size/width answered: filter to orderable variants via SFCC ProductMgr
  │  Build rationale chips per result
  ▼
Browser
  HTML: resultsGrid.isml → product cards with chips
```

### 10.2 Identity Mapping

| Bloomreach Concept | SFCC Equivalent | Field |
|---|---|---|
| Product (`pid`) | Variation Group (colorway) | `pid` in Bloomreach response |
| SKU (`sku`) | Variation (sellable unit — size+width+color) | `sku` in Bloomreach response |

> **Critical rule:** Never pass a Base Product ID or plain SKU ID where a Variation Group ID is expected. The `bloomreachIdentity.js` helper enforces this mapping everywhere.

### 10.3 External Dependencies Summary

| Dependency | Owned By | Impact If Unavailable |
|---|---|---|
| Bloomreach Discovery API | Bloomreach | Boot Finder, Compare, Work Landing degrade to error state; page still loads |
| Bloomreach product feed/index | Data/Feed team | Stale or missing attributes reduce result quality |
| SFCC Product catalog | SFCC/Merchandising | Size/width availability filtering in Boot Finder fails gracefully |
| Page Designer pages (`work-joblanding-*`) | Merchandising/Content | Work Landing renders without editorial zone |
| GTM dataLayer | Analytics/Marketing | Events lost silently; no storefront impact |

---

## 11. Operational Runbook

### 11.1 Monitoring

| Signal | Where to Check | Action If Triggered |
|---|---|---|
| Bloomreach service error rate | SFCC Custom Log files / Log Center (category: `bloomreach`) | Check Bloomreach API status; verify credentials in Site Preferences |
| Thematic page job error count | SFCC Job Log (Administration > Operations > Jobs) | Check Bloomreach connectivity; review custom object data quality |
| Empty thematic pages | Content Asset Manager (work-thematic-pages folder) | Check Bloomreach index for missing attribute values; verify combination record values |
| Boot Finder returning 0 results | QA in Staging / customer complaints | Verify Bloomreach index fields; review active feature flags; check fq syntax in logs |

### 11.2 Log Structure

All log entries include:
- **Feature context** (e.g. `BootFinder`, `WorkJobLanding`, `GenerateThematicPages`)
- **Request parameters** (with `auth_key` redacted)
- **Error details** with HTTP status code if applicable

Logs are written to the SFCC custom log category `bloomreach`. Configure log rotation and alerting in BM under **Administration > Site Development > Log Center**.

### 11.3 Safe Feature Flag Operations

To **enable** a flag:
1. Verify the corresponding Bloomreach index field exists and has data.
2. Enable in Staging. QA with real shopper scenarios.
3. Enable in Production during low-traffic window.
4. Monitor error logs for 30 minutes post-change.

To **disable** a flag:
1. Set to `false` in Business Manager — immediate effect, no deployment needed.
2. Any in-flight sessions with that question answered will have the answer silently dropped.

### 11.4 Credential Rotation

1. Obtain new `auth_key` from Bloomreach.
2. Update `bloomreachAuthKey` in **all** SFCC environments (Dev, Staging, Production).
3. Verify with a test Boot Finder query on each environment.
4. Confirm old key is deactivated in Bloomreach dashboard.

---

## 12. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Bloomreach API outage | Low-Medium | Medium — features degrade, error templates shown | Graceful fallback templates; no hard failures; monitor service errors |
| Missing/misnamed index field | Medium | Medium — feature returns fewer or no results | Feature flags allow field-by-field gating; verify field names match `bloomreachConstants.ATTRIBUTES` |
| Empty thematic page indexed by Google | Low | Medium — SEO penalty for thin content | Job sets content offline when 0 products match; chain job after sitemap generation |
| Query logic divergence between features | Low | Low-Medium — inconsistent ranking behavior | Single shared `bloomreachAttributeQueryHelper`; any fix applies to all features at once |
| Stale shopper session with disabled flag | Medium | Low | Server-side answer filtering drops answers for inactive fields before any Bloomreach call |
| Credential exposure in logs | Low | High | `filterLogMessage` strips `auth_key` before every log write; verified in service layer tests |
| Loomi enabled without license | Very Low | High — legal/billing risk | `loomiEnabled` is `false` by design; endpoint returns `{available:false}` and calls no external service |

---

## 13. Glossary

| Term | Definition |
|---|---|
| **SFRA** | Salesforce Storefront Reference Architecture — the standard SFCC front-end framework |
| **SFCC** | Salesforce Commerce Cloud — the e-commerce platform |
| **Cartridge** | SFCC's packaging unit for code — similar to a plugin or module |
| **Site Preference** | A named configuration value stored in Business Manager, readable at runtime by SFCC code |
| **Bloomreach Discovery** | AI-driven product search, merchandising, and recommendation engine |
| **fq** | Bloomreach/Solr "filter query" parameter — used to include, exclude, or boost products by attribute |
| **VG / Variation Group** | In SFCC, the colorway-level product (below Base Product, above individual Size/Width variants). Maps to `pid` in Bloomreach. |
| **SKU / Variation** | The sellable unit — specific size + width + color. Maps to `sku` in Bloomreach. |
| **Feature Flag** | A Boolean Site Preference that enables or disables a feature at runtime without a code deployment |
| **Rationale Chip** | A short label on a Boot Finder result card explaining why that product matched (e.g. "Electrical Ready", "Composite Toe") |
| **Inventory Burying** | Pushing low-stock products toward the bottom of results without removing them entirely |
| **JSON-LD** | A structured data format used by Google to understand page content for rich search results |
| **Page Designer** | SFCC's built-in CMS/content tool for building page layouts via drag-and-drop without code |
| **ThematicPageCombination** | A custom object record defining one attribute combination (job + toe + safety) eligible for an auto-generated SEO page |
| **GTM** | Google Tag Manager — used to fire analytics/tracking events from the storefront |
| **Loomi** | Bloomreach's conversational/AI search product — license-gated and not active in this codebase |
