'use strict';

var server = require('server');

server.extend(module.superModule);

var interactiveCache = require('*/cartridge/scripts/middleware/interactiveCache');
var attributeQueryHelper = require('*/cartridge/scripts/helpers/bloomreachAttributeQueryHelper');
var identity = require('*/cartridge/scripts/helpers/bloomreachIdentity');
var featureFlags = require('*/cartridge/scripts/helpers/featureFlags');
var bloomreachLogger = require('*/cartridge/scripts/helpers/bloomreachLogger');
var bloomreachPersonalizationIdentity = require('*/cartridge/scripts/helpers/bloomreachPersonalizationIdentity');
var productBadgeBuilder = require('*/cartridge/scripts/helpers/productBadgeBuilder');
var productBlurbBuilder = require('*/cartridge/scripts/helpers/productBlurbBuilder');
var jobTypeHelper = require('*/cartridge/scripts/shared/jobTypeHelper');
var URLUtils = require('dw/web/URLUtils');

var FEATURE = 'CategoryPersonalizedRail';
var RAIL_ROWS = 8;

/**
 * R-38: appends a personalized-rail URL onto the base Category
 * (Search-Show) shell's existing render data - never touches the shell's
 * own facet UI or main product grid. The fragment ADDS a rail; it does
 * NOT re-rank the grid. Full-grid personalization is out of scope for this
 * pattern (it needs a cache-variant redesign or the Next.js end state),
 * same scope boundary R-38 already drew around free-text Search/Autosuggest.
 *
 * ASSUMPTION: only categories that map to one of this integration's known
 * job types (shared/jobTypeHelper - the SAME taxonomy Work-JobLanding and
 * Boot Finder's Q1 already use) get a personalized rail at all. This
 * reuses an existing mechanism rather than inventing a generic category-
 * to-Bloomreach-facet mapping for the whole catalog, which is not
 * confirmed to exist. Every other category renders no rail (graceful
 * no-op), not a generic fallback.
 */
server.append('Show', function (req, res, next) {
    var categoryId = req.querystring.cgid;
    var jobType = categoryId ? jobTypeHelper.getBySlug(categoryId) : null;

    if (jobType) {
        var viewData = res.getViewData();
        viewData.personalizedRailUrl = URLUtils.url('Search-PersonalizedRail', 'cgid', categoryId).toString();
        res.setViewData(viewData);
    }
    next();
});

/**
 * R-38: 1:1-personalized "recommended for you" rail fragment for the
 * Category shell above. Same shell/fragment pattern as
 * Work-PersonalizedStrip and Product-PersonalizedStrip - never
 * shared-cached, and a personalization failure must never break this
 * fragment or the surrounding page.
 */
server.get('PersonalizedRail', interactiveCache.applyNoCache, function (req, res, next) {
    var jobType = jobTypeHelper.getBySlug(req.querystring.cgid);

    if (!jobType || !featureFlags.isEnabled('JOB_TYPE')) {
        res.render('search/personalizedRail', { products: null });
        next();
        return;
    }

    var shopperIdentity = bloomreachPersonalizationIdentity
        .resolveShopperIdentity(req.currentCustomer && req.currentCustomer.raw);

    if (!shopperIdentity.userId) {
        res.render('search/personalizedRail', { products: null });
        next();
        return;
    }

    var products = null;
    var railDocs = null;
    try {
        var bloomreachResponse = attributeQueryHelper.queryByAttributes({
            answers: jobTypeHelper.toAnswerFilter(jobType.value),
            hardFields: [],
            reviewCountBoostEnabled: featureFlags.isEnabled('REVIEW_COUNT_BOOST'),
            salesRankTiebreakEnabled: featureFlags.isEnabled('SALES_RANK_TIEBREAK'),
            rows: RAIL_ROWS,
            userId: shopperIdentity.userId
        }, FEATURE);

        var docs = bloomreachResponse && bloomreachResponse.response ? bloomreachResponse.response.docs : null;
        if (docs && docs.length) {
            railDocs = docs;
            products = docs.map(function (doc) {
                var ids = identity.fromBloomreachHit(doc);
                return {
                    vgId: ids.vgId,
                    name: doc.title,
                    image: doc.thumb_image,
                    price: doc.price,
                    // R-39: dynamic-data badges ("Top Rated", "Best Seller", "In N+ Carts")
                    badges: productBadgeBuilder.buildBadges(doc)
                };
            });
        }
    } catch (e) {
        bloomreachLogger.logWarn(FEATURE, '1:1 personalization call failed', { error: e.message });
    }

    res.render('search/personalizedRail', {
        products: products,
        // R-39: dynamic blurb describing this rail's actual contents.
        blurb: products ? productBlurbBuilder.buildBlurb(railDocs, { jobType: jobType.value }) : null
    });
    next();
});

module.exports = server.exports();
