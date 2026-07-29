'use strict';

var server = require('server');
var cache = require('*/cartridge/scripts/middleware/cache');
var interactiveCache = require('*/cartridge/scripts/middleware/interactiveCache');
var jobTypeHelper = require('*/cartridge/scripts/shared/jobTypeHelper');
var attributeQueryHelper = require('*/cartridge/scripts/helpers/bloomreachAttributeQueryHelper');
var identity = require('*/cartridge/scripts/helpers/bloomreachIdentity');
var featureFlags = require('*/cartridge/scripts/helpers/featureFlags');
var bloomreachLogger = require('*/cartridge/scripts/helpers/bloomreachLogger');
var dwSearchFallbackHelper = require('*/cartridge/scripts/helpers/dwSearchFallbackHelper');
var bloomreachPersonalizationIdentity = require('*/cartridge/scripts/helpers/bloomreachPersonalizationIdentity');
var productBadgeBuilder = require('*/cartridge/scripts/helpers/productBadgeBuilder');
var productBlurbBuilder = require('*/cartridge/scripts/helpers/productBlurbBuilder');
var PageMgr = require('dw/experience/PageMgr');
var URLUtils = require('dw/web/URLUtils');

var FEATURE = 'WorkJobLanding';
var PERSONALIZED_FEATURE = 'WorkJobLandingPersonalized'; // tagged distinctly per R-38's logging requirement
var PERSONALIZED_STRIP_ROWS = 8;

function toProductList(docs) {
    return (docs || []).map(function (doc) {
        var ids = identity.fromBloomreachHit(doc);
        return {
            vgId: ids.vgId,
            name: doc.title,
            image: doc.thumb_image,
            price: doc.price
        };
    });
}

/**
 * /work/{jobType} - resolves a job-type slug to a Bloomreach category-widget
 * query. Uses the SAME query-building helper Boot Finder Q1 uses
 * (bloomreachAttributeQueryHelper + jobTypeHelper) rather than duplicating
 * filter-building logic, per spec.
 *
 * Caching: standard SFRA page-cache pragma (this route is content-weighted
 * and may cache normally, unlike Boot Finder/Compare) - see
 * cache.applyDefaultCache below, NOT the interactiveCache middleware used by
 * the two stateful features.
 *
 * R-38: this shell is UNCHANGED by 1:1 personalization - hero/copy/tiles and
 * this generic job_type-filtered product grid vary by job type only, never
 * by shopper, so none of it should ever be pulled behind interactiveCache.
 * The one piece of this page that CAN vary per individual shopper (the
 * content-zone slot) has been extracted into a separate, uncached fragment
 * - see `PersonalizedStrip` below - fetched client-side after this shell
 * loads, so this route's own cacheability is untouched.
 */
server.get('JobLanding', cache.applyDefaultCache, function (req, res, next) {
    var jobType = jobTypeHelper.getBySlug(req.params.jobType || req.querystring.jobType);

    if (!featureFlags.isEnabled('JOB_TYPE') || !jobType) {
        res.render('work/jobLandingNotFound');
        next();
        return;
    }

    var queryParams = {
        answers: jobTypeHelper.toAnswerFilter(jobType.value),
        hardFields: [], // soft-boosted, same shape as Boot Finder Q1 rather than a hard filter-only page
        reviewCountBoostEnabled: featureFlags.isEnabled('REVIEW_COUNT_BOOST'),
        salesRankTiebreakEnabled: featureFlags.isEnabled('SALES_RANK_TIEBREAK'),
        rows: 30
    };
    var bloomreachResponse = attributeQueryHelper.queryByAttributes(queryParams, FEATURE);

    // Bloomreach unreachable - fall back to SFCC's native product search
    // rather than showing the service-failure message, since a live
    // shopper is waiting. See helpers/dwSearchFallbackHelper for the
    // accepted degradation (hard filters only, no range-answer support).
    if (!bloomreachResponse) {
        try {
            bloomreachResponse = dwSearchFallbackHelper.queryByAttributes(queryParams);
        } catch (e) {
            bloomreachLogger.logWarn(FEATURE, 'dw search fallback failed', { error: e.message });
        }
    }

    var docs = bloomreachResponse && bloomreachResponse.response ? bloomreachResponse.response.docs : [];

    res.render('work/jobLanding', {
        jobType: jobType,
        products: toProductList(docs),
        personalizedStripUrl: URLUtils.url('Work-PersonalizedStrip', 'jobType', jobType.slug),
        serviceFailed: !bloomreachResponse
    });
    next();
});

