'use strict';

var server = require('server');

server.extend(module.superModule);

var interactiveCache = require('*/cartridge/scripts/middleware/interactiveCache');
var attributeQueryHelper = require('*/cartridge/scripts/helpers/bloomreachAttributeQueryHelper');
var identity = require('*/cartridge/scripts/helpers/bloomreachIdentity');
var bloomreachLogger = require('*/cartridge/scripts/helpers/bloomreachLogger');
var bloomreachPersonalizationIdentity = require('*/cartridge/scripts/helpers/bloomreachPersonalizationIdentity');
var bloomreachConstants = require('*/cartridge/scripts/helpers/bloomreachConstants');
var productBadgeBuilder = require('*/cartridge/scripts/helpers/productBadgeBuilder');
var productBlurbBuilder = require('*/cartridge/scripts/helpers/productBlurbBuilder');
var ProductMgr = require('dw/catalog/ProductMgr');
var URLUtils = require('dw/web/URLUtils');

var FEATURE = 'PDPPersonalized';
var STRIP_ROWS = 8;

/**
 * R-38: appends a personalized-fragment URL onto the base PDP's existing
 * render data. Nothing the base Product-Show controller already computed
 * (images, price, size/color, reviews, SEO) is touched - this is strictly
 * additive, so the shell's own cacheability (whatever the base controller
 * already configures) is unaffected. The client fetches the fragment
 * itself without needing this value (see
 * client/default/js/shared/personalizedFragment.js), but it's appended
 * here too for forward-compatibility with a future server-rendered/remote-
 * include version of this same fragment.
 */
server.append('Show', function (req, res, next) {
    var pid = req.querystring.pid;
    if (pid) {
        var viewData = res.getViewData();
        viewData.personalizedStripUrl = URLUtils.url('Product-PersonalizedStrip', 'pid', pid).toString();
        res.setViewData(viewData);
    }
    next();
});

/**
 * R-38: 1:1-personalized "recommended with this" fragment for the PDP
 * shell above. Same shell/fragment pattern as Work-PersonalizedStrip
 * (controllers/Work.js) - never shared-cached (interactiveCache.applyNoCache),
 * and a personalization failure must never break this fragment or the
 * surrounding page.
 *
 * ASSUMPTION - two gaps, flagged rather than guessed:
 *   1. No dedicated Bloomreach "similar items" / "related products" widget
 *      endpoint is confirmed for this integration - the service layer here
 *      only models the fq-based attribute-query shape used everywhere else
 *      in this cartridge (see helpers/bloomreachAttributeQueryHelper.js's
 *      own header comment). This fragment approximates "related" by
 *      filtering on the CURRENT product's own job_type attribute as a
 *      proxy, excluding the product being viewed from the results. Confirm
 *      the real recommendations/similar-items request shape with the
 *      Bloomreach account team before shipping; only this route needs to
 *      change if a dedicated endpoint exists.
 *   2. "Recently viewed" (mentioned alongside "recommended with this" in
 *      the shell/fragment design) is NOT implemented - no product-view-
 *      history mechanism exists anywhere in this codebase to build it
 *      from. This fragment is "recommended with this" only.
 *   3. Unlike Work-JobLanding's fragment, there is no confirmed existing
 *      non-personalized PDP recommendation content zone to fall back to
 *      when the flag is off/guest/failure - so this fragment renders
 *      nothing at all in those cases (client-side placeholder collapses),
 *      rather than "the same fallback content" the Work Job Landing
 *      pattern uses. Flagging this rather than inventing a fallback data
 *      source that doesn't exist.
 */
server.get('PersonalizedStrip', interactiveCache.applyNoCache, function (req, res, next) {
    var pid = req.querystring.pid;
    var product = pid ? ProductMgr.getProduct(pid) : null;

    if (!product) {
        res.render('product/personalizedStrip', { products: null });
        next();
        return;
    }

    var shopperIdentity = bloomreachPersonalizationIdentity
        .resolveShopperIdentity(req.currentCustomer && req.currentCustomer.raw);

    if (!shopperIdentity.userId) {
        res.render('product/personalizedStrip', { products: null });
        next();
        return;
    }

    var products = null;
    var stripDocs = null;
    var stripJobType = null;
    try {
        var jobType = product.custom[bloomreachConstants.ATTRIBUTES.JOB_TYPE];
        stripJobType = jobType;
        var answers = {};
        if (jobType) {
            answers[bloomreachConstants.ATTRIBUTES.JOB_TYPE] = jobType;
        }

        var bloomreachResponse = attributeQueryHelper.queryByAttributes({
            answers: answers,
            rows: STRIP_ROWS,
            userId: shopperIdentity.userId
        }, FEATURE);

        var docs = bloomreachResponse && bloomreachResponse.response ? bloomreachResponse.response.docs : null;
        if (docs && docs.length) {
            // Exclude the product already being viewed BEFORE anything else,
            // so both the tiles and the blurb describe the same set.
            stripDocs = docs.filter(function (doc) {
                var ids = identity.fromBloomreachHit(doc);
                return ids.vgId && ids.vgId !== pid;
            });
            products = stripDocs.map(function (doc) {
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

    var hasProducts = products && products.length;
    res.render('product/personalizedStrip', {
        products: hasProducts ? products : null,
        // R-39: dynamic blurb describing this strip's actual contents.
        blurb: hasProducts ? productBlurbBuilder.buildBlurb(stripDocs, { jobType: stripJobType }) : null
    });
    next();
});

module.exports = server.exports();
