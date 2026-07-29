# Bloomreach SFRA – Sequence Diagrams

All sequence diagrams use [Mermaid](https://mermaid.js.org/) syntax and can be rendered
directly in GitHub, GitLab, VS Code (Mermaid extension), or any Mermaid-aware viewer.

---

## 1. Bloomreach Service Layer (Base HTTP Call)

> **Business context:** This is the shared "phone line" that every Bloomreach-powered feature
> uses when it needs to fetch product data. Rather than each feature managing its own
> connection to Bloomreach, they all go through one central module that handles API
> credentials, request formatting, and error logging automatically. This means credential
> changes or logging improvements only need to be made in one place, and sensitive API
> keys are never written to logs.

Every feature in this integration (Boot Finder, Comparison Tool, Work Job Landing,
Thematic Pages, and free-text search/suggest) routes through this single service
module rather than making raw HTTP calls.

```mermaid
sequenceDiagram
    participant Caller as Any Caller<br/>(helper / controller / job)
    participant bloomreachService as bloomreachService
    participant SFCC_SvcReg as LocalServiceRegistry<br/>(SFCC)
    participant SitePrefs as Site Custom Prefs<br/>(account_id / auth_key / domain_key)
    participant BloomreachAPI as Bloomreach Discovery API

    Caller->>bloomreachService: call(requestParams)
    bloomreachService->>SFCC_SvcReg: createService('bloomreach.http.search', callbacks)
    SFCC_SvcReg-->>bloomreachService: service instance

    bloomreachService->>SFCC_SvcReg: service.call(requestParams)
    Note over SFCC_SvcReg: createRequest callback fires
    SFCC_SvcReg->>SitePrefs: getCustomPreferences()<br/>(bloomreachAccountId / AuthKey / DomainKey)
    SitePrefs-->>SFCC_SvcReg: base credential values
    SFCC_SvcReg->>SFCC_SvcReg: merge base params + requestParams<br/>inject request_id=Date.now() if absent<br/>buildQueryString (skip null/empty values)<br/>set GET method & Accept header

    SFCC_SvcReg->>BloomreachAPI: GET /search?account_id=...&auth_key=***&request_id=...&...
    BloomreachAPI-->>SFCC_SvcReg: HTTP 200 JSON body

    Note over SFCC_SvcReg: parseResponse callback fires
    SFCC_SvcReg-->>bloomreachService: result (httpClient.text)
    Note over bloomreachService: filterLogMessage strips auth_key before any log write

    bloomreachService->>bloomreachService: JSON.parse(result.getObject())
    bloomreachService-->>Caller: parsed JSON response

    alt HTTP / transport error
        SFCC_SvcReg-->>bloomreachService: result.isOk() = false
        bloomreachService-->>Caller: throw Error (status code attached)
    end
```

---

## 2. Free-Text Search & Autosuggest

> **Business context:** This covers what happens when a shopper types keywords into the
> site search bar. There are two sub-flows: **search** (returning a full results page for a
> submitted query such as "waterproof boots") and **autosuggest** (returning instant
> suggestions as the shopper types). Both call Bloomreach's Discovery API and are the
> foundation on which all the more specialised attribute-filter features (Boot Finder,
> Job Landing, Thematic Pages) are built.

Standard keyword search and autocomplete calls used by the existing site search
integration (these shapes are the baseline that all new filter-query (`fq`)-based features extend).

```mermaid
sequenceDiagram
    participant Client as Client / Controller
    participant bloomreachSearchHelper as bloomreachSearchHelper
    participant bloomreachService as bloomreachService
    participant BloomreachAPI as Bloomreach Discovery API

    alt Free-text keyword search
        Client->>bloomreachSearchHelper: search(query, options)
        bloomreachSearchHelper->>bloomreachSearchHelper: build params<br/>{q, search_type:'keyword',<br/>start: options.start||0, rows: options.rows||24}<br/>+ merge options.extraParams (if any)
        bloomreachSearchHelper->>bloomreachService: call(params)
        bloomreachService->>BloomreachAPI: GET /?q=boots&search_type=keyword&start=0&rows=24
        BloomreachAPI-->>bloomreachService: JSON response
        bloomreachService-->>bloomreachSearchHelper: parsed JSON
        bloomreachSearchHelper-->>Client: parsed JSON response
    else Autosuggest
        Client->>bloomreachSearchHelper: suggest(prefix)
        bloomreachSearchHelper->>bloomreachService: call({q: prefix, request_type:'suggest'})
        bloomreachService->>BloomreachAPI: GET /?q=boot&request_type=suggest
        BloomreachAPI-->>bloomreachService: JSON response
        bloomreachService-->>bloomreachSearchHelper: parsed JSON
        bloomreachSearchHelper-->>Client: parsed JSON response
    end
```

---

## 3. Boot Finder – Initial Page Load (Show)

> **Business context:** This is what happens the moment a shopper opens the Boot Finder
> modal. The server checks which questions are currently switched on (via feature flags
> controlled in SFCC Business Manager) and sends the complete question set to the browser
> in a single response. From that point on, the questionnaire runs entirely in the
> browser — there are no loading delays between questions — which keeps the guided
> experience fast and seamless for the shopper.

Renders the modal shell with the active question list embedded as JSON so the
client-side state machine can drive all subsequent steps without extra round trips.

```mermaid
sequenceDiagram
    participant Browser
    participant BootFinderCtrl as BootFinder Controller<br/>(Show)
    participant interactiveCache as interactiveCache<br/>middleware
    participant questionConfig as bootFinderQuestionConfig
    participant featureFlags as featureFlags

    Browser->>BootFinderCtrl: GET /BootFinder-Show
    BootFinderCtrl->>interactiveCache: applyNoCache(req, res, next)
    Note over interactiveCache: cachePeriod=0, personalized=true<br/>(never served from shared page cache)
    interactiveCache-->>BootFinderCtrl: next()

    BootFinderCtrl->>questionConfig: getActiveQuestions()
    loop Per question that has a feature flag
        questionConfig->>featureFlags: isEnabled(question.flag)
        featureFlags-->>questionConfig: boolean
    end
    questionConfig-->>BootFinderCtrl: activeQuestions[] (flag-off questions excluded)

    BootFinderCtrl->>questionConfig: resolveShaftHeightField()
    questionConfig->>featureFlags: isEnabled('SHAFT_HEIGHT_RANGE')
    alt SHAFT_HEIGHT_RANGE enabled
        featureFlags-->>questionConfig: true
        questionConfig-->>BootFinderCtrl: {field: 'shaft_height_in', mode: 'range'}
    else disabled
        featureFlags-->>questionConfig: false
        questionConfig-->>BootFinderCtrl: {field: 'Shaft_Height', mode: 'string'}
    end

    BootFinderCtrl-->>Browser: render bootfinder/show<br/>modal HTML includes:<br/>  data-questions="[{id,field,flag,type,chipLabel},...]"<br/>  (types: single-select | boolean | shaft-height | variant | multi-select)<br/>  data-shaft-height-mode="range|string"<br/>  data-results-url="/BootFinder-Results"<br/>(questions JSON + shaftHeightMode embedded in modal HTML)
```

---

## 4. Boot Finder – Client-Side Question State Machine

> **Business context:** This tracks the shopper's complete journey through the Boot Finder
> questionnaire — from dismissing the entry card, to answering each question (job type,
> toe shape, shaft height, waterproofing, insulation, size/width), to skipping a question,
> to tapping "Show results now" early. Every answer is stored locally in the browser, and
> analytics events are fired to GTM at each step. Only one server call is made — when the
> shopper is finally ready to see their personalised product recommendations.

After the modal HTML is loaded, the browser drives the entire question flow locally
using the embedded question list. No server round trip occurs until the shopper is
ready to see results.

```mermaid
sequenceDiagram
    participant User
    participant bootFinderJS as bootFinder.js<br/>(Client State Machine)
    participant DOM as DOM / Modal
    participant GTM as GTM dataLayer
    participant Server as BootFinder-Results<br/>(Server)

    User->>DOM: click [data-dismiss-boot-finder]
    bootFinderJS->>DOM: hide entry card (attr hidden)
    bootFinderJS->>bootFinderJS: sessionStorage.setItem('boot-finder-entry-dismissed','true')

    User->>DOM: click [data-start-boot-finder]
    bootFinderJS->>Server: GET BootFinder-Show URL (from data-url attr)
    Server-->>bootFinderJS: modal HTML (questions JSON embedded in data-questions attr)

    bootFinderJS->>bootFinderJS: initModal()<br/>parse questions[] from data-questions attr<br/>read shaftHeightMode from data-shaft-height-mode attr<br/>read resultsUrl from data-results-url attr<br/>reset answers{}, currentIndex=0<br/>append $container to body
    bootFinderJS->>GTM: pushEvent('finder_start', {})
    bootFinderJS->>DOM: renderCurrentQuestion() → show Q1

    loop For each question (index 0..N-1)
        alt User selects an answer option
            User->>DOM: click [data-option]
            bootFinderJS->>bootFinderJS: recordAnswer(question, value)<br/>type='shaft-height' → answers.shaftHeight=value<br/>type='variant' → Object.assign(answers, value) (size+width)<br/>type=other → answers[question.field]=value
            bootFinderJS->>GTM: pushEvent('finder_question_answered',<br/>{question_id, answer})
            bootFinderJS->>bootFinderJS: advance() → currentIndex++
            alt currentIndex < questions.length
                bootFinderJS->>DOM: renderCurrentQuestion()
            else currentIndex >= questions.length (all answered)
                bootFinderJS->>bootFinderJS: fetchResults()
            end
        else User clicks "Skip"
            User->>DOM: click [data-skip-question]
            bootFinderJS->>bootFinderJS: advance() (no answer recorded)
        else User clicks "Show results now"
            User->>DOM: click [data-show-results-now]
            bootFinderJS->>bootFinderJS: fetchResults()
        end
    end

    Note over bootFinderJS: fetchResults() called
    bootFinderJS->>GTM: pushEvent('finder_complete', {answers})
    bootFinderJS->>DOM: hide questions panel, show results panel
    bootFinderJS->>Server: GET /BootFinder-Results?answers={"job_type":"electrical",...}
    alt Success
        Server-->>bootFinderJS: resultsGrid HTML
        bootFinderJS->>DOM: inject resultsGrid HTML into results panel
    else Error
        Server-->>bootFinderJS: HTTP error
        bootFinderJS->>DOM: show "try again" error message
    end

    User->>DOM: click [data-boot-finder-result-click]
    bootFinderJS->>GTM: pushEvent('finder_result_click', {vg_id})
```

---

## 5. Boot Finder – Results (Server-Side AJAX Endpoint)

> **Business context:** Once the shopper has answered (or skipped) all Boot Finder
> questions, this endpoint converts those answers into a personalised product grid.
> The server queries Bloomreach using the shopper's choices as filters, then cross-checks
> SFCC inventory to ensure only boots available in the shopper's chosen size and width are
> shown. Each result card is decorated with plain-language "match chips" (e.g.
> "Electrical Ready", "Composite Toe", "8″ Shaft") that tell the shopper exactly why that
> boot was recommended for them.

Handles the AJAX call made by the client state machine once the shopper has answered
(or skipped) all active questions.

```mermaid
sequenceDiagram
    participant bootFinderJS as bootFinder.js<br/>(Client)
    participant BootFinderCtrl as BootFinder Controller<br/>(Results)
    participant questionConfig as bootFinderQuestionConfig
    participant featureFlags as featureFlags
    participant attrQueryHelper as bloomreachAttributeQueryHelper
    participant inventoryBury as inventoryBuryHelper
    participant SitePrefs as Site Custom Prefs
    participant bloomreachService as bloomreachService
    participant BloomreachAPI as Bloomreach Discovery API
    participant sizeAvail as sizeAvailabilityHelper
    participant ProductMgr as ProductMgr<br/>(SFCC)
    participant chipBuilder as rationaleChipBuilder

    bootFinderJS->>BootFinderCtrl: GET /BootFinder-Results?answers=<JSON>
    BootFinderCtrl->>BootFinderCtrl: JSON.parse(req.querystring.answers)
    alt parse fails
        BootFinderCtrl->>bloomreachLogger: logWarn('BootFinder', 'Could not parse answers param', {raw})
        BootFinderCtrl->>BootFinderCtrl: rawAnswers = {} (continue with empty)
    end

    BootFinderCtrl->>questionConfig: getActiveQuestions()
    questionConfig->>featureFlags: isEnabled() per flagged question
    featureFlags-->>questionConfig: booleans
    questionConfig-->>BootFinderCtrl: activeQuestions[]
    BootFinderCtrl->>BootFinderCtrl: filter answers to active fields only<br/>(protects against stale client with disabled flags)

    Note over BootFinderCtrl: Shaft-height special resolution<br/>rawAnswers.shaftHeight exists?<br/>→ resolveShaftHeightField() → {field, mode}<br/>  mode=range  → answers[shaft_height_in]={min,max}<br/>  mode=string → answers[Shaft_Height]=value
    BootFinderCtrl->>questionConfig: resolveShaftHeightField() (if shaftHeight in rawAnswers)
    questionConfig-->>BootFinderCtrl: {field:'shaft_height_in'|'Shaft_Height', mode:'range'|'string'}

    BootFinderCtrl->>featureFlags: isEnabled('REVIEW_COUNT_BOOST')
    BootFinderCtrl->>featureFlags: isEnabled('SALES_RANK_TIEBREAK')
    featureFlags-->>BootFinderCtrl: booleans

    BootFinderCtrl->>attrQueryHelper: queryByAttributes({answers, reviewCountBoostEnabled,<br/>salesRankTiebreakEnabled, rows:24}, 'BootFinder')
    attrQueryHelper->>attrQueryHelper: buildFilterQueries(answers, {hardFields:[]})<br/>build fq fragments (hard filter or ^1.5 boost per field)
    attrQueryHelper->>inventoryBury: getBuryFilterQuery()
    inventoryBury->>SitePrefs: getCustomPreferenceValue('lowStockBuryThreshold')
    SitePrefs-->>inventoryBury: threshold value (or null)
    inventoryBury-->>attrQueryHelper: bury fq fragment (or null)
    attrQueryHelper->>attrQueryHelper: build sort: bvRating[,bvReviewCount][,sales_rank_bucket] desc

    attrQueryHelper->>bloomreachService: call({fq, sort, start, rows})
    bloomreachService->>BloomreachAPI: GET /?fq=job_type:"electrical"^1.5 AND ...
    BloomreachAPI-->>bloomreachService: JSON {response: {docs: [...]}}
    bloomreachService-->>attrQueryHelper: parsed response
    attrQueryHelper-->>BootFinderCtrl: bloomreachResponse (or null on failure)

    alt bloomreachResponse is null
        BootFinderCtrl-->>bootFinderJS: 502 + render bootfinder/resultsError
    else has response
        BootFinderCtrl->>BootFinderCtrl: extract vgIds via bloomreachIdentity.fromBloomreachHit()

        BootFinderCtrl->>sizeAvail: filterByAvailability(vgIds, rawAnswers.size, rawAnswers.width)
        Note over sizeAvail: size/width read from rawAnswers (pre-filter),<br/>not from filtered answers —<br/>variant dimensions are resolved in SFCC, not Bloomreach
        alt No size/width answer
            sizeAvail-->>BootFinderCtrl: all vgIds unchanged
        else size/width was answered
            loop Per vgId
                sizeAvail->>ProductMgr: getProduct(vgId)
                ProductMgr-->>sizeAvail: variationGroup
                sizeAvail->>sizeAvail: iterate variants:<br/>matchesSize && matchesWidth && orderable?
            end
            sizeAvail-->>BootFinderCtrl: availableVgIds[] (subset)
        end

        BootFinderCtrl->>BootFinderCtrl: filter docs to availableSet

        loop Per available result doc
            BootFinderCtrl->>chipBuilder: buildChips(answers, doc)
            chipBuilder->>chipBuilder: per field: does doc value match answer?<br/>build label via CHIP_LABEL_BUILDERS[field]:<br/>  job_type        → "{value} Ready"<br/>  Safety_Toe      → "{value} Toe"<br/>  Toe_Shape       → "{value} Toe Shape"<br/>  Shaft_Height    → "{value}"<br/>  shaft_height_in → "{value}\" Shaft"<br/>  feature_waterproof → "Waterproof"<br/>  warmth_rating   → "{value} Insulation"<br/>  safety_specs    → "{value}"
            chipBuilder-->>BootFinderCtrl: chips[] e.g. ["Electrical Ready","Composite Toe","8\" Shaft"]
        end

        BootFinderCtrl-->>bootFinderJS: render bootfinder/resultsGrid<br/>{results: [{vgId, name(doc.title), image(doc.thumb_image),<br/>price(doc.price), bvRating, bvReviewCount, chips}]}
    end
```

---

## 6. Comparison Tool

> **Business context:** Lets shoppers select up to four boots from any listing page (PLP,
> Boot Finder results, Job Landing page) and view them in a side-by-side feature
> comparison table. Selections persist in session storage as the shopper browses, so
> they can add products from multiple pages before hitting "Compare". The table rows
> (Safety Toe, Toe Shape, Shaft Height, Waterproof, Insulation, Ratings) are driven by
> the same feature flags as Boot Finder, so the comparison table always stays in sync
> with whichever product attributes are currently enabled on the site.

Covers both the client-side selection management and the server-side table rendering.

```mermaid
sequenceDiagram
    participant User
    participant compareJS as compare.js<br/>(Client)
    participant sessionStorage as sessionStorage<br/>('boot-compare-selection')
    participant GTM as GTM dataLayer
    participant Browser as Browser
    participant CompareCtrl as Compare Controller<br/>(Show)
    participant interactiveCache as interactiveCache<br/>middleware
    participant productLookup as bloomreachProductLookupHelper
    participant identity as bloomreachIdentity
    participant bloomreachService as bloomreachService
    participant BloomreachAPI as Bloomreach Discovery API
    participant compareModel as compareModel
    participant featureFlags as featureFlags

    Note over User,compareJS: Selection phase (on PLP / Boot Finder results)

    User->>compareJS: check [data-compare-select] checkbox (vgId)
    compareJS->>sessionStorage: getSelection()
    sessionStorage-->>compareJS: current ids[]
    alt Already at max (4 items)
        compareJS->>compareJS: uncheck checkbox, return
    else Under limit
        compareJS->>sessionStorage: setSelection([...ids, vgId])
        compareJS->>GTM: pushEvent('compare_item_added', {vg_id})
        compareJS->>DOM: trigger compare:selectionChanged
    end

    User->>compareJS: uncheck [data-compare-select]
    compareJS->>sessionStorage: setSelection(ids without vgId)
    compareJS->>GTM: pushEvent('compare_item_removed', {vg_id})

    User->>compareJS: click [data-compare-view]
    compareJS->>sessionStorage: getSelection()
    sessionStorage-->>compareJS: selected ids (≥2 required)
    compareJS->>Browser: window.location.href = data-url + ?pids=id1,id2,...

    Note over CompareCtrl,BloomreachAPI: Server rendering phase

    Browser->>CompareCtrl: GET /Compare-Show?pids=id1,id2,id3
    CompareCtrl->>interactiveCache: applyNoCache()
    interactiveCache-->>CompareCtrl: next()
    CompareCtrl->>CompareCtrl: split pids by comma, validate 2-4 items
    alt Too few pids (< 2)
        CompareCtrl-->>Browser: render compare/tableError ("Select at least 2 products")
    else Valid count
        alt More than 4 pids
            CompareCtrl->>CompareCtrl: truncate to first 4
        end
        CompareCtrl->>productLookup: lookupByIds(vgIds, 'Compare')
        loop Per vgId
            productLookup->>identity: isWellFormedId(id)
            identity-->>productLookup: boolean
        end
        productLookup->>bloomreachService: call({fq:'pid:("id1" OR "id2" OR ...)', rows: N})
        bloomreachService->>BloomreachAPI: GET /?fq=pid:(...)
        BloomreachAPI-->>bloomreachService: JSON {response: {docs: [...]}}
        bloomreachService-->>productLookup: parsed response
        productLookup-->>CompareCtrl: bloomreachResponse

        alt bloomreachResponse is null or throws
            CompareCtrl-->>Browser: 502 + render compare/tableError
        else success
            CompareCtrl->>compareModel: build(docs)
            compareModel->>compareModel: getActiveRows() — include/exclude rows by feature flag<br/>Always:    Safety_Toe, Toe_Shape, Shaft_Height<br/>SHAFT_HEIGHT_RANGE on → add shaft_height_in<br/>WATERPROOF_QUESTION on → add feature_waterproof<br/>INSULATION_QUESTION on → add warmth_rating<br/>Always:    bvRating (+ bvReviewCount if REVIEW_COUNT_BOOST on)
            compareModel->>featureFlags: isEnabled('SHAFT_HEIGHT_RANGE')<br/>isEnabled('WATERPROOF_QUESTION')<br/>isEnabled('INSULATION_QUESTION')<br/>isEnabled('REVIEW_COUNT_BOOST')
            featureFlags-->>compareModel: booleans
            loop Per doc (column)
                compareModel->>identity: fromBloomreachHit(doc)
                identity-->>compareModel: {vgId, skuId}
                compareModel->>compareModel: extract attribute values for active rows<br/>name=doc.title, image=doc.thumb_image, price=doc.price
            end
            compareModel-->>CompareCtrl: {rows: [...], columns: [{vgId, name, image, price, values:{...}}]}
            CompareCtrl-->>Browser: render compare/table
        end
    end

    Note over User,compareJS: Remove / update phase (on compare page)

    User->>compareJS: click [data-compare-remove] (vgId)
    compareJS->>sessionStorage: remove vgId from selection
    compareJS->>GTM: pushEvent('compare_item_removed', {vg_id})
    alt Fewer than 2 remain
        compareJS->>Browser: window.location.reload()
    else 2 or more remain
        compareJS->>compareJS: renderTable($('.compare-page'), data-compare-url, remaining ids)
        compareJS->>CompareCtrl: GET /Compare-Show?pids=remaining,ids (AJAX)
        CompareCtrl-->>compareJS: updated table HTML
        compareJS->>DOM: $('[data-compare-table]').replaceWith(new table HTML)
    end
```

---

## 7. Work / Job Landing Page

> **Business context:** Generates a trade-specific browse page — for example,
> `/Work-JobLanding?jobType=electrical` shows "Boots for Electrical Work" — surfacing the
> highest-rated products that match a particular job category. Unlike Boot Finder, the
> shopper doesn't answer any questions; the job type is determined by the URL, which
> makes these pages fully cacheable and SEO-indexable. Merchandisers enable or disable
> individual job-type pages through a feature flag in Business Manager, and Page Designer
> content zones let them add editorial copy above the product grid.

Attribute-filtered browse page for a trade job type (e.g. `/Work-JobLanding?jobType=electrical`).
Uses the same query-building helper as Boot Finder Question 1 (job-type selection) and supports standard SFRA page caching.

...mermaid
---
config:
  layout: elk
---
sequenceDiagram
    participant SFCCJob as SFCC Job Framework
    participant GenerateTP as GenerateThematicPages<br/>(execute)
    participant CustomObjMgr as CustomObjectMgr<br/>(SFCC)
    participant featureFlags as featureFlags
    participant attrQueryHelper as bloomreachAttributeQueryHelper
    participant inventoryBury as inventoryBuryHelper
    participant bloomreachService as bloomreachService
    participant BloomreachAPI as Bloomreach Discovery API
    participant identity as bloomreachIdentity
    participant Transaction as Transaction<br/>(SFCC)
    participant ContentMgr as ContentMgr<br/>(SFCC)

    SFCCJob->>GenerateTP: execute({DryRun: true|false})

    GenerateTP->>CustomObjMgr: getAllCustomObjects("ThematicPageCombination")
    CustomObjMgr-->>GenerateTP: iterator of enabled combinations

    loop Per enabled ThematicPageCombination
        GenerateTP->>GenerateTP: isEligible(combo)
        alt combo has safetySpec AND SAFETY_SPEC_REFINEMENT flag is off (upstream feed fix pending — skip to avoid stale/corrupted pages)
            GenerateTP->>featureFlags: isEnabled("SAFETY_SPEC_REFINEMENT")
            featureFlags-->>GenerateTP: false
            GenerateTP->>GenerateTP: log warn, skip combination
        else eligible
            GenerateTP->>GenerateTP: buildAnswers(combo)<br/>{job_type, toe_shape?, safety_specs?}

            GenerateTP->>attrQueryHelper: queryByAttributes({answers, hardFields:[JOB_TYPE,TOE_SHAPE,SAFETY_SPECS], rows:48})
            attrQueryHelper->>attrQueryHelper: buildFilterQueries(answers, {hardFields})<br/>hard fq filters (no boost weight) per field
            attrQueryHelper->>inventoryBury: getBuryFilterQuery()
            inventoryBury-->>attrQueryHelper: bury fq fragment
            attrQueryHelper->>bloomreachService: call({fq, sort, rows:48})
            bloomreachService->>BloomreachAPI: GET /?fq=job_type:"electrical" AND toe_shape:"Composite" AND ...
            BloomreachAPI-->>bloomreachService: JSON {response: {docs: [...]}}
            bloomreachService-->>attrQueryHelper: parsed response
            attrQueryHelper-->>GenerateTP: bloomreachResponse (or null)

            alt bloomreachResponse null (service failure)
                GenerateTP->>GenerateTP: errors++ , continue to next combination
            else success
                GenerateTP->>identity: fromBloomreachHit(doc) per doc
                identity-->>GenerateTP: {vgId, skuId} per doc
                GenerateTP->>GenerateTP: buildSchemaOrgMarkup(combo, docs)<br/>→ schema.org ItemList JSON-LD

                alt DryRun = true
                    GenerateTP->>GenerateTP: log "[DryRun] would set online=<bool>, N products"
                    Note over GenerateTP: No write to ContentMgr
                else DryRun = false
                    GenerateTP->>Transaction: wrap()
                    Transaction->>ContentMgr: getContent("work-electrical-composite-...")
                    alt Content asset does not exist
                        ContentMgr-->>Transaction: null
                        Transaction->>ContentMgr: getFolder("work-thematic-pages")
                        alt folder is null
                            ContentMgr-->>Transaction: null
                            Transaction->>Transaction: log.error("folder does not exist — skip")
                        else folder found
                            ContentMgr-->>Transaction: folder
                            Transaction->>ContentMgr: createContent(contentId)
                            Transaction->>ContentMgr: folder.assignContent(content)
                        end
                    else exists
                        ContentMgr-->>Transaction: content
                    end
                    Transaction->>Transaction: content.setOnline(docs.length > 0)<br/>(offline = no in-stock products&#59; protects SEO)
                    alt has products
                        Transaction->>Transaction: content.custom.body = schemaOrgJSON<br/>content.custom.productCount = docs.length
                    end
                    Transaction-->>GenerateTP: committed
                end
                GenerateTP->>GenerateTP: processed++
            end
        end

        alt exception thrown
            GenerateTP->>GenerateTP: errors++<br/>log.error("Failed processing combination {key}: {message}")
        end
    end

    GenerateTP->>GenerateTP: log summary (processed, errors, dryRun)
    alt errors > 0 AND processed == 0
        GenerateTP-->>SFCCJob: Status.ERROR ("All combinations failed")
    else
        GenerateTP-->>SFCCJob: Status.OK ("N combinations processed, M errors")
    end

## 8. Loomi Conversational Search (Feature-Flagged Stub)

> **Business context:** Loomi is Bloomreach's AI-powered natural-language search
> capability — it would allow shoppers to type requests like "waterproof boots for
> electrical work under $150" and receive intelligent, context-aware results. Because
> Loomi requires a separate commercial licence that has not yet been approved, this
> section documents the planned integration shape rather than live code. Currently the
> endpoint always responds with `{ "available": false }` so the rest of the site can
> be built and tested independently. When the licence is in place, this stub is the
> starting point for the real implementation.

Loomi is license-gated and not yet approved for build. This controller is a documented
stub only — the only live code path returns `{"available": false}`.

```mermaid
sequenceDiagram
    participant Browser
    participant LoomiCtrl as Loomi Controller<br/>(Query)
    participant featureFlags as featureFlags

    Browser->>LoomiCtrl: GET /Loomi-Query?q=waterproof boots for electrical work under $150

    LoomiCtrl->>featureFlags: isEnabled('LOOMI_ENABLED')

    alt loomi.enabled = false (default / only live path)
        featureFlags-->>LoomiCtrl: false
        LoomiCtrl-->>Browser: HTTP 200<br/>{"available": false}
    else loomi.enabled = true (future — not yet implemented)
        featureFlags-->>LoomiCtrl: true
        Note over LoomiCtrl: Intentionally unreachable until<br/>explicit approval to build the real feature
        LoomiCtrl-->>Browser: HTTP 501<br/>{"available": false, "error": "Loomi is approved but not yet implemented."}
    end

    Note over Browser,LoomiCtrl: Intended future shape (NOT LIVE):<br/>NLU layer interprets free-text → attribute map<br/>(job_type, feature_waterproof, Toe_Shape, priceMax, …)<br/>→ queryByAttributes() → same VG result shape as Boot Finder
```

---

## 9. Generate Thematic Pages (Batch Job)

> **Business context:** An automated overnight job that creates and maintains SEO landing
> pages for specific product attribute combinations — for example, "Electrical Composite
> Toe Boots" or "Waterproof Wide-Width Work Boots". A merchandiser maintains a list of
> desired page combinations in a SFCC Custom Object; the job queries Bloomreach for each
> combination and either publishes the page (if matching in-stock products exist) or takes
> it offline (if no products match), ensuring shoppers and search engines never land on
> an empty page. A "dry run" mode lets teams preview what would be published before
> making any live changes.

SFCC Job step that reads a merchandiser-editable combination matrix, queries Bloomreach
per row, and creates/updates/hides Content assets with schema.org JSON-LD markup.
Runs immediately before the existing "Generate Sitemap" job step.

```mermaid
sequenceDiagram
    participant SFCCJob as SFCC Job Framework
    participant GenerateTP as GenerateThematicPages<br/>(execute)
    participant CustomObjMgr as CustomObjectMgr<br/>(SFCC)
    participant featureFlags as featureFlags
    participant attrQueryHelper as bloomreachAttributeQueryHelper
    participant inventoryBury as inventoryBuryHelper
    participant bloomreachService as bloomreachService
    participant BloomreachAPI as Bloomreach Discovery API
    participant identity as bloomreachIdentity
    participant Transaction as Transaction<br/>(SFCC)
    participant ContentMgr as ContentMgr<br/>(SFCC)

    SFCCJob->>GenerateTP: execute({DryRun: true|false})

    GenerateTP->>CustomObjMgr: getAllCustomObjects('ThematicPageCombination')
    CustomObjMgr-->>GenerateTP: iterator of enabled combinations

    loop Per enabled ThematicPageCombination
        GenerateTP->>GenerateTP: isEligible(combo)
        alt combo has safetySpec AND SAFETY_SPEC_REFINEMENT flag is off (upstream feed fix pending — skip to avoid stale/corrupted pages)
            GenerateTP->>featureFlags: isEnabled('SAFETY_SPEC_REFINEMENT')
            featureFlags-->>GenerateTP: false
            GenerateTP->>GenerateTP: log warn, skip combination
        else eligible
            GenerateTP->>GenerateTP: buildAnswers(combo)<br/>{job_type, toe_shape?, safety_specs?}

            GenerateTP->>attrQueryHelper: queryByAttributes({answers, hardFields:[JOB_TYPE,TOE_SHAPE,SAFETY_SPECS], rows:48})
            attrQueryHelper->>attrQueryHelper: buildFilterQueries(answers, {hardFields})<br/>hard fq filters (no boost weight) per field
            attrQueryHelper->>inventoryBury: getBuryFilterQuery()
            inventoryBury-->>attrQueryHelper: bury fq fragment
            attrQueryHelper->>bloomreachService: call({fq, sort, rows:48})
            bloomreachService->>BloomreachAPI: GET /?fq=job_type:"electrical" AND toe_shape:"Composite" AND ...
            BloomreachAPI-->>bloomreachService: JSON {response: {docs: [...]}}
            bloomreachService-->>attrQueryHelper: parsed response
            attrQueryHelper-->>GenerateTP: bloomreachResponse (or null)

            alt bloomreachResponse null (service failure)
                GenerateTP->>GenerateTP: errors++ , continue to next combination
            else success
                GenerateTP->>identity: fromBloomreachHit(doc) per doc
                identity-->>GenerateTP: {vgId, skuId} per doc
                GenerateTP->>GenerateTP: buildSchemaOrgMarkup(combo, docs)<br/>→ schema.org ItemList JSON-LD

                alt DryRun = true
                    GenerateTP->>GenerateTP: log "[DryRun] would set online=<bool>, N products"
                    Note over GenerateTP: No write to ContentMgr
                else DryRun = false
                    GenerateTP->>Transaction: wrap()
                    Transaction->>ContentMgr: getContent('work-electrical-composite-...')
                    alt Content asset does not exist
                        ContentMgr-->>Transaction: null
                        Transaction->>ContentMgr: getFolder('work-thematic-pages')
                        alt folder is null
                            ContentMgr-->>Transaction: null
                            Transaction->>Transaction: log.error('folder does not exist — skip')
                        else folder found
                            ContentMgr-->>Transaction: folder
                            Transaction->>ContentMgr: createContent(contentId)
                            Transaction->>ContentMgr: folder.assignContent(content)
                        end
                    else exists
                        ContentMgr-->>Transaction: content
                    end
                    Transaction->>Transaction: content.setOnline(docs.length > 0)<br/>(offline = no in-stock products; protects SEO)
                    alt has products
                        Transaction->>Transaction: content.custom.body = schemaOrgJSON<br/>content.custom.productCount = docs.length
                    end
                    Transaction-->>GenerateTP: committed
                end
                GenerateTP->>GenerateTP: processed++
            end
        end

        alt exception thrown
            GenerateTP->>GenerateTP: errors++<br/>log.error('Failed processing combination {key}: {message}')
        end
    end

    GenerateTP->>GenerateTP: log summary (processed, errors, dryRun)
    alt errors > 0 AND processed == 0
        GenerateTP-->>SFCCJob: Status.ERROR ("All combinations failed")
    else
        GenerateTP-->>SFCCJob: Status.OK ("N combinations processed, M errors")
    end
```

---

## Cross-Cutting Relationships

> **Business context:** Three patterns that are used consistently by every feature in
> this integration. **Feature flag resolution** shows how each capability (shaft-height
> range, waterproof question, review-count boost, etc.) is switched on or off through a
> simple checkbox in SFCC Business Manager — no code deployment required. **Structured
> logging** shows how errors are captured in a privacy-safe way (product IDs and facet
> values only — never customer data). **Identity enforcement** shows how the system
> guarantees that only the correct type of product ID (Variation Group or individual
> SKU) is ever sent to or received from Bloomreach, preventing a whole class of
> catalogue data bugs.

```mermaid
sequenceDiagram
    participant Any as Any Feature Controller
    participant featureFlags as featureFlags
    participant constants as bloomreachConstants
    participant SitePrefs as Site Custom Prefs<br/>(SFCC)
    participant logger as bloomreachLogger
    participant dw_Logger as dw.system.Logger<br/>(SFCC)
    participant identity as bloomreachIdentity

    Note over Any,dw_Logger: Feature flag resolution (every controller uses this pattern)
    Any->>featureFlags: isEnabled('FLAG_KEY')
    featureFlags->>constants: FEATURE_FLAGS['FLAG_KEY'] → preferenceId
    featureFlags->>SitePrefs: getCustomPreferenceValue(preferenceId)
    SitePrefs-->>featureFlags: boolean | null
    featureFlags-->>Any: true / false

    Note over Any,dw_Logger: Structured error logging (every service call failure uses this pattern)
    Any->>logger: logServiceFailure(feature, error, queryParams)
    logger->>dw_Logger: Logger.getLogger('bloomreach', feature).error(message + context)
    Note over logger: PII-safe: only VG/SKU ids and facet values<br/>are present in queryParams — never customer data

    Note over Any,dw_Logger: Structured warn logging (e.g. parse failure, skipped combination)
    Any->>logger: logWarn(feature, message, context)
    logger->>dw_Logger: Logger.getLogger('bloomreach', feature).warn(message + context)

    Note over Any,dw_Logger: Identity enforcement (any code that sends/receives a product id to/from Bloomreach)
    Any->>identity: requireVariationGroupId(product)
    Note over identity: product.isVariationGroup() must be true — throws otherwise
    identity-->>Any: product.ID (Variation Group id)

    Any->>identity: requireVariantId(variant)
    Note over identity: variant.isVariant() must be true — throws otherwise
    identity-->>Any: variant.ID (Variation/SKU id)

    Any->>identity: isWellFormedId(id)
    Note over identity: /^[A-Za-z0-9_-]+$/ format check only<br/>(used to filter malformed pids before Compare lookup)
    identity-->>Any: boolean
```

---

## 11. Attribute & Constants Reference

> **Business context:** A quick-reference guide for anyone who needs to understand which
> product attributes are used across Boot Finder, Compare, and Thematic Pages, and how
> each feature flag maps to a checkbox in SFCC Business Manager. The four sub-diagrams
> cover: (a) the product ID fields used to identify items in Bloomreach; (b) all
> searchable attribute names (safety toe, toe shape, shaft height, job type, waterproofing,
> warmth rating, ratings, and sales rank); (c) every feature flag and the exact Site
> Preference name a merchandiser would look for in Business Manager; and (d) how the
> product sort order (best-rated first, with optional tiebreakers) is assembled from
> those flags.

All logical attribute names, Bloomreach index field names, feature flags, and their preference IDs in one place.
These constants live in `bloomreachConstants.js` and are the single source of truth consumed by every helper and controller above.

### 11a. Identity Fields

```mermaid
flowchart LR
    subgraph IDENTITY["bloomreachConstants.IDENTITY"]
        PID["PID_FIELD = 'pid'\n(SFCC Variation Group id)"]
        SKU["SKU_FIELD = 'sku'\n(SFCC Variation / SKU id)"]
    end
    PID -->|"used by"| A["bloomreachProductLookupHelper\nbloomreachAttributeQueryHelper\nbloomreachIdentity.fromBloomreachHit()"]
    SKU -->|"used by"| A
```

### 11b. Attribute Field Names

```mermaid
flowchart LR
    subgraph ATTR["bloomreachConstants.ATTRIBUTES (Bloomreach index field names)"]
        direction TB
        A1["SAFETY_TOE = 'Safety_Toe'"]
        A2["TOE_SHAPE = 'Toe_Shape'"]
        A3["SHAFT_HEIGHT = 'Shaft_Height'\n(string mode, legacy)"]
        A4["JOB_TYPE = 'job_type'"]
        A5["SHAFT_HEIGHT_IN = 'shaft_height_in'\n(numeric range mode — SHAFT_HEIGHT_RANGE flag)"]
        A6["SAFETY_SPECS = 'safety_specs'\n(multi-value — SAFETY_SPEC_REFINEMENT flag)"]
        A7["FEATURE_WATERPROOF = 'feature_waterproof'\n(boolean — WATERPROOF_QUESTION flag)"]
        A8["WARMTH_RATING = 'warmth_rating'\n(INSULATION_QUESTION flag)"]
        A9["BV_RATING = 'bvRating'\n(always used for sort)"]
        A10["BV_REVIEW_COUNT = 'bvReviewCount'\n(sort tiebreak — REVIEW_COUNT_BOOST flag)"]
        A11["SALES_RANK_BUCKET = 'sales_rank_bucket'\n(sort tiebreak — SALES_RANK_TIEBREAK flag)"]
    end
    subgraph BURY["inventoryBuryHelper"]
        B1["inventory_level (Bloomreach field)\nfq: inventory_level:[threshold TO *]^0.1\n     OR inventory_level:[* TO threshold]^-0.5\n(configured via lowStockBuryThreshold site pref)"]
    end
    subgraph DOCFIELDS["Bloomreach response doc fields (used in controllers)"]
        D1["title → product name"]
        D2["thumb_image → card image URL"]
        D3["price → display price"]
    end
```

### 11c. Feature Flag → Site Preference ID Mapping

```mermaid
flowchart LR
    subgraph FLAGS["bloomreachConstants.FEATURE_FLAGS"]
        direction TB
        F1["JOB_TYPE → 'finderJobTypeEnabled'"]
        F2["SHAFT_HEIGHT_RANGE → 'finderShaftHeightRangeEnabled'"]
        F3["SAFETY_SPEC_REFINEMENT → 'finderSafetySpecRefinementEnabled'"]
        F4["WATERPROOF_QUESTION → 'finderWaterproofQuestionEnabled'"]
        F5["INSULATION_QUESTION → 'finderInsulationQuestionEnabled'"]
        F6["REVIEW_COUNT_BOOST → 'finderReviewCountBoostEnabled'"]
        F7["SALES_RANK_TIEBREAK → 'finderSalesRankTiebreakEnabled'"]
        F8["LOOMI_ENABLED → 'loomiEnabled'"]
    end
    FLAGS -->|"resolved by"| FH["featureFlags.isEnabled(flagKey)\nSite.getCurrent().getCustomPreferenceValue(prefId)"]
    FH -->|"consumed by"| C["BootFinder · Compare · Work\nbootFinderQuestionConfig · compareModel\nGenerateThematicPages · Loomi"]
```

### 11d. Sort Behaviour (attribute queries)

```mermaid
flowchart TD
    S1{REVIEW_COUNT_BOOST\nenabled?}
    S1 -->|yes| SB["sort = bvRating,bvReviewCount desc"]
    S1 -->|no| SA["sort = bvRating desc"]
    SB --> S2{SALES_RANK_TIEBREAK\nenabled?}
    SA --> S2
    S2 -->|yes| SC["append ,sales_rank_bucket desc"]
    S2 -->|no| SD["sort unchanged"]
```
