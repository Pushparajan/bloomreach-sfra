'use strict';

/**
 * R-39: derives short, data-driven badge labels for a product tile - "Top
 * Rated", "Best Seller", "In N+ Carts" - from fields already on a
 * Bloomreach hit (bvRating, bvReviewCount, sales_rank_bucket) plus one new,
 * UNCONFIRMED field (cart_add_count - see bloomreachConstants.js's own
 * comment on it). Shared by GenerateThematicPages (the static thematic-page
 * product grid) and every 1:1-personalization fragment controller (Work,
 * Product, Search, ThematicPage's PersonalizedStrip/PersonalizedRail
 * routes) so badge thresholds and labels live in exactly one place, per
 * this cartridge's existing convention (see bloomreachAttributeQueryHelper's
 * own header comment on why shared query logic isn't duplicated between
 * Boot Finder and Work-JobLanding - same reasoning applies here).
 *
 * Deliberately scoped to Thematic Pages and product-recommendation
 * fragments only, per the request that introduced this - Boot Finder
 * results and the Comparison Tool table are not "SEO pages" or
 * "recommendations" and are unaffected.
 *
 * ASSUMPTION: `sales_rank_bucket`'s scale isn't confirmed anywhere in this
 * codebase (TECHNO_FUNCTIONAL_GUIDE.md only documents it as "sales
 * velocity bucket," no range given). BEST_SELLER_MIN_SALES_RANK_BUCKET
 * below assumes a 1-10 scale where 10 is best; confirm the real scale with
 * the Bloomreach account team and adjust the threshold if it differs -
 * only this module needs to change.
 */

var constants = require('./bloomreachConstants');

var ATTR = constants.ATTRIBUTES;

var TOP_RATED_MIN_RATING = 4.5;
var TOP_RATED_MIN_REVIEWS = 20;
var BEST_SELLER_MIN_SALES_RANK_BUCKET = 8; // assumes a 1-10 scale, see ASSUMPTION above
var CART_TRENDING_MIN_COUNT = 10; // below this, "in N+ carts" isn't a meaningful signal
var CART_TRENDING_BUCKET_SIZE = 10; // rounds down to the nearest 10, e.g. 51 -> "In 50+ Carts"

/**
 * @param {Object} doc - a Bloomreach-hit-shaped doc (bvRating, bvReviewCount,
 *   sales_rank_bucket, cart_add_count - all optional)
 * @returns {{key: string, label: string}[]} badges, most-relevant first;
 *   empty array when no threshold is met - never fabricated
 */
function buildBadges(doc) {
    var badges = [];
    if (!doc) {
        return badges;
    }

    var rating = doc[ATTR.BV_RATING];
    var reviewCount = doc[ATTR.BV_REVIEW_COUNT];
    if (rating >= TOP_RATED_MIN_RATING && reviewCount >= TOP_RATED_MIN_REVIEWS) {
        badges.push({ key: 'topRated', label: 'Top Rated' });
    }

    var salesRankBucket = doc[ATTR.SALES_RANK_BUCKET];
    if (salesRankBucket >= BEST_SELLER_MIN_SALES_RANK_BUCKET) {
        badges.push({ key: 'bestSeller', label: 'Best Seller' });
    }

    var cartAddCount = doc[ATTR.CART_ADD_COUNT];
    if (cartAddCount >= CART_TRENDING_MIN_COUNT) {
        var rounded = Math.floor(cartAddCount / CART_TRENDING_BUCKET_SIZE) * CART_TRENDING_BUCKET_SIZE;
        badges.push({ key: 'trending', label: 'In ' + rounded + '+ Carts' });
    }

    return badges;
}

module.exports = {
    buildBadges: buildBadges,
    TOP_RATED_MIN_RATING: TOP_RATED_MIN_RATING,
    TOP_RATED_MIN_REVIEWS: TOP_RATED_MIN_REVIEWS,
    BEST_SELLER_MIN_SALES_RANK_BUCKET: BEST_SELLER_MIN_SALES_RANK_BUCKET,
    CART_TRENDING_MIN_COUNT: CART_TRENDING_MIN_COUNT
};
