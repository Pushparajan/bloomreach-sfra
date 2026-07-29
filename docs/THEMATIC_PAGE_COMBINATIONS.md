# Thematic Pages — Combinations to Set Up

**Audience:** Merchandising, SEO
**Prerequisite:** `metadata/thematic-page-combination-custom-object.xml` imported (see `TECHNO_FUNCTIONAL_GUIDE.md` §9.1)

Each row below is one `ThematicPageCombination` custom object record to create in **Merchant Tools > Custom Objects > Custom Object Editor > ThematicPageCombination**. The nightly `GenerateThematicPages` job turns each enabled row into a content asset (`work-{combinationKey}`) at `/on/demandware.store/.../Content-Show?cid=work-{combinationKey}`, online only while Bloomreach returns in-stock matches for it.

This list is a **starting recommendation** derived from the job types already wired into the site (`app_ariat_search_experience/cartridge/scripts/shared/jobTypeHelper.js`) and the attribute values already referenced in code/tests (`Toe_Shape`, `safety_specs`). Confirm actual toe-shape and safety-spec values against your live Bloomreach index before creating these — a combination whose values don't exist in the index will simply generate zero results and stay offline, not error.

## Field reference

| Field | Required | Notes |
|---|---|---|
| `combinationKey` | Yes (key) | Unique ID. Convention used below: `{jobType}-{safetySpec}-{toeShape}`, omitting whichever part doesn't apply |
| `jobType` | Yes | Must match a real `job_type` value in the Bloomreach index |
| `toeShape` | No | Must match a real `Toe_Shape` value, e.g. `Composite`, `Steel`, `Alloy` |
| `safetySpec` | No | Must match a real `safety_specs` value, e.g. `EH`, `SD`, `PR` |
| `enabled` | Yes | Toggle without a code deploy |

⚠️ **`safetySpec` rows only generate while `finderSafetySpecRefinementEnabled` (`SAFETY_SPEC_REFINEMENT`) is ON** (the R-21 gate in `GenerateThematicPages.js` skips them entirely otherwise, logging a warning per skipped combination — this is expected, not an error). Don't create safety-spec combinations until that flag is confirmed on.

## Recommended combinations

### Electrical

| combinationKey | jobType | toeShape | safetySpec | Notes |
|---|---|---|---|---|
| `electrical-composite` | `electrical` | `Composite` | — | Highest-intent trade page; composite is the common electrical-safe toe |
| `electrical-eh` | `electrical` | — | `EH` | Requires `SAFETY_SPEC_REFINEMENT` on |
| `electrical-eh-composite` | `electrical` | `Composite` | `EH` | Most specific electrical page; requires the flag |

### Construction

| combinationKey | jobType | toeShape | safetySpec | Notes |
|---|---|---|---|---|
| `construction-steel` | `construction` | `Steel` | — | Traditional steel-toe construction page |
| `construction-composite` | `construction` | `Composite` | — | Lighter-weight alternative |
| `construction-pr` | `construction` | — | `PR` | Puncture-resistant; requires the flag |

### Welding

| combinationKey | jobType | toeShape | safetySpec | Notes |
|---|---|---|---|---|
| `welding-steel` | `welding` | `Steel` | — | Steel toe standard for welding |
| `welding-eh` | `welding` | — | `EH` | Requires the flag |

### Agriculture / Ranch

| combinationKey | jobType | toeShape | safetySpec | Notes |
|---|---|---|---|---|
| `agriculture-steel` | `agriculture` | `Steel` | — | |
| `agriculture-alloy` | `agriculture` | `Alloy` | — | Lighter alternative to steel |

### Oil & Gas

| combinationKey | jobType | toeShape | safetySpec | Notes |
|---|---|---|---|---|
| `oil-gas-composite` | `oil-gas` | `Composite` | — | Composite preferred (metal-detector-friendly on site) |
| `oil-gas-sd` | `oil-gas` | — | `SD` | Static-dissipative; requires the flag |

### Warehouse / Logistics

| combinationKey | jobType | toeShape | safetySpec | Notes |
|---|---|---|---|---|
| `warehouse-composite` | `warehouse` | `Composite` | — | |
| `warehouse-alloy` | `warehouse` | `Alloy` | — | |

## Setup checklist

1. Confirm the exact `job_type`, `Toe_Shape`, and `safety_specs` values live in your Bloomreach index (Merchandising/Bloomreach admin — don't assume the values above are exact; they're placeholders derived from code comments and tests, not a real feed export).
2. Confirm `finderSafetySpecRefinementEnabled` is on before creating any `safetySpec` row, or those rows will silently skip generation.
3. Create each row above (or your confirmed equivalents) in Business Manager, `enabled = true`.
4. Run the `GenerateThematicPages` job once with `dryRun=true` and check the job log for `N processed, N errors` — a processed count matching your row count confirms the matrix is readable.
5. Run with `dryRun=false`; confirm content assets appear under **Merchant Tools > Content > Content Assets > work-thematic-pages**, online for combinations with matching in-stock products.
6. Spot-check one page's rendered product grid and the "View Comparison" trigger (see `TECHNO_FUNCTIONAL_GUIDE.md` §5.4).

**Adding more combinations later** requires no code change — add a row, wait for (or trigger) the next job run.
