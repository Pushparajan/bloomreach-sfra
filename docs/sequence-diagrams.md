# Bloomreach SFRA – Sequence Diagrams

All sequence diagrams use [Mermaid](https://mermaid.js.org/) syntax and can be rendered
directly in GitHub, GitLab, VS Code (Mermaid extension), or any Mermaid-aware viewer.

---

## 1. Bloomreach Service Layer (Base HTTP Call)

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
    SFCC_SvcReg->>SFCC_SvcReg: merge base params + requestParams<br/>build query string<br/>set GET method & Accept header

    SFCC_SvcReg->>BloomreachAPI: GET /search?account_id=...&auth_key=***&...
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
        bloomreachSearchHelper->>bloomreachSearchHelper: build params<br/>{q, search_type:'keyword', start, rows}
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

    BootFinderCtrl-->>Browser: render bootfinder/show<br/>(questions JSON + shaftHeightMode embedded in modal HTML)
```

---

## 4. Boot Finder – Client-Side Question State Machine

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

    User->>DOM: click [data-start-boot-finder]
    bootFinderJS->>Server: GET BootFinder-Show URL
    Server-->>bootFinderJS: modal HTML (questions JSON embedded in data-questions attr)

    bootFinderJS->>bootFinderJS: initModal()<br/>parse questions[], reset answers{}<br/>set resultsUrl, currentIndex=0
    bootFinderJS->>GTM: pushEvent('finder_start', {})
    bootFinderJS->>DOM: renderCurrentQuestion() → show Q1

    loop For each question (index 0..N-1)
        alt User selects an answer option
            User->>DOM: click [data-option]
            bootFinderJS->>bootFinderJS: recordAnswer(question, value)<br/>store in answers[field]
            bootFinderJS->>GTM: pushEvent('finder_question_answered',<br/>{question_id, answer})
            bootFinderJS->>bootFinderJS: advance() → currentIndex++
            alt More questions remain
                bootFinderJS->>DOM: renderCurrentQuestion()
            else Last question answered
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

    BootFinderCtrl->>questionConfig: getActiveQuestions()
    questionConfig->>featureFlags: isEnabled() per flagged question
    featureFlags-->>questionConfig: booleans
    questionConfig-->>BootFinderCtrl: activeQuestions[]
    BootFinderCtrl->>BootFinderCtrl: filter answers to active fields only<br/>(protects against stale client with disabled flags)

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

        BootFinderCtrl->>sizeAvail: filterByAvailability(vgIds, answers.size, answers.width)
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
            chipBuilder->>chipBuilder: per field: does doc value match answer?<br/>build label via CHIP_LABEL_BUILDERS[field]
            chipBuilder-->>BootFinderCtrl: chips[] e.g. ["Electrical Ready","Composite Toe","8\" Shaft"]
        end

        BootFinderCtrl-->>bootFinderJS: render bootfinder/resultsGrid<br/>{results: [{vgId, name, image, price, bvRating, bvReviewCount, chips}]}
    end
```

---

## 6. Comparison Tool

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
    compareJS->>Browser: navigate to /Compare-Show?pids=id1,id2,...

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
            compareModel->>compareModel: getActiveRows() — include/exclude rows by feature flag
            compareModel->>featureFlags: isEnabled('SHAFT_HEIGHT_RANGE')<br/>isEnabled('WATERPROOF_QUESTION')<br/>isEnabled('INSULATION_QUESTION')<br/>isEnabled('REVIEW_COUNT_BOOST')
            featureFlags-->>compareModel: booleans
            loop Per doc (column)
                compareModel->>identity: fromBloomreachHit(doc)
                identity-->>compareModel: {vgId, skuId}
                compareModel->>compareModel: extract attribute values for active rows
            end
            compareModel-->>CompareCtrl: {rows: [...], columns: [...]}
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
        compareJS->>CompareCtrl: GET /Compare-Show?pids=remaining,ids (AJAX)
        CompareCtrl-->>compareJS: updated table HTML
        compareJS->>DOM: replaceWith new table HTML
    end
```

---

## 7. Work / Job Landing Page

Attribute-filtered browse page for a trade job type (e.g. `/Work-JobLanding?jobType=electrical`).
Uses the same query-building helper as Boot Finder Question 1 (job-type selection) and supports standard SFRA page caching.

```mermaid
sequenceDiagram
    participant Browser
    participant WorkCtrl as Work Controller<br/>(JobLanding)
    participant sfraCache as cache.applyDefaultCache<br/>(SFRA standard)
    participant featureFlags as featureFlags
    participant jobTypeHelper as jobTypeHelper
    participant attrQueryHelper as bloomreachAttributeQueryHelper
    participant inventoryBury as inventoryBuryHelper
    participant SitePrefs as Site Custom Prefs
    participant bloomreachService as bloomreachService
    participant BloomreachAPI as Bloomreach Discovery API
    participant identity as bloomreachIdentity
    participant PageMgr as PageMgr<br/>(SFCC Page Designer)

    Browser->>WorkCtrl: GET /Work-JobLanding?jobType=electrical
    WorkCtrl->>sfraCache: applyDefaultCache()
    Note over sfraCache: Standard SFRA page cache (NOT no-cache,<br/>unlike Boot Finder / Compare)
    sfraCache-->>WorkCtrl: next()

    WorkCtrl->>featureFlags: isEnabled('JOB_TYPE')
    alt JOB_TYPE disabled
        featureFlags-->>WorkCtrl: false
        WorkCtrl-->>Browser: render work/jobLandingNotFound
    else JOB_TYPE enabled
        featureFlags-->>WorkCtrl: true
        WorkCtrl->>jobTypeHelper: getBySlug('electrical')
        jobTypeHelper->>featureFlags: isEnabled('JOB_TYPE') (guard inside getJobTypes())
        featureFlags-->>jobTypeHelper: true
        jobTypeHelper->>jobTypeHelper: find slug in JOB_TYPES[]
        alt Slug not found
            jobTypeHelper-->>WorkCtrl: null
            WorkCtrl-->>Browser: render work/jobLandingNotFound
        else Slug found
            jobTypeHelper-->>WorkCtrl: {value:'electrical', slug:'electrical', label:'Electrical'}

            WorkCtrl->>attrQueryHelper: queryByAttributes({answers:{job_type:'electrical'},<br/>hardFields:[], reviewCountBoostEnabled, salesRankTiebreakEnabled, rows:30})
            attrQueryHelper->>attrQueryHelper: buildFilterQueries(answers)<br/>soft boost fq: job_type:"electrical"^1.5
            attrQueryHelper->>inventoryBury: getBuryFilterQuery()
            inventoryBury->>SitePrefs: getCustomPreferenceValue('lowStockBuryThreshold')
            SitePrefs-->>inventoryBury: threshold
            inventoryBury-->>attrQueryHelper: bury fq fragment
            attrQueryHelper->>bloomreachService: call({fq, sort, rows:30})
            bloomreachService->>BloomreachAPI: GET /?fq=job_type:"electrical"^1.5 AND ...
            BloomreachAPI-->>bloomreachService: JSON {response: {docs: [...]}}
            bloomreachService-->>attrQueryHelper: parsed response
            attrQueryHelper-->>WorkCtrl: bloomreachResponse (or null)

            WorkCtrl->>WorkCtrl: map docs → [{vgId, name, image, price}]<br/>via bloomreachIdentity.fromBloomreachHit()

            WorkCtrl->>PageMgr: getPage('work-joblanding-electrical')
            PageMgr-->>WorkCtrl: contentPage (Page Designer content zone)

            WorkCtrl-->>Browser: render work/jobLanding<br/>{jobType, products[], contentPage, serviceFailed}
        end
    end
```

---

## 8. Loomi Conversational Search (Feature-Flagged Stub)

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
                        Transaction->>ContentMgr: createContent(contentId)
                        Transaction->>ContentMgr: folder('work-thematic-pages').assignContent(content)
                    else exists
                        ContentMgr-->>Transaction: content
                    end
                    Transaction->>Transaction: content.setOnline(docs.length > 0)<br/>(offline = no in-stock products; protects SEO)
                    alt has products
                        Transaction->>Transaction: content.custom.body = schemaOrgJSON<br/>content.custom.productCount = N
                    end
                    Transaction-->>GenerateTP: committed
                end
                GenerateTP->>GenerateTP: processed++
            end
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

```mermaid
sequenceDiagram
    participant Any as Any Feature Controller
    participant featureFlags as featureFlags
    participant constants as bloomreachConstants
    participant SitePrefs as Site Custom Prefs<br/>(SFCC)
    participant logger as bloomreachLogger
    participant dw_Logger as dw.system.Logger<br/>(SFCC)

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
```