/**
 * R-38: 1:1-personalized content-zone fragment for the Work Job Landing
 * shell above. A standalone, independently callable controller (rather than
 * assuming a client-side fetch) so it can be wrapped in an SFRA remote
 * include later without re-architecting the endpoint - see the shell's own
 * client-side fetch wiring in client/default/js/work/jobLandingPersonalizedStrip.js
 * for the default (client-fetch) integration used today.
 *
 * Always renders SOMETHING usable, never an error state:
 *   - flag off, or guest, or Bloomreach call fails/returns nothing →
 *     the EXISTING segment-level Page Designer content zone
 *     ('work-joblanding-{slug}') this page has always used, unchanged.
 *   - flag on AND logged in AND Bloomreach succeeds → a small
 *     Bloomreach-personalized product strip using user_id.
 *
 * No shared/CDN cache TTL on this response (interactiveCache.applyNoCache) -
 * that would defeat the entire point of extracting individual-level content
 * out of the shell. A short, per-user micro-cache would be a reasonable
 * rapid-reload optimization but is NOT implemented here (see "Assumptions
 * Made"); this route already relies on the Bloomreach Service Profile's own
 * configured timeout (same mechanism every other Bloomreach call in this
 * cartridge relies on) to bound how long a shopper waits before falling
 * back - a dedicated shorter timeout would require its own Service Profile
 * in Business Manager, which is a configuration change, not a code change.
 */
server.get('PersonalizedStrip', interactiveCache.applyNoCache, function (req, res, next) {
    var jobType = jobTypeHelper.getBySlug(req.querystring.jobType);

    if (!featureFlags.isEnabled('JOB_TYPE') || !jobType) {
        res.render('work/personalizedStrip', { contentPage: null });
        next();
        return;
    }

    // R-38: gated on personalization.oneToOne.enabled. resolveShopperIdentity
    // returns a null userId whenever the flag is off or the shopper is a
    // guest - that IS the fallback trigger below, not an error state.
    var shopperIdentity = bloomreachPersonalizationIdentity
        .resolveShopperIdentity(req.currentCustomer && req.currentCustomer.raw);

    if (!shopperIdentity.userId) {
        res.render('work/personalizedStrip', {
            contentPage: PageMgr.getPage('work-joblanding-' + jobType.slug)
        });
        next();
        return;
    }

    var products = null;
    var stripDocs = null;
    try {
        var bloomreachResponse = attributeQueryHelper.queryByAttributes({
            answers: jobTypeHelper.toAnswerFilter(jobType.value),
            hardFields: [],
            reviewCountBoostEnabled: featureFlags.isEnabled('REVIEW_COUNT_BOOST'),
            salesRankTiebreakEnabled: featureFlags.isEnabled('SALES_RANK_TIEBREAK'),
            rows: PERSONALIZED_STRIP_ROWS,
            userId: shopperIdentity.userId
        }, PERSONALIZED_FEATURE);

        var docs = bloomreachResponse && bloomreachResponse.response ? bloomreachResponse.response.docs : null;
        if (docs && docs.length) {
            stripDocs = docs;
            // R-39: dynamic-data badges ("Top Rated", "Best Seller", "In N+
            // Carts") on this recommendation strip only - the shell's own
            // main grid (toProductList above) is unaffected.
            products = toProductList(docs).map(function (product, index) {
                return Object.assign({}, product, {
                    badges: productBadgeBuilder.buildBadges(docs[index])
                });
            });
        }
    } catch (e) {
        // A personalization failure must never break this fragment or the
        // surrounding page - fall through to the segment-level fallback.
        bloomreachLogger.logWarn(PERSONALIZED_FEATURE, '1:1 personalization call failed', { error: e.message });
    }

    if (!products) {
        res.render('work/personalizedStrip', {
            contentPage: PageMgr.getPage('work-joblanding-' + jobType.slug)
        });
        next();
        return;
    }

    res.render('work/personalizedStrip', {
        products: products,
        personalized: true,
        // R-39: dynamic blurb describing this strip's actual contents.
        blurb: productBlurbBuilder.buildBlurb(stripDocs, { jobType: jobType.value })
    });
    next();
});

module.exports = server.exports();
