# Console Remediation Runbook — Bloomreach Discovery

**Audience:** Merchandising ops, Bloomreach account/implementation team, eComm, Engineering (feed owners)
**Scope:** every architecture finding that **cannot be fixed in this repository** — the work lives in the Bloomreach console, the product feed, or a business decision. Code-layer findings and their fixes are tracked in `TECHNO_FUNCTIONAL_GUIDE.md` and `CACHE_STRATEGY.md`.
**Version:** 1.0
**Last Updated:** 2026-07-30

---

## How to use this document

Each section below is one finding, and each is self-contained: **who owns it**, **what is true today**, **the steps**, **how to verify**, and **what it unblocks**. Sections can be done in any order except where a Prerequisite says otherwise, but see [§0.2 Sequencing](#02-sequencing) for the order that gets the most value soonest.

### 0.1 A caution about navigation paths

Bloomreach's console labels and menu structure vary by account tier and change between releases. Every navigation path below is written as **`Section > Subsection`** and should be treated as *where to look*, not a guaranteed literal path. Where a step depends on an entitlement your account may not have, that is called out explicitly. **Confirm the path with your Bloomreach account representative before assuming a feature is missing** — an absent menu item usually means an entitlement, not a defect.

Nothing in this runbook requires a code deployment. Nothing in it should be done by an engineer *instead of* the owning team — the whole point of these findings is that console configuration and code have been drifting apart.

### 0.2 Sequencing

Do these first, in this order. They are cheap, they unblock the others, and two of them change the answer to questions later in the list:

1. **[§12](#12--feed-integrity-sign-off) Feed sign-off checklist** — establishes what data is actually trustworthy. Everything else is built on it.
2. **[§13.9](#139--pixel-completeness-audit-bt-01) Pixel completeness audit (BT-01)** — the report already exists and has never been read. It tells you whether the behavioural signal feeding §9 is sound.
3. **[§3](#3--global-inventory-bury-resolve-the-duplicate) Resolve the duplicate inventory bury** — there are now two mechanisms doing this. Pick one before either is tuned.
4. **[§6](#6--recommendation-engine-of-record-d-02) Engine-of-record decision** — a business decision that blocks widget work and is getting more expensive each sprint.
5. **[§5](#5--five-hidden-facets-fix-at-source) Fix the five hidden facets at source** — the largest genuine data-quality win available.

Then: §7/§8 (audiences), §9 (omni_score), §2 (normalization gaps), §4 (rule audit), §10/§11 (governance).

### 0.3 What this runbook deliberately does not tell you to do

- **Do not add more console configuration to close a finding.** Several findings exist *because* configuration outran activation. More rules, more facets, and more widgets make the audit worse, not better.
- **Do not enable 1:1 personalization** (`personalizationOneToOneEnabled` in SFCC) as part of any step here. It is gated on two confirmations outside engineering — see [§13.4](#134--11-personalization-two-gates-before-any-enablement).
- **Do not un-hide a facet before its underlying data is fixed.** The Always-Hide settings are correct triage. They are the containment, not the problem.

---

## 1 — Failover and graceful degradation

**Owner:** Engineering (SFCC), with one Bloomreach-side confirmation
**Console work:** minimal — this finding is mostly code, already partly addressed

**Today:** Boot Finder, Work Job Landing, and Compare now fall back to SFCC native product search when Bloomreach is unreachable (`helpers/dwSearchFallbackHelper`). **Free-text site search and autosuggest have no fallback** — the finding's primary surface remains uncovered, because those routes are not served by this cartridge.

### Steps

1. Establish who owns free-text search and autosuggest. `BLOOMREACH_CONSOLE_CONFIGURATION.md` §6 flags that this cartridge scaffolds those call shapes but has no live caller — so a separate integration is serving them today, or nothing is.
2. With that team, confirm what happens on a Bloomreach timeout for search and autosuggest. If the answer is "an error page" or "an empty result set," that is the finding, still open, on the highest-traffic surface.
3. **In the Bloomreach console:** confirm the service timeout and error-response behaviour configured for your account under **Settings > API / Service Configuration**, and reconcile it against the SFCC Service Profile timeout (`TECHNO_FUNCTIONAL_GUIDE.md` §8.2). A Bloomreach-side timeout longer than the SFCC-side one means SFCC gives up first and the shopper waits the full SFCC timeout every time.

### Verify

Ask for a staged outage test (block the Bloomreach endpoint at the network layer in a lower environment) and observe search, autosuggest, PLP, and PDP. "We believe it degrades gracefully" is not verification — this finding exists because no one had tested it.

### Unblocks

Nothing else in this list. But it is the single finding whose failure mode is *total*, so it should not sit behind the merchandising work.

---

## 2 — Search intent normalization: closing the gap-detection loop

**Owner:** Merchandising ops
**Prerequisite:** none

**Today:** 72 search-normalization rules exist and are real merchandising investment. But every entry is a hand-authored equivalence, so coverage scales with merchandiser effort, not with what shoppers actually type. There is no mechanism that tells you *which* queries are missing a rule.

The fix is not "write more synonyms." It is to build a repeatable loop that tells you which synonyms to write.

### Steps

1. In **Reports > Search Performance** (labels vary; look for null-search, zero-result, or low-CTR reporting), export the trailing 90 days of queries with:
   - zero results returned, and
   - non-zero searches but zero clicks.
2. Sort by search volume descending. Take the top 50.
3. For each, check whether an existing normalization rule *should* have caught it. Categorise into:
   - **Missing synonym** — a term shoppers use that the catalogue doesn't. Write the rule.
   - **Missing product** — the catalogue genuinely has no match. Route to merchandising/buying, not to a rule.
   - **Broken attribute** — the query targets a facet from [§5](#5--five-hidden-facets-fix-at-source). Do not paper over this with a synonym; it will mask the data defect.
4. Set this up as a **recurring monthly review** with a named owner. A one-time sweep re-creates the same gap within two quarters.
5. Record the review date and the number of rules added in the rule name or description field — see [§11](#11--rule-lifecycle-governance) for the naming convention.

### Verify

Month over month, the zero-result rate for the top-50 query set should fall, and the list should turn over (new queries appearing, old ones resolved). If the same queries keep reappearing, they are category 2 or 3, not synonym gaps.

### Unblocks

Nothing. But it converts a static 72-rule corpus into a maintained one, which is the actual finding.

---

## 3 — Global inventory bury: resolve the duplicate

**Owner:** Merchandising ops + Engineering, jointly — this one needs both in the room
**Prerequisite:** none. Do this early; it changes what "fixed" means for the code.

**Today: there are now two mechanisms burying low-stock products, and they do not know about each other.**

| Mechanism | Where | Shape |
|---|---|---|
| Global recommendation-scope bury on `inventory = LOW`, strength 100 | Bloomreach console (the one enabled global rule) | Categorical flag, computed upstream, opaque to Bloomreach |
| `inventory_level` boost fragment | SFCC, via `lowStockBuryThreshold` site preference (`helpers/inventoryBuryHelper`) | Numeric threshold, applied per-query as an `fq` fragment |

The SFCC-side fragment was recently repaired (it previously corrupted every query it was added to). Repairing it made the overlap *live* rather than theoretical. Two rules demoting the same products by different definitions of "low" will compound unpredictably.

### Steps

1. **Decide which one is the system of record.** The recommendation, absent other constraints: keep the **console rule** and disable the SFCC fragment. Rationale — the console rule is visible to merchandisers, editable without a deploy, and applies to surfaces the cartridge doesn't own. The SFCC fragment only applies to the four routes this cartridge serves.
2. If keeping the console rule: set `lowStockBuryThreshold` to **unset/null** in SFCC (**Administration > Sites > [Site] > Site Preferences > Custom Preferences**). The helper returns `null` and appends nothing — no deploy needed.
3. If keeping the SFCC fragment instead: disable the global console rule under **Merchandising > Ranking Rules > Global**, and confirm the numeric threshold matches what `inventory = LOW` meant upstream.
4. Either way, **document what `inventory = LOW` actually means** — which upstream system computes it, at what threshold, and how often it refreshes. The finding notes this is computed upstream and opaque to Bloomreach; that opacity is the real risk, not the rule itself.
5. Ask the Bloomreach account team: **do `fq` boosts affect scoring on this account, or is `fq` a pure filter?** (This is checklist item 6b in `BLOOMREACH_CONSOLE_CONFIGURATION.md`.) If `fq` is a pure filter — the standard Solr semantic — the SFCC fragment contributes nothing to ranking and step 1 answers itself. **This same answer determines whether Boot Finder's "soft-boosted" questions are actually hard-filtering products out**, so get it regardless of which mechanism you keep.

### Verify

Run a query in **Preview** that returns a known low-stock product, with the surviving mechanism enabled and then disabled. The product's position should move. If it doesn't move under either configuration, neither mechanism is working and step 5 is your answer.

### Unblocks

Any future tuning of inventory-aware ranking. Do not tune before the duplicate is resolved — you will be tuning against an unknown baseline.

---

## 4 — Category rules: audit the manual PID-pinning

**Owner:** Merchandising ops (the two editors holding 120 and 97 rules respectively)
**Prerequisite:** [§11](#11--rule-lifecycle-governance) naming convention agreed, so the audit output is durable

**Today:** 243 category rules, 99% enabled. 105 of them (43%) pin specific products to specific numeric slots; 34 more use PID-boost. This is hand-curated placement at production scale. That is not a defect — but it is being *described* internally as "AI-assisted ranking with light human oversight," and it isn't. The accurate description is "AI-default, manually overridden per-SKU wherever merchandisers intervened."

The risk is not the pinning. It is that a pinned PID has no expiry: when the product is discontinued, the slot silently degrades.

### Steps

1. Export the full rule set (**Merchandising > Ranking Rules > Export**). You need rule name, scope, type, editor, last-edited date, and the PID list for slot-lock and boost rules.
2. Cross-reference every pinned PID against the current catalogue feed. Flag any that are:
   - no longer in the feed at all,
   - out of stock for more than 30 days, or
   - offline/unpublished.
3. For each flagged rule, choose one:
   - **Delete** — the promotion is over.
   - **Repin** — swap in the successor product.
   - **Convert to attribute-based** — if the pin exists to surface a *type* of product rather than that specific SKU, an attribute boost survives catalogue turnover and a PID pin doesn't. This is the highest-value outcome; prefer it wherever the intent allows.
4. For every rule you keep, set an **end date** where the console supports scheduling. A pin with no end date is a permanent manual override that nobody will revisit.
5. Record the audit date. Repeat quarterly.

### Verify

After the pass, no enabled slot-lock rule should reference a PID absent from the current feed. That is a concrete, checkable state — make it the acceptance criterion.

### Unblocks

Makes [§11](#11--rule-lifecycle-governance) tractable. A 412-rule base can't be governed until the dead weight is out.

---

## 5 — Five hidden facets: fix at source

**Owner:** Engineering (feed) primary; Merchandising ops validates and un-hides
**Prerequisite:** [§12](#12--feed-integrity-sign-off) — you need the field inventory before you can fix fields

**Today:** five facets are set to Always-Hide because their data is broken. Hiding them was correct triage and good operational hygiene. **None of the underlying defects have been fixed**, and the hiding means nobody sees them degrade further.

| Facet | Defect | Fix layer |
|---|---|---|
| `Safety_Filter` | Serialization defect — corrupted array values | Feed pipeline |
| `safety_features` | 0% filled | Source data / PIM |
| `Waterproof` | 46% fill, 8 inconsistent spellings | Source data normalization |
| `PRODUCT_USAGE` | Fill rate unverified | Investigate first |
| `Technology_Filter` | Duplicate of an unfaceted `Technology` field | Feed mapping |

### Steps

Work them in this order — they are not equally hard, and two are nearly free.

1. **`Technology_Filter` (easiest).** This is a mapping duplicate, not a data defect. Decide which of the two fields is canonical, delete the other from the feed mapping, and facet the survivor. No source-data work required.
2. **`Waterproof` (highest value).** Eight spellings for what should be a boolean. Normalize at the source (PIM), not in the feed transform — a transform-layer fix leaves the source dirty and the next integration inherits it. Then re-drive the fill rate: 46% means more than half the catalogue has no value, which is a separate problem from the spellings and needs the buying/product-data team, not engineering.
3. **`PRODUCT_USAGE`.** Verify the fill rate before scheduling any work — it is currently listed as unverified, so it may be fine. Pull the fill percentage from **Catalog > Attributes > [field]** and route accordingly.
4. **`Safety_Filter`.** A serialization defect producing corrupted array values is a feed-pipeline bug. It needs an engineer with access to the feed generation code, a reproduction against a known-bad SKU, and a fix plus a regression check.
5. **`safety_features`.** 0% fill means the field is mapped but nothing populates it. Confirm whether the source data exists at all before building anything — this may be a field that should be removed rather than fixed.

### Un-hiding, once fixed

For each facet, in order:

1. Confirm fill rate above your agreed threshold (recommend **≥ 90%** for a primary navigation facet) in **Catalog > Attributes**.
2. Confirm value consistency — no spelling variants, no nulls presenting as empty strings.
3. Re-index and validate in **Preview** before publishing.
4. Change from Always-Hide to visible under **Merchandising > Facets**.
5. Watch facet engagement for two weeks. A facet with near-zero interaction after un-hiding is either still broken or genuinely not useful — both are worth knowing.

### Verify

Fill rate and value-distinct-count, per facet, before and after. Screenshot both. This is the finding where "we fixed it" is most likely to be asserted without evidence.

### Unblocks

`safety_specs`-based thematic pages. The `isEligible` gate in `GenerateThematicPages.js:60` currently skips every `safety_specs` combination while this defect is in flight — that gate is a containment for exactly this problem, and can be relaxed once the data is trustworthy.

---

## 6 — Recommendation engine of record (D-02)

**Owner:** eComm leadership — this is a decision, not a configuration task
**Prerequisite:** none. This is the highest-leverage item in the runbook.

**Today:** recommendations run on a mixed Einstein + Bloomreach basis in production, with **no declared engine of record**. 105 widgets exist. Widget count measures configuration surface area, not coherence — and the recent integration work added four more Bloomreach-based recommendation surfaces (PDP strip, Category rail, Thematic Page strip, Work Job Landing strip) **without reconciling any of them against Einstein**. The finding has widened, not narrowed.

### Steps

1. **Inventory what is live.** Build one table: every recommendation placement on the site, which engine serves it, which team owns it, and when it was last reviewed. Expect this to take a week and to surface placements nobody remembers configuring.
2. **Decide.** The options are genuinely three, and the third is legitimate:
   - **Bloomreach as engine of record.** Einstein retires. Consolidates behavioural signal into one engine, which is what makes the `omni_score` work in [§9](#9--omni_score_-behavioural-signals-put-them-to-work) worth doing.
   - **Einstein as engine of record.** Bloomreach recommendation widgets retire; Bloomreach remains the search and category ranking engine. Coherent, and cheaper if Einstein placements are outperforming.
   - **Deliberate split by surface** — e.g. Einstein on cart/checkout, Bloomreach on search-adjacent surfaces. This is a valid architecture **only if written down and enforced**. Undeclared splitting is the current state and is what the finding objects to.
3. **Write the decision down**, with the date and the decider, somewhere both teams read. The absence of this document is the finding.
4. **Retire the losing placements on a schedule.** Two engines running in parallel indefinitely is the expensive outcome — you pay for both, and attribution stays unresolvable.
5. Until the decision lands, **stop adding recommendation surfaces on either engine.** Every new one increases the migration cost.

### Verify

A named owner can answer "which engine ranks this placement, and why?" for any placement on the site, without looking it up. Today, nobody can.

### Unblocks

[§9](#9--omni_score_-behavioural-signals-put-them-to-work) (behavioural signal is only worth investing in on the winning engine), widget cleanup, and any credible recommendation-performance measurement. Attribution across two unreconciled engines is not measurable.

---

## 7 & 8 — Audiences: wire the seven that already exist

**Owner:** Merchandising ops
**Prerequisite:** read the cache constraint below before configuring anything

**Today:** seven Merchandising Audiences are defined in the console — including "Cold Weather States," a genuine geo-segment configured months ago — and **zero of 412 rules reference any of them**. §8's campaign/UTM audiences are the same finding in a marketing frame: definitions with no consumer.

This is the cheapest available win in the entire assessment, and it is consistently mis-scoped as new segmentation work. It is not. The segments exist. They need a rule.

### The cache constraint — read this first

Wiring an audience into a rule that serves a **cached** surface will have **no visible effect**. The storefront serves through a full-page cache keyed per query; the cached response cannot branch on visitor identity at render time. This is not a Bloomreach limitation and no console setting fixes it.

Two consequences:

- **Surfaces where an audience-conditioned rule works today:** the uncached fragment routes (`Work-PersonalizedStrip`, `Product-PersonalizedStrip`, `Search-PersonalizedRail`, `ThematicPage-PersonalizedStrip`) and the Page Designer browse-cookie content zones, which sit outside the cached page shell.
- **Surfaces where it will not work until the cache is variant-aware:** search ranking and category ranking — i.e. the main grid on every PLP and search results page.

Configure against the first list. Do not conclude the audience feature is broken when a rule targeting the second list does nothing.

### Steps

1. Pick **one** audience with an obvious merchandising thesis. "Cold Weather States" is the right first candidate — the segment is real, the merchandising implication (insulated and waterproof product) is uncontroversial, and it is seasonally verifiable.
2. Under **Merchandising > Ranking Rules**, create a rule scoped to a surface from the *works today* list above, with the audience as its condition.
3. Keep the first rule deliberately small — a boost on one attribute, not a slot-locked layout. You are testing whether the wiring works end to end, not designing a segment experience.
4. Validate in **Preview** with the audience simulated, if your console supports audience simulation. If it does not, validate in a lower environment before publishing.
5. Publish, then **measure for two weeks** before adding a second rule. The finding is that nobody has ever confirmed audience-conditioned merchandising works on this account. One confirmed rule answers that.
6. Only then extend to the remaining six audiences.
7. **"Paid Work AB Test" audience:** this has existed unused since 2023. Either give it a live test or delete it — a dormant audience with a test-shaped name will keep being mistaken for evidence that A/B testing runs here. It doesn't; any per-visitor variant fragments the cache key the same way audience-conditioned ranking does.

### Verify

A rule that references an audience, is enabled, is published, and demonstrably changes what a member of that audience sees on a non-cached surface. Take the screenshot — this is the first time it will have been true.

### Unblocks

Tier 2 of the tiered caching model ([§13.2](#132--tier-2-is-already-built-and-unused)). It is not new work; it is activation of what is already configured, and it should be costed and communicated that way.

---

## 9 — `omni_score_*`: behavioural signals, put them to work

**Owner:** Merchandising ops
**Prerequisite:** [§13.9](#139--pixel-completeness-audit-bt-01) (the audit tells you whether these scores are trustworthy) and ideally [§6](#6--recommendation-engine-of-record-d-02)

**Today:** four Bloomreach-native decayed engagement facets exist — `omni_score_atc_decayed`, `omni_score_conv_decayed`, `omni_score_revenue_decayed`, `omni_score_views_decayed`. They are computed server-side and already exposed as browsable facets. **No rule in the 412 reviewed references any of them.** They are available and almost certainly not active.

These are worth understanding correctly, because they are frequently conflated with personalization: they are **aggregate, product-level** scores — the crowd's behaviour improving everyone's results equally. They are cache-safe by construction and identical for every visitor. Ariat already has a working instance of behaviour-informed ranking; it is simply not wired into a rule.

### Steps

1. **Confirm they are populated**, not just present. In **Catalog > Attributes**, check the fill rate and value distribution for all four. A facet exposed but unpopulated is a third instance of the same failure shape this assessment keeps finding.
2. **Read [§13.9](#139--pixel-completeness-audit-bt-01) before tuning.** These scores are computed from pixel events. If Safari mobile is undercounting `product_view` and `cart_add` — which it structurally is, since only `purchase` has server-to-server protection — then `omni_score_views_decayed` and `omni_score_atc_decayed` are **skewed toward non-Safari behaviour**. On a ~70% mobile traffic share, that is not a rounding error. Know the size of the skew before you rank on it.
3. Start with **`omni_score_conv_decayed`** or **`omni_score_revenue_decayed`** rather than views or add-to-cart. Both are closer to the purchase event, which has S2S protection and is therefore the least ITP-lossy signal you have.
4. Create one global or category-scoped ranking rule applying a **modest** boost. Do not start at strength 100 — you are layering a new signal onto 243 category rules, many of which pin specific products.
5. Watch for interaction with the slot-locked rules from [§4](#4--category-rules-audit-the-manual-pid-pinning). A pinned slot overrides the boost; the boost will only be visible in the unpinned positions.

### Verify

Compare the top 20 results for five representative category queries before and after, in Preview. If nothing moves, either the facet is unpopulated (step 1) or pinning is absorbing the effect (step 5).

### Unblocks

Genuine behaviour-informed ranking without touching the cache architecture — the only personalization-adjacent improvement available that is **not** blocked by the cache topology. For that reason it is the best value in this runbook after the audiences.

---

## 10 — Rule publishing vs. cache invalidation

**Owner:** Merchandising ops + DevOps
**Prerequisite:** none

**Today:** boost, bury, hide, schedule, and preview/publish all work and need no engineering. The blind spot is that **none of them can act on cache-invalidation timing.** A rule published to production is live in Bloomreach within minutes but does not reach the shopper until the page-cache TTL expires. There is no code fix for this; it is an operational sequence.

### Steps — the publish procedure

Adopt this as the standard procedure for any rule change intended to be visible immediately:

1. Publish the rule in the Bloomreach console.
2. Confirm it is live in Bloomreach via **Preview** against production.
3. Invalidate the affected surface in SFCC: **Administration > Sites > [Site] > Cache Settings > Invalidate**. Invalidate the specific URLs where possible rather than the whole site — a full invalidation causes a cold-cache traffic spike to origin.
4. If a CDN sits in front of SFCC, trigger its purge too. SFCC invalidation does not purge the CDN.
5. Verify as an anonymous visitor in a clean browser session, not in the session you published from.

### Steps — reduce how often step 3 is needed

1. **Know your TTL.** Get the current page-cache lifetime from **Cache Settings** and publish it where merchandisers can see it. Most "the rule isn't working" escalations are a merchandiser checking inside the TTL window.
2. **Schedule rules to activate off-peak**, so the natural TTL expiry does the work and no manual invalidation is needed.
3. For time-critical merchandising (a promotion going live at a specific minute), **plan the invalidation as part of the launch**, not as a reaction when someone notices the old content.

### Verify

Time a rule change end to end — publish to shopper-visible — and write the number down. It is currently unmeasured, and it is the number every merchandiser is implicitly guessing at.

### Unblocks

Nothing technically, but it removes the most common source of false "Bloomreach is broken" reports, which is worth the hour it takes.

---

## 11 — Rule lifecycle governance

**Owner:** Merchandising ops, with a named accountable owner
**Prerequisite:** [§4](#4--category-rules-audit-the-manual-pid-pinning) done first — govern a cleaned rule set, not a cluttered one

**Today:** 412 rules and counting, concentrated in two to four editors. Preview/production separation and scheduling genuinely work. Traceability exists — rules are named and carry "last edited by." What does not exist: **deprecation, ownership handoff, or conflict detection between overlapping query-scoped rules.** Nothing prunes.

### Steps

1. **Adopt a naming convention.** Retrofit it during the [§4](#4--category-rules-audit-the-manual-pid-pinning) audit rather than as a separate pass. Suggested shape:

   ```
   [scope]-[intent]-[owner-initials]-[YYYYMM]
   e.g.  cat-boost-waterproof-jd-202607
   ```

   The date is the important part. It makes staleness visible at a glance, which no current field does.

2. **Require an end date** on any rule created for a promotion, season, or campaign. If the console supports scheduled deactivation, use it; a rule that expires itself is worth more than one on a review list.
3. **Quarterly review**, with a fixed owner and a fixed agenda:
   - rules not edited in 12+ months — justify or delete,
   - rules whose owner has left the team — reassign or delete,
   - rules referencing PIDs no longer in the feed — see [§4](#4--category-rules-audit-the-manual-pid-pinning),
   - overlapping query-scoped rules — the console has no conflict detection, so this must be a human pass. Sort by scope and read adjacent rules together.
4. **Set a soft cap.** Not a hard limit, but a number that triggers a pruning review when crossed. If 412 is uncomfortable, the cap is below 412 and the next review is now.
5. **Ownership handoff as an offboarding step.** Two editors hold roughly half the rule base. If either leaves, that half becomes unowned overnight. Add "reassign Bloomreach rules" to the team's offboarding checklist — this is a five-minute change that prevents the most likely version of this finding getting worse.

### Verify

Every enabled rule has an identifiable current owner and a date. That is the whole bar, and it is not met today.

---

## 12 — Feed integrity sign-off

**Owner:** Engineering (feed) accountable; Merchandising, Marketing, and eComm all depend on it
**Prerequisite:** none. Do this first.

**Today:** the feed is the sole channel through which every facet, every rule-scoped attribute, and every recommendation signal gets its data. The `Safety_Filter` and `Waterproof` defects are feed-layer failures that required a console workaround to contain. **Engineering ownership of feed integrity is not one function among four — it is the dependency the other three sit on.**

This is the one finding where the recent work genuinely helped: `BLOOMREACH_CONSOLE_CONFIGURATION.md` now enumerates every field the integration reads verbatim, with a sign-off checklist.

### Steps

1. Walk the **Setup Checklist** at the end of `BLOOMREACH_CONSOLE_CONFIGURATION.md` with the Bloomreach account team. It is nine items and each has a definite answer. Two are worth extra attention:
   - **6a — `cart_add_count`.** This field is assumed by the R-39 product badges but has never been confirmed to exist. Confirm the real field name, or confirm shipping without that badge. It may already exist under another name, e.g. a merchandising "trending" score.
   - **6b — `fq` boost semantics.** See [§3](#3--global-inventory-bury-resolve-the-duplicate) step 5. This one answer determines whether two separate mechanisms in this integration work at all.
2. **Establish a fill-rate monitor.** For every field in that document, capture fill percentage and distinct-value count on a schedule. The `Waterproof` defect (46% fill, 8 spellings) existed for an unknown period before anyone measured it, which is the actual failure — not the spellings.
3. **Set alert thresholds.** A facet dropping below its threshold should page someone, not wait for a merchandiser to notice results looking wrong.
4. **Add a feed-validation step to the deployment pipeline** — schema, fill rate, value consistency — so a regression is caught at publish time rather than in production ranking.

### Verify

Every checklist item in `BLOOMREACH_CONSOLE_CONFIGURATION.md` is ticked, dated, and signed by a named person on both sides. Unticked items are known-unknowns in production ranking today.

---

## 13 — Tiered caching model

The tiered model (Tier 1 Default/Anonymous, Tier 2 Segment, Tier 3 1:1) is architecturally sound and should be adopted for stakeholder communication — "tiers" reads as a permanent serving architecture, which is accurate, where "phases" implies a migration that ends. The items below are the gaps between the diagram and reality.

### 13.1 — Label the diagram "future state"

**Owner:** whoever presents it

Today's cache lives entirely at the eCDN/SFCC page-cache layer, keyed per query, **with no segment-awareness and no decision router**. The diagram's central "Tiered Caching Decision" box is the Cloudflare O2O and cache-variant work — not an incremental tweak to something live.

**Step:** add an explicit *today vs. future state* distinction to every version of this diagram before it is shown to stakeholders again. Without it, the diagram reads as a description of the current architecture, which it is not.

### 13.2 — Tier 2 is already built, and unused

**Owner:** Merchandising ops — see [§7 & 8](#7--8--audiences-wire-the-seven-that-already-exist) for the actual steps

Tier 2 as proposed duplicates the seven Merchandising Audiences that already exist. **Step:** restate Tier 2 in all planning material as *activating existing, unwired capability* rather than building new segmentation. This is a materially better cost and timeline story than the proposal currently tells, and it is being left implicit.

### 13.3 — Correct the segment examples

**Owner:** whoever maintains the proposal

The example segment values ("Workwear, Western, Outdoor") do not correspond to Ariat's actual configuration. The real mechanism is **four canned browse-cookie segments: Men's/Women's × Work/Western**. **Step:** replace the illustrative values with the real four. Stakeholders make scoping decisions from these examples.

### 13.4 — 1:1 personalization: two gates before any enablement

**Owner:** eComm leadership + Privacy/Legal. **Not engineering.**

No route currently sends Bloomreach any shopper-identifying value at query time. Turning on true 1:1 requires two things the proposal does not surface, both of which are business decisions:

1. **License entitlement.** Confirm with the Bloomreach account team that your tier covers **individual-level** personalization, not only segment-level. This is very likely an account-level entitlement Bloomreach enables on their side.
2. **Consent classification.** A privacy/legal sign-off specifically covering transmission of an identifier to Bloomreach for individual profiling. This is a **materially different processing purpose** than the existing pixel's consent basis — do not assume the existing basis covers it.

**Step:** get both in writing before any enablement request, to Bloomreach or in SFCC. The SFCC flag (`personalizationOneToOneEnabled`) defaults off and is enforced in code, not merely by policy — but the flag existing is not permission to flip it. As drawn, Tier 3 reads as an engineering task; it is gated on these two decisions.

**One engineering prerequisite worth knowing about now**, because it affects the license conversation: the integration currently sends the raw SFCC customer ID, while the pixel sends a SHA-256 hash of the customer number. Those will not join. Until they are aligned, individual-level personalization cannot work **even with the license and the consent in place** — Bloomreach would receive an identifier it cannot tie to any behavioural history. Confirm with Bloomreach which identifier format they expect as part of the license discussion; it is the same conversation.

### 13.5 — Cache key and delivery mechanism are two questions

**Status: addressed in the current implementation.** Tier 3 in the proposal conflates *what is excluded from the cache key* with *how personalized content is delivered*. The implemented design keeps the user ID out of the cache key entirely and delivers personalized content via a separate client-side fragment layered on an otherwise-cached shell.

**Step:** split Tier 3 in the diagram into those two sub-questions rather than presenting it as a single "selective cache or bypass" decision. The implementation already answers both; the diagram should reflect that.

### 13.6 — Specify the write path per tier

**Owner:** whoever finalizes the model

The proposal shows only the read path. It does not address how a merchandiser's rule change propagates through three different cache postures. Tier 2's balanced-TTL approach could plausibly leave a published change invisible **longer** than Tier 1's already-documented latency gap ([§10](#10--rule-publishing-vs-cache-invalidation)).

**Step:** measure and state the rule-to-shopper latency **per tier** before the model is finalized. [§10](#10--rule-publishing-vs-cache-invalidation)'s timing exercise gives you the Tier 1 number; the others are estimates until the routing layer exists.

### 13.7 — Resilience is inverted

**Status: handled in the current implementation, and worth preserving as a rule.**

Tier 1's aggressive caching is naturally resilient to a Bloomreach outage — cached content keeps serving. Tier 3's cache-bypass path is by construction the **least** resilient, meaning the highest-value customers would get the flakiest service during exactly the outage [§1](#1--failover-and-graceful-degradation) warns about.

The implemented fragments handle this correctly: every one fails closed to non-personalized content or to nothing, and the cached shell is never affected. **Step:** make "the shell must remain independently renderable, and the fragment must fail closed" an explicit design rule for any future Tier 3 surface, and add serve-stale-on-error behaviour where a fragment is ever made cacheable. The proposal is currently silent on this.

### 13.8 — Batch-generated pages sit outside the model

**Owner:** SEO + Merchandising

Autonomous SEO/thematic pages are pre-generated by a scheduled batch job and fully rendered before any shopper arrives. **There is no request-time routing decision to make**, so asking which tier they belong to is the wrong question.

Two reasons Tier 2 and Tier 3 don't apply here specifically:

- A shopper landing on a long-tail organic query is typically on a **first pageview**, with no prior browsing history for the browse-cookie mechanism to have set a segment from.
- Personalizing the primary curated content undermines the crawlability and Core Web Vitals stability these pages exist to deliver.

**The model is missing an axis.** It has only *how personalized*; thematic pages need *how fresh*. The stock-availability-refresh fragment proposed for these pages is not a personalization tier — it is an orthogonal freshness mechanism layered on a page that stays Tier 1 throughout. As drawn, there is no place for "anonymous, cached, and needing a narrow non-personalized freshness refresh"; it would have to be forced into Tier 2 or invented as an ad hoc "Tier 1.5," and neither is honest about what it is.

**Steps:**
1. Add a second axis (freshness) to the model, or explicitly scope thematic pages out of it. Either is defensible; leaving it ambiguous is not.
2. Note that the write-path question differs in kind here: every other tier's freshness question is cache-TTL expiry, while a thematic page's is **time-until-next-batch-regeneration**. Per the SEO addendum, the value of the freshness fragment is *reducing how often the batch job must fire*, not shortening a TTL.
3. **Be aware the current implementation runs against this finding:** the batch job embeds a personalized-strip placeholder into every generated thematic page. It is defensible — the curated grid stays in static HTML so crawlability is preserved, and it is a no-op for the anonymous first-pageview shoppers this surface mostly serves — but it is Tier 3 machinery on a Tier 1 surface, and the fragment injects after load, which is a layout-shift risk on pages that exist for CWV stability. If CWV on thematic pages is a priority, raise removing that placeholder.

### 13.9 — Pixel completeness audit (BT-01)

**Owner:** Analytics + Marketing
**Prerequisite:** none — **the report already exists in the console and has never been run.** Do this early; it is a read, not a build.

Pixel and event collection sit on a **different axis** from the tiered model: tiering governs what gets *served*, collection governs what gets *recorded*, and recording happens identically regardless of tier. A Tier 1 anonymous pageview and a hypothetical Tier 3 personalized pageview fire the same events. This is a reasonable omission from the diagram only if stated explicitly as orthogonal and always-on — pixel-completeness work and tiering work are separate workstreams and neither blocks the other.

**Confirmed state today:** a 7-event schema (`page_view`, `category_view`, `search_query`, `facet_apply`, `product_view`, `cart_add`, `purchase`) firing via GTM, hybrid with direct API calls. Identity is the Bloomreach first-party visitor cookie for anonymous shoppers and a SHA-256 hash of the SFCC customer number for logged-in shoppers. Purchase is dual-channel — pixel plus the S2S order hook as system of record — because client-side tracking is ITP-lossy on the ~70% mobile share.

**Steps:**

1. **Run the pixel-monitor report.** It is already configured in the console as the planned first evidence source for this audit. Nobody has read it.
2. **Check all seven events fire on all relevant surfaces.** Expect gaps on the surfaces added most recently.
3. **Quantify the ITP asymmetry — this is the finding that matters most here.** Only `purchase` has S2S protection. The other six, including `product_view`, `cart_add`, and `facet_apply`, do not. Segment event volume by browser and compare Safari mobile against Chrome mobile, normalized by session count. If Safari is undercounting, then `omni_score_views_decayed` and `omni_score_atc_decayed` are **structurally skewed toward non-Safari shoppers**, and [§9](#9--omni_score_-behavioural-signals-put-them-to-work) needs to know the magnitude before ranking on those scores.
4. **Extend S2S protection to `cart_add` at minimum.** It is the closest of the six to purchase intent and it directly feeds a scoring facet.
5. **Note the collected-but-not-activated gap.** The pixel already carries a hashed identity for logged-in shoppers. No route sends that same identity back to Bloomreach at query time. Bloomreach already receives identity-linked behavioural signal and simply does not use it for serving. Closing this is [§13.4](#134--11-personalization-two-gates-before-any-enablement)'s two gates plus the identity-format alignment noted there — **not** a new collection build.

---

## The pattern worth naming

Three findings in this document are the same failure in different clothes:

- **Seven audiences defined, zero rules referencing them** ([§7](#7--8--audiences-wire-the-seven-that-already-exist))
- **Five facets hidden because the feed driving them is broken** ([§5](#5--five-hidden-facets-fix-at-source))
- **A hashed identity collected on every logged-in pageview and never sent at query time** ([§13.9](#139--pixel-completeness-audit-bt-01))

Each is the collection or definition layer built, and never wired to a serving decision. A fourth is arguably forming in [§9](#9--omni_score_-behavioural-signals-put-them-to-work) — four behavioural scoring facets computed, exposed, and referenced by no rule.

**This pattern, not any individual instance, is the useful thing for prioritization.** The implementation is mature at the console-configuration layer and incomplete at the activation layer, and a stakeholder reading the console sees an extensive, sophisticated setup that is partly inert. Before adding any new configuration, the question to ask about the last thing built is: *is it wired into a live serving decision, or only defined?*

The path forward is not more console configuration. It is: resolve the engine-of-record decision, fix the feed defects the five facets are hiding, activate the audiences that already exist, and redesign the cache to be variant-aware before Tier 2 can become a live capability rather than a dormant one.
