'use strict';

var server = require('server');
var interactiveCache = require('*/cartridge/scripts/middleware/interactiveCache');
var attributeQueryHelper = require('*/cartridge/scripts/helpers/bloomreachAttributeQueryHelper');
var identity = require('*/cartridge/scripts/helpers/bloomreachIdentity');
var featureFlags = require('*/cartridge/scripts/helpers/featureFlags');
var bloomreachLogger = require('*/cartridge/scripts/helpers/bloomreachLogger');
var bloomreachPersonalizationIdentity = require('*/cartridge/scripts/helpers/bloomreachPersonalizationIdentity');
var bloomreachConstants = require('*/cartridge/scripts/helpers/bloomreachConstants');

var FEATURE = 'ThematicPagePersonalized';
var STRIP_ROWS = 8;

/**
 * R-38: 1:1-personalized "recommended for you" fragment embedded directly
 * into each generated Thematic Page's static body - see
 * jobs/GenerateThematicPages.js's buildPersonalizedStripPlaceholder(),
 * which builds this route's full URL (jobType/toeShape/safetySpec query
 * params) at generation time from the SAME combo fields the page's own
 * product grid was built from. Fetched client-side by the same generic
 * client module Work-JobLanding's fragment uses
 * (client/default/js/work/jobLandingPersonalizedStrip.js - a plain
 * [data-personalized-strip-url] attribute selector, not scoped to any one
 * page type), so no new client JS was needed for this feature.
 *
 * Unlike Work-JobLanding's fragment, Thematic Pages have no separate
 * non-personalized content-zone mechanism to fall back to - the page's
 * own static product grid (with Comparison Tool checkboxes) already IS
 * the non-personalized experience, baked into the cached page itself, not
 * a swappable content zone. So (matching the PDP/Category fragments) this
 * renders nothing at all when ineligible or on failure, rather than
 * inventing a fallback data source that doesn't exist.
 *
 * Uses the SAME hard-filtered job_type/toe_shape/safety_specs shape
 * GenerateThematicPages.js's own query uses (topically consistent with the
 * page the shopper is already on), plus user_id, so the personalization
 * this fragment adds is in the product SELECTION/RANKING Bloomreach
 * returns for that combination, not in loosening the page's own theme.
 */
server.get('PersonalizedStrip', interactiveCache.applyNoCache, function (req, res, next) {
    var jobType = req.querystring.jobType;

    if (!jobType || !featureFlags.isEnabled('JOB_TYPE')) {
        res.render('thematicPage/personalizedStrip', { products: null });
        next();
        return;
    }

    var shopperIdentity = bloomreachPersonalizationIdentity
        .resolveShopperIdentity(req.currentCustomer && req.currentCustomer.raw);

    if (!shopperIdentity.userId) {
        res.render('thematicPage/personalizedStrip', { products: null });
        next();
        return;
    }

    var products = null;
    try {
        var answers = {};
        answers[bloomreachConstants.ATTRIBUTES.JOB_TYPE] = jobType;
        if (req.querystring.toeShape) {
            answers[bloomreachConstants.ATTRIBUTES.TOE_SHAPE] = req.querystring.toeShape;
        }
        if (req.querystring.safetySpec) {
            answers[bloomreachConstants.ATTRIBUTES.SAFETY_SPECS] = req.querystring.safetySpec;
        }

        var hardFields = [
            bloomreachConstants.ATTRIBUTES.JOB_TYPE,
            bloomreachConstants.ATTRIBUTES.TOE_SHAPE,
            bloomreachConstants.ATTRIBUTES.SAFETY_SPECS
        ];

        var bloomreachResponse = attributeQueryHelper.queryByAttributes({
            answers: answers,
            hardFields: hardFields,
            reviewCountBoostEnabled: featureFlags.isEnabled('REVIEW_COUNT_BOOST'),
            salesRankTiebreakEnabled: featureFlags.isEnabled('SALES_RANK_TIEBREAK'),
            rows: STRIP_ROWS,
            userId: shopperIdentity.userId
        }, FEATURE);

        var docs = bloomreachResponse && bloomreachResponse.response ? bloomreachResponse.response.docs : null;
        if (docs && docs.length) {
            products = docs.map(function (doc) {
                var ids = identity.fromBloomreachHit(doc);
                return { vgId: ids.vgId, name: doc.title, image: doc.thumb_image, price: doc.price };
            });
        }
    } catch (e) {
        bloomreachLogger.logWarn(FEATURE, '1:1 personalization call failed', { error: e.message });
    }

    res.render('thematicPage/personalizedStrip', { products: products });
    next();
});

module.exports = server.exports();
