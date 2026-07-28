# Technical Design: Bloomreach SFRA Integration

## 1. Purpose
This repository implements a Salesforce Commerce Cloud (SFRA) integration with Bloomreach Discovery to power search-driven user experiences, including Boot Finder, Product Comparison, Work Job Landing pages, Thematic SEO generation, and Loomi feature gating.

## 2. Scope
In scope:
- Server-side integration with Bloomreach Discovery APIs.
- SFRA controllers and templates for search-driven storefront experiences.
- Shared query/filter construction and feature-flag-driven behavior.
- Batch generation of thematic content assets from merchandiser-defined combinations.

Out of scope:
- Core SFRA platform internals.
- Bloomreach index/feed ownership and upstream data production.
- External CDN, infrastructure, and deployment pipeline implementation details.

## 3. High-Level Architecture
The solution is split across two cartridges:

1. `int_ariat_bloomreach`
   - Integration layer for Bloomreach communication.
   - Shared helpers for identity mapping, feature flags, logging, query building.
   - Job step for thematic page generation.

2. `app_ariat_search_experience`
   - Storefront controllers and templates.
   - Feature-specific presentation and request orchestration (Boot Finder, Compare, Work).
   - Client-side interaction for dynamic experiences.

## 4. Key Components
### 4.1 Bloomreach Service Layer
- **File:** `cartridges/int_ariat_bloomreach/cartridge/scripts/services/bloomreachService.js`
- Creates service `bloomreach.http.search` via `dw/svc/LocalServiceRegistry`.
- Builds GET requests using site preferences (`account_id`, `auth_key`, `domain_key`).
- Redacts `auth_key` from logs.
- Parses and returns JSON payloads.
- Throws on transport/HTTP failure; callers decide fallback behavior.

### 4.2 Shared Query Builder
- **File:** `cartridges/int_ariat_bloomreach/cartridge/scripts/helpers/bloomreachAttributeQueryHelper.js`
- Builds reusable `fq` fragments for hard filters and soft boosts.
- Supports range and scalar attributes.
- Adds inventory burying rule when enabled.
- Executes attribute-based queries and applies sort behavior controlled by feature flags:
  - Rating/review-based ranking.
  - Optional sales-rank tiebreak.

### 4.3 Feature Flags
- **Files:** `featureFlags.js`, `bloomreachConstants.js`
- Centralized logical flag mapping to SFCC site preference IDs.
- Controllers and jobs consume feature checks via one helper.
- Prevents direct preference lookups scattered across code.

### 4.4 Identity and Domain Mapping
- **Constants:** `pid` treated as Variation Group identity; `sku` as Variation identity.
- Shared helpers enforce consistent mapping across all features.

## 5. Feature Flows
### 5.1 Boot Finder
- **Controller:** `BootFinder.js`
- `Show` route renders active question configuration.
- `Results` route accepts answer payload, validates against active fields, resolves shaft-height mapping, runs attribute query, applies size/width availability filtering, and returns results grid.
- Error behavior: returns HTTP 502 with fallback error template when service fails.

### 5.2 Product Comparison
- **Controller:** `Compare.js`
- Accepts comma-separated product IDs (`pids`) from request.
- Enforces min/max selection limits.
- Fetches products via shared Bloomreach lookup helper.
- Renders comparison table or error template with HTTP 502 when unavailable.

### 5.3 Work Job Landing
- **Controller:** `Work.js`
- Resolves job type from slug/query.
- Requires job-type flag and valid mapping.
- Reuses shared attribute-query path to avoid duplicate filter logic.
- Integrates optional Page Designer content page by naming convention.
- Uses standard page caching middleware.

### 5.4 Thematic Page Generation Job
- **Job Script:** `GenerateThematicPages.js`
- Reads enabled `ThematicPageCombination` custom objects.
- Skips combinations blocked by feature gates.
- Queries Bloomreach using reusable attribute logic.
- Creates/updates SFCC Content assets under `work-thematic-pages`.
- Sets content online/offline based on product availability and writes JSON-LD ItemList markup.
- Supports dry-run mode and structured status reporting.

## 6. Data and Configuration Dependencies
### 6.1 Site Preferences
Required custom preferences include:
- Bloomreach credentials (`bloomreachAccountId`, `bloomreachAuthKey`, `bloomreachDomainKey`).
- Feature toggles (mapped in `bloomreachConstants.FEATURE_FLAGS`).

### 6.2 Bloomreach Index Fields
The integration assumes presence of fields such as:
- `job_type`, `Toe_Shape`, `safety_specs`, `shaft_height_in`, `bvRating`, `bvReviewCount`, `sales_rank_bucket`.

### 6.3 SFCC Content and Custom Objects
- Custom object type: `ThematicPageCombination`.
- Content folder: `work-thematic-pages`.
- Generated content IDs follow `work-{combinationKey}`.

## 7. Non-Functional Design
### 7.1 Reliability and Fallbacks
- Service failures are handled with graceful rendering fallbacks (error templates, null-return pattern, status codes).
- Logging includes feature context and request parameters (with credential redaction).

### 7.2 Performance and Caching
- Interactive/stateful routes use short/no-cache middleware to avoid stale personalized state.
- Content-heavy pages use default caching middleware.
- Query pagination is bounded (`rows`, `start`) per use case.

### 7.3 Security
- Sensitive query values (`auth_key`) are masked from service logs.
- No credentials are hardcoded; all secrets are sourced from SFCC preferences.

## 8. Testing and Quality
- Linting: `npm run lint`
- Unit tests: `npm test`
- Design expectation: shared helper coverage for filter composition and controller behavior under both success and failure scenarios.

## 9. Operational Considerations
- Thematic generation should run in a job chain aligned with sitemap generation so online/offline state is reflected in crawl outputs.
- Feature rollout is controlled through site preferences for safe incremental activation.
- Monitoring should focus on Bloomreach service failures and job error counts.

## 10. Risks and Mitigations
- **Risk:** Upstream attribute/feed inconsistencies can degrade relevance or create empty thematic pages.  
  **Mitigation:** Feature gating and online/offline toggling in job flow.

- **Risk:** Query logic divergence between features.  
  **Mitigation:** Shared `bloomreachAttributeQueryHelper` as single source for attribute-query construction.

- **Risk:** Runtime dependency on external service availability.  
  **Mitigation:** Graceful fallback templates, structured logging, and bounded request shapes.
