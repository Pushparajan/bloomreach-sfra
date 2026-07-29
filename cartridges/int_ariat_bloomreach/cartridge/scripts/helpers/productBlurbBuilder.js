'use strict';

/**
 * R-39: builds a short, data-driven blurb sentence for a set of Bloomreach
 * hits - the SEO intro copy on a generated Thematic Page, and the lead-in
 * line above a product-recommendation strip.
 *
 * Why this exists: every generated Thematic Page otherwise shares identical
 * boilerplate copy, which reads as duplicate/thin content to search engines.
 * Deriving the sentence from the page's OWN aggregate product data (count,
 * price range, average rating, review volume, waterproof share) makes each
 * page's copy genuinely unique and, more importantly, accurate - it updates
 * itself on every nightly job run as the catalog changes, with no
 * merchandiser rewrite.
 *
 * Hard rule: every clause is emitted ONLY when the data backing it is
 * actually present and meaningful. A missing/empty field drops its clause
 * rather than producing "rated undefined out of 5" or a fabricated number.
 * If nothing qualifies, buildBlurb returns null and callers render no blurb
 * at all - the same never-fabricate posture as helpers/productBadgeBuilder.
 *
 * Deliberately NOT an LLM/generative-copy integration: no such service is
 * configured in this cartridge, and generated marketing prose would need
 * legal/brand review per page. This is deterministic sentence assembly from
 * numbers the feed already provides.
 */

var constants = require('./bloomreachConstants');

var ATTR = constants.ATTRIBUTES;

var MIN_PRODUCTS_FOR_BLURB = 3; // below this, aggregate stats aren't meaningful
var MIN_REVIEWS_FOR_RATING_CLAIM = 10; // don't advertise an average built on 2 reviews
var MIN_SHARE_FOR_FEATURE_CLAIM = 0.5; // only claim "most are waterproof" above this share

function round(value, places) {
    var factor = 10 ** (places || 0);
    return Math.round(value * factor) / factor;
}

function formatPrice(value) {
    return '$' + Math.round(value);
}

/**
 * @param {Object[]} docs - raw Bloomreach hits
 * @returns {Object} aggregate stats, with null for anything not derivable
 */
function summarize(docs) {
    var prices = [];
    var ratings = [];
    var totalReviews = 0;
    var waterproofCount = 0;

    docs.forEach(function (doc) {
        if (typeof doc.price === 'number' && doc.price > 0) {
            prices.push(doc.price);
        }
        var rating = doc[ATTR.BV_RATING];
        var reviewCount = doc[ATTR.BV_REVIEW_COUNT];
        if (typeof rating === 'number' && rating > 0 && typeof reviewCount === 'number' && reviewCount > 0) {
            // Weight each product's rating by its review volume, so a
            // 5-star/1-review item can't outweigh a 4.4-star/800-review one.
            ratings.push({ rating: rating, reviewCount: reviewCount });
            totalReviews += reviewCount;
        }
        if (doc[ATTR.FEATURE_WATERPROOF]) {
            waterproofCount += 1;
        }
    });

    var weightedRating = null;
    if (ratings.length && totalReviews >= MIN_REVIEWS_FOR_RATING_CLAIM) {
        var weightedSum = ratings.reduce(function (acc, entry) {
            return acc + (entry.rating * entry.reviewCount);
        }, 0);
        weightedRating = round(weightedSum / totalReviews, 1);
    }

    return {
        productCount: docs.length,
        minPrice: prices.length ? Math.min.apply(null, prices) : null,
        maxPrice: prices.length ? Math.max.apply(null, prices) : null,
        averageRating: weightedRating,
        totalReviews: weightedRating === null ? null : totalReviews,
        waterproofShare: docs.length ? waterproofCount / docs.length : 0
    };
}

/**
 * @param {Object[]} docs - raw Bloomreach hits backing the page/strip
 * @param {Object} [context] - descriptive labels for the set, all optional
 * @param {string} [context.jobType] - e.g. 'electrical'
 * @param {string} [context.toeShape] - e.g. 'Composite'
 * @param {string} [context.safetySpec] - e.g. 'EH'
 * @param {string} [context.noun] - defaults to 'work boots'
 * @returns {string|null} a single blurb sentence, or null when the data
 *   can't support one
 */
function buildBlurb(docs, context) {
    var hits = docs || [];
    if (hits.length < MIN_PRODUCTS_FOR_BLURB) {
        return null;
    }

    var ctx = context || {};
    var stats = summarize(hits);
    var noun = ctx.noun || 'work boots';

    // Lead clause: "Browse 24 composite toe electrical work boots"
    var descriptor = [ctx.toeShape ? ctx.toeShape.toLowerCase() + ' toe' : null, ctx.jobType]
        .filter(Boolean)
        .join(' ');
    var lead = 'Browse ' + stats.productCount + ' ' + (descriptor ? descriptor + ' ' : '') + noun;
    if (ctx.safetySpec) {
        lead += ' rated for ' + ctx.safetySpec;
    }

    var clauses = [];

    if (stats.minPrice !== null && stats.maxPrice !== null) {
        clauses.push(stats.minPrice === stats.maxPrice
            ? 'priced at ' + formatPrice(stats.minPrice)
            : 'from ' + formatPrice(stats.minPrice) + ' to ' + formatPrice(stats.maxPrice));
    }

    if (stats.averageRating !== null) {
        clauses.push('averaging ' + stats.averageRating + ' out of 5 stars across '
            + stats.totalReviews + ' customer reviews');
    }

    if (stats.waterproofShare >= MIN_SHARE_FOR_FEATURE_CLAIM) {
        clauses.push('with waterproof options available');
    }

    if (!clauses.length) {
        // Nothing beyond the bare count is derivable - a "Browse N boots."
        // sentence alone adds no SEO value over the H1, so emit nothing.
        return null;
    }

    return lead + ', ' + clauses.join(', ') + '.';
}

module.exports = {
    buildBlurb: buildBlurb,
    summarize: summarize,
    MIN_PRODUCTS_FOR_BLURB: MIN_PRODUCTS_FOR_BLURB,
    MIN_REVIEWS_FOR_RATING_CLAIM: MIN_REVIEWS_FOR_RATING_CLAIM
};
