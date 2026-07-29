# Cache Strategy: Bloomreach × SFRA Integration

**Audience:** Backend engineers, DevOps, QA, and managers overseeing the SFRA storefront.  
**Version:** 1.0  
**Last Updated:** 2026-07-29

---

## Table of Contents

1. [Overview and Principles](#1-overview-and-principles)
2. [Feature 1 — Boot Finder](#2-feature-1--boot-finder)
3. [Feature 2 — Product Comparison](#3-feature-2--product-comparison)
4. [Feature 3 — Work Job Landing](#4-feature-3--work-job-landing)
5. [Feature 4 — Thematic Page Generation (Batch Job)](#5-feature-4--thematic-page-generation-batch-job)
6. [Feature 5 — Loomi Conversational Search (Stub)](#6-feature-5--loomi-conversational-search-stub)
7. [Cross-Feature Summary Table](#7-cross-feature-summary-table)
8. [Operational Guidance](#8-operational-guidance)

---

## 1. Overview and Principles

This integration touches **two distinct caching concerns** that must not be conflated:

| Concern | Description |
|---|---|
| **SFCC HTTP page cache** | Determines whether the SFCC storefront serves a cached HTML page to the browser, or calls the controller fresh for every request. |
| **Content-asset online/offline state** | Determines whether a generated content asset (thematic page) is visible to crawlers and shoppers. This is a content-availability toggle, not a time-based HTTP cache. |

### 1.1 Cache Decision Rule

> **A route should be cached if and only if its output is identical for every shopper who requests it with the same URL.**

| Route type | Cacheable? | Reason |
|---|---|---|
| Per-shopper personalised (answers, selections) | No | Output depends on individual shopper state |
| Content-weighted, URL-deterministic | Yes | Output is the same for every visitor at a given URL |
| JSON API stub (status flags only) | Not applicable | Response is a static constant; cache adds no value |
| Batch-job-generated content | Not applicable | Content produced offline, not served via SFCC page cache |

---

## 2. Feature 1 — Boot Finder

### Routes

| Route | Method | Controller File |
|---|---|---|
| `BootFinder-Show` | `GET /BootFinder-Show` | `BootFinder.js → Show` |
| `BootFinder-Results` | `GET /BootFinder-Results?answers=<JSON>` | `BootFinder.js → Results` |

### Cache Policy: **No Cache**

Both Boot Finder routes apply `interactiveCache.applyNoCache` middleware.

**Middleware implementation** (`scripts/middleware/interactiveCache.js`):

```js
res.cachePeriod = 0;
res.cachePeriodUnit = 'minutes';
res.personalized = true;
```

Setting `cachePeriod = 0` and `personalized = true` instructs SFCC's storefront cache infrastructure to never place the response in a shared page cache and to add appropriate `Cache-Control: no-store, no-cache` directives on the HTTP response.

### Why no cache?

**BootFinder-Show** embeds the current set of *active questions* directly in the rendered HTML (as a `data-questions` JSON attribute). The active question list changes whenever a feature flag is toggled in Business Manager. Caching this response would lock shoppers into an outdated question set for the duration of the cache lifetime.

**BootFinder-Results** accepts a `?answers=<JSON>` query string that encodes this individual shopper's answers (job type, shaft height, safety specs, size, width, etc.). The Bloomreach query, size/width availability filter, and rationale chips all derive from those answers. No two shoppers with different answers should receive the same result grid, so shared caching is impossible.

### Client-side state

Although the two server routes are not cached, the client-side state machine (`bootFinder.js`) stores intermediate state in the browser to minimise server round trips:

| State | Storage | Scope |
|---|---|---|
| Entry card dismissed | `sessionStorage` | Browser session (tab) |
| Current question index and answers | In-memory JS object | Until modal closes or page reloads |

No shopper-specific data is persisted beyond the browser session.

### Error state

If `BootFinder-Results` receives a `null` response from Bloomreach (service failure), the controller responds with **HTTP 502** and renders a graceful error template. SFCC's cache layer does not cache non-200 responses by default; no additional configuration is required.

---

## 3. Feature 2 — Product Comparison

### Route

| Route | Method | Controller File |
|---|---|---|
| `Compare-Show` | `GET /Compare-Show?pids=id1,id2,...` | `Compare.js → Show` |

### Cache Policy: **No Cache**

`Compare-Show` applies the same `interactiveCache.applyNoCache` middleware as Boot Finder.

```js
res.cachePeriod = 0;
res.cachePeriodUnit = 'minutes';
res.personalized = true;
```

### Why no cache?

The `?pids=` query string encodes the exact product IDs the shopper selected. While theoretically the same combination of two products would produce the same comparison table, in practice:

1. **Feature-flag-driven row visibility** — which attribute rows appear in the table is controlled by feature flags (`SHAFT_HEIGHT_RANGE`, `WATERPROOF_QUESTION`, `INSULATION_QUESTION`, `REVIEW_COUNT_BOOST`). A cached table generated before a flag is toggled would show stale rows or missing rows.
2. **Mid-session product removal** — the comparison page supports removing a product and re-requesting the same route with fewer IDs via AJAX. Caching would interfere with these dynamic partial refreshes.
3. **Per-session selection state** — product selections live in `sessionStorage` and can differ per shopper and session. Treating the output as shared-cacheable would require a complex cache key that includes all selection parameters, which is equivalent to no caching.

### Client-side state

| State | Storage | Scope |
|---|---|---|
| Selected product IDs | `sessionStorage` (`boot-compare-selection`) | Browser session (tab) |

The `sessionStorage` key is cleared or updated by `compare.js` whenever the shopper adds, removes, or confirms a comparison.

### Error state

A `null` Bloomreach response or a caught exception causes the controller to respond with **HTTP 502** and render `compare/tableError`. Same non-caching behaviour as Boot Finder.

---

## 4. Feature 3 — Work Job Landing

### Route

| Route | Method | Controller File |
|---|---|---|
| `Work-JobLanding` | `GET /Work-JobLanding?jobType=<slug>` | `Work.js → JobLanding` |

### Cache Policy: **Standard SFCC Page Cache**

`Work-JobLanding` applies `cache.applyDefaultCache` middleware, which is the standard SFCC storefront full-page cache middleware used across the rest of the site (PLPs, PDPs, category pages).

```js
server.get('JobLanding', cache.applyDefaultCache, function (req, res, next) { ... });
```

`cache.applyDefaultCache` uses the site-configured default cache lifetime (typically 15–30 minutes, configurable in SFCC Business Manager under **Administration > Sites > [Site] > Cache Settings**).

### Why cacheable?

Work Job Landing pages are **URL-deterministic** and **not shopper-specific**:

- The only variable in the page is the `jobType` query parameter (e.g. `?jobType=electrical`).
- All shoppers requesting `/Work-JobLanding?jobType=electrical` see the same product grid and the same Page Designer editorial zone.
- There is no session state, no answer payload, and no per-shopper filtering.

This makes these pages equivalent to standard category landing pages, which are routinely served from SFCC's page cache.

### Cache key

SFCC's default cache key is derived from the full request URL (hostname + path + query string). Each job-type slug produces an independent cache entry:

| URL | Cache Entry |
|---|---|
| `/Work-JobLanding?jobType=electrical` | Independent entry |
| `/Work-JobLanding?jobType=construction` | Independent entry |
| `/Work-JobLanding?jobType=oil-gas` | Independent entry |

### Cache invalidation

| Trigger | Effect |
|---|---|
| JOB_TYPE feature flag toggled | Cache is **not** automatically cleared. Pages cached before the flag change continue to serve until TTL expires. For immediate effect, manually invalidate the cache in BM under **Administration > Sites > [Site] > Cache Settings > Invalidate**. |
| Bloomreach product data updated | Cached pages reflect the product set at the time of caching. Data changes (new products, price updates) are only reflected after cache expiry or manual invalidation. |
| Page Designer content updated in BM | Same as above — the Page Designer zone is rendered into HTML at cache time. |

**Recommendation:** Align the cache TTL with your standard PLP cache lifetime. If job landing pages are part of a promotional or time-sensitive campaign, shorten the TTL or trigger a manual invalidation after product feed updates.

### Error handling and cache

If the Bloomreach service fails, the controller sets `serviceFailed: true` and renders the page with an error message in the product grid zone. **SFCC's default cache middleware will not cache responses that result from service failures if the HTTP status code is non-200.** However, if the controller still returns HTTP 200 with a partial error state, that page *could* be cached. To prevent this:

- Ensure the template uses a conditional to show the error message only when `serviceFailed` is true.
- Consider returning **HTTP 503 Service Unavailable** instead of 200 when `bloomreachResponse` is null, which SFCC will not cache.

---

## 5. Feature 4 — Thematic Page Generation (Batch Job)

### Job

| Job Step | Script | Trigger |
|---|---|---|
| `GenerateThematicPages` | `int_ariat_bloomreach/cartridge/scripts/jobs/GenerateThematicPages.js` | Nightly SFCC Job Schedule (recommended: 2:00 AM, chained before sitemap generation) |

### Cache Policy: **Not Applicable — Batch Content Generation**

Thematic Page Generation is a **server-side batch job**, not an HTTP request handled by a controller. It does not participate in SFCC's page cache at all.

Instead, this feature uses SFCC **Content Asset online/offline state** as its availability control mechanism:

| State | Condition | Effect |
|---|---|---|
| **Online** | Bloomreach returns ≥ 1 matching product for a combination | Content asset is published; page is crawlable and shoppers can land on it |
| **Offline** | Bloomreach returns 0 matching products for a combination | Content asset is taken offline; page returns 404 or is excluded from sitemap |

### Why no HTTP cache concern?

Thematic page content assets are created and updated during the nightly job run. The job writes JSON-LD `ItemList` structured data markup into the content asset body. When a shopper requests a thematic page URL:

1. The storefront controller (assumed to be an existing PLP or content page controller, not a new controller added by this integration) reads the content asset.
2. That controller uses `cache.applyDefaultCache` (standard SFCC page cache behaviour).
3. The content asset's body is rendered at cache-fill time.

Because the batch job refreshes content assets nightly, and the standard SFCC page cache respects the TTL, data is at most one cache TTL stale after the nightly job completes.

### Stale content risk and mitigation

| Risk | Mitigation |
|---|---|
| A combination that had products last night has zero products today | Job sets asset offline; page is removed from sitemap on next sitemap generation run |
| Cached HTML of an online page served after the asset goes offline | Standard cache TTL expiry handles this; for immediate removal, trigger manual cache invalidation |
| Job fails mid-run (service error per combination) | Job logs error per combination but continues; `errors > 0` in the job status report signals which combinations to investigate. Successfully processed combinations are not affected. |

### Dry-run mode

The job supports `dryRun=true` parameter. In dry-run mode, the job logs what it *would* write without making any changes to content assets. Use this to verify combination outputs in staging before a production run.

### Recommended job chain

```
[Product Feed Sync] → [GenerateThematicPages (dryRun=false)] → [Generate Sitemap]
```

Running `GenerateThematicPages` before the sitemap job ensures the sitemap reflects the current online/offline state of all thematic pages.

---

## 6. Feature 5 — Loomi Conversational Search (Stub)

### Route

| Route | Method | Controller File |
|---|---|---|
| `Loomi-Query` | `GET /Loomi-Query?q=<text>` | `Loomi.js → Query` |

### Cache Policy: **No Cache Configured (Not Applicable in Current Form)**

The Loomi controller is a **feature-flagged stub**. In its current (only live) state it always returns:

```json
{ "available": false }
```

This is a static JSON constant — there is no dynamic content to cache. No cache middleware is applied to this route because it is not a page and the response is trivially small and stable.

### When Loomi is implemented (future)

When the Loomi license is approved and the feature is built, the cache policy will need to be revisited. Based on the documented intended request shape:

- The `?q=` parameter is a free-text conversational query (e.g. `"waterproof boots for electrical work under $150"`).
- The NLU layer interprets the query into a structured attribute map, which is then passed to the same `queryByAttributes` path as Boot Finder.
- The result set is personalised to the query and potentially to the user context.

**Recommendation for future Loomi implementation:** Apply `interactiveCache.applyNoCache`, identical to Boot Finder Results. The NLU interpretation of a free-text query is not repeatable across shoppers or sessions in a way that makes shared-cache safe.

---

## 7. Cross-Feature Summary Table

| Feature | Route(s) | Cache Middleware | Cache Period | Reason |
|---|---|---|---|---|
| **Boot Finder — Show** | `GET /BootFinder-Show` | `interactiveCache.applyNoCache` | 0 minutes (no-store) | Active question list changes with feature flags |
| **Boot Finder — Results** | `GET /BootFinder-Results?answers=<JSON>` | `interactiveCache.applyNoCache` | 0 minutes (no-store) | Output is unique per shopper's answer payload |
| **Product Comparison** | `GET /Compare-Show?pids=id1,id2,...` | `interactiveCache.applyNoCache` | 0 minutes (no-store) | Flag-gated rows; dynamic mid-session product removal |
| **Work Job Landing** | `GET /Work-JobLanding?jobType=<slug>` | `cache.applyDefaultCache` | Site default (e.g. 15–30 min) | URL-deterministic, not shopper-specific |
| **Thematic Page Generation** | Batch job (no HTTP route) | Not applicable | Not applicable | Content availability controlled by asset online/offline state |
| **Loomi (stub)** | `GET /Loomi-Query?q=<text>` | None applied | Not applicable | Static constant response; no cache value |

### HTTP Cache-Control headers produced

| Feature | `Cache-Control` (approximate) |
|---|---|
| Boot Finder (both routes) | `no-store, no-cache, must-revalidate` |
| Product Comparison | `no-store, no-cache, must-revalidate` |
| Work Job Landing | `public, max-age=<site-ttl-in-seconds>` |
| Loomi stub | _(no explicit header set; SFCC default for JSON responses applies)_ |

---

## 8. Operational Guidance

### 8.1 Toggling a feature flag on Work Job Landing

Work Job Landing uses the standard page cache. When you toggle a feature flag (e.g. `JOB_TYPE`):

1. The new flag value takes effect **on the next request after cache expiry** or after a manual cache invalidation.
2. To force immediate effect: **Administration > Sites > [Site] > Cache Settings > Invalidate Cache** in Business Manager.

### 8.2 Forcing Boot Finder / Compare to reflect a flag change

Because Boot Finder and Compare use no-cache (`cachePeriod = 0`), feature flag changes take effect **on the next browser request** with no action required. There is no cached page to invalidate.

### 8.3 Thematic page not appearing in sitemap

1. Confirm the nightly job ran successfully (check job log in BM under **Administration > Operations > Jobs**).
2. Confirm the content asset is **Online** (BM > **Merchant Tools > Content > Content Assets > work-thematic-pages**).
3. Confirm the sitemap generation job ran *after* `GenerateThematicPages`.
4. If content asset is offline, check whether the Bloomreach product feed contains matching products for that combination.

### 8.4 Stale product data on Work Job Landing

If product prices, availability, or rankings changed but the cached page still shows old data:

1. Wait for the natural cache TTL to expire, **or**
2. Invalidate the specific URL from BM cache management.

For automated invalidation aligned with product feed syncs, trigger a cache purge via SFCC's Storefront Cache invalidation API as part of your feed-sync pipeline.

### 8.5 CDN layer (if applicable)

If a CDN sits in front of the SFCC storefront:

| Route | Expected CDN behaviour |
|---|---|
| Boot Finder (Show + Results) | CDN must respect `Cache-Control: no-store` and **never** cache these responses. Verify CDN passthrough rules for `no-store` responses. |
| Product Comparison | Same as Boot Finder — no CDN caching. |
| Work Job Landing | CDN may cache per its own TTL rules, provided it keys by full URL (including `?jobType=` param). Ensure CDN purge is triggered alongside BM cache invalidation. |
| Loomi stub | No CDN caching expected for API-style JSON endpoints. |
