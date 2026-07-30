'use strict';

/**
 * Falls back to SFCC's native product search (dw.catalog.ProductSearchModel /
 * ProductMgr) when the Bloomreach service is unreachable, for the live
 * shopper-facing routes that call Bloomreach directly: Boot Finder Results,
 * Work Job Landing, and Compare-Show. GenerateThematicPages (the nightly
 * batch job) deliberately does NOT use this - a stale-but-valid page from
 * the last successful run is a better outcome for a background job than a
 * same-run dw-search substitute, so it keeps its existing skip-and-log-error
 * behavior on a Bloomreach failure (see that job's own comments).
 *
 * ASSUMPTION (flagged per this cartridge's existing convention of calling
 * out unverified integration points): every field in bloomreachConstants
 * .ATTRIBUTES (job_type, Toe_Shape, Safety_Toe, Shaft_Height, safety_specs,
 * feature_waterproof, warmth_rating) plus bvRating/bvReviewCount are real,
 * refinable SFCC Product custom/system attribute IDs, not just Bloomreach
 * index field names - plausible since bvRating/bvReviewCount would already
 * be synced onto Product by a Bazaarvoice-style integration. Verify these
 * attribute IDs (and that they're marked refinable in Business Manager)
 * against the real catalog before shipping; only this module needs to
 * change if they differ.
 *
 * Response shape matches services/bloomreachService.js's contract
 * ({response: {docs: [...]}}), and each doc carries the same fields a
 * Bloomreach hit would (pid, title, thumb_image, price, the ATTRIBUTES
 * fields, bvRating, bvReviewCount), so every existing consumer (rationale
 * chips, compareModel, thematic markup) works unmodified regardless of
 * which source produced the docs.
 *
 * Degradation accepted for this fallback: SFCC's attribute refinement has
 * no boost concept, so every answer becomes a hard filter here (Bloomreach's
 * soft-boosted questions - shaft height, waterproof, insulation - may
 * narrow results more strictly than usual), and {min,max} range answers
 * (e.g. shaft_height_in) aren't refinable this way and are skipped entirely
 * rather than guessed at. Ranking is also applied to at most
 * MAX_FALLBACK_HITS hits rather than the whole result set - see that
 * constant for why an unbounded drain is the wrong call on this path.
 */

var ProductSearchModel = require('dw/catalog/ProductSearchModel');
var ProductMgr = require('dw/catalog/ProductMgr');
var CatalogMgr = require('dw/catalog/CatalogMgr');
var constants = require('./bloomreachConstants');
var identity = require('./bloomreachIdentity');

var ATTR = constants.ATTRIBUTES;
var ATTRIBUTE_FIELDS = Object.keys(ATTR).map(function (key) { return ATTR[key]; });

/**
 * Upper bound on hits pulled out of the search iterator before sorting.
 *
 * This path only ever runs when Bloomreach is already unreachable, so the
 * request has ALREADY spent the service profile's full timeout before
 * reaching here and a live shopper is waiting. Draining an unbounded
 * iterator (a broad refinement on a full catalog can be tens of thousands
 * of hits) on top of that turns a degraded page into a timed-out one.
 *
 * Accepted degradation, on top of the two this module already documents:
 * ranking below is applied to at most this many hits, so for a very broad
 * refinement the sort is over a catalog-order prefix rather than the whole
 * result set. That is the right trade during an outage - and it is bounded
 * well above the largest `rows` any caller asks for (30, Work Job Landing),
 * so the shopper still gets a full page of results either way.
 */
var MAX_FALLBACK_HITS = 500;

/**
 * @param {dw.catalog.Product} product
 * @returns {Object|null} a Bloomreach-hit-shaped doc, or null if product is
 *   missing or isn't a Variation Group (never surfaced as a "pid" otherwise,
 *   per bloomreachIdentity's rule)
 */
function toDoc(product) {
    if (!product) {
        return null;
    }

    var vgId;
    try {
        vgId = identity.requireVariationGroupId(product);
    } catch (e) {
        return null;
    }

    var doc = {};
    doc[constants.IDENTITY.PID_FIELD] = vgId;
    doc.title = product.name;

    var image = product.getImage('small');
    doc.thumb_image = image ? image.getURL().toString() : null;

    var price = product.getPriceModel().getPrice();
    doc.price = price && price.available ? price.value : null;

    ATTRIBUTE_FIELDS.forEach(function (field) {
        doc[field] = product.custom[field];
    });

    return doc;
}

function sortDocs(docs, params) {
    return docs.slice().sort(function (a, b) {
        var byRating = (b[ATTR.BV_RATING] || 0) - (a[ATTR.BV_RATING] || 0);
        if (byRating !== 0) {
            return byRating;
        }
        if (params.reviewCountBoostEnabled) {
            var byReviewCount = (b[ATTR.BV_REVIEW_COUNT] || 0) - (a[ATTR.BV_REVIEW_COUNT] || 0);
            if (byReviewCount !== 0) {
                return byReviewCount;
            }
        }
        if (params.salesRankTiebreakEnabled) {
            return (b[ATTR.SALES_RANK_BUCKET] || 0) - (a[ATTR.SALES_RANK_BUCKET] || 0);
        }
        return 0;
    });
}

/**
 * Same params shape as bloomreachAttributeQueryHelper.queryByAttributes.
 *
 * @param {Object} params
 * @returns {Object} Bloomreach-shaped response ({response: {docs: [...]}})
 */
function queryByAttributes(params) {
    var searchModel = new ProductSearchModel();
    searchModel.setOrderableProductsOnly(true);
    searchModel.setRecursiveCategorySearch(true);

    // ProductSearchModel needs a search phrase or a category to search
    // WITHIN - refinement values alone narrow a result set, they don't
    // produce one, so without this the fallback returns zero products in
    // exactly the outage it exists for (silently: an empty grid, not an
    // error). Anchoring at the site catalog's root category plus the
    // recursive flag above is the "whole catalog" equivalent, which is the
    // scope the Bloomreach query this stands in for already had.
    var siteCatalog = CatalogMgr.getSiteCatalog();
    var root = siteCatalog ? siteCatalog.getRoot() : null;
    if (root) {
        searchModel.setCategoryID(root.getID());
    }

    Object.keys(params.answers || {}).forEach(function (field) {
        var value = params.answers[field];
        if (value === undefined || value === null || value === '' || typeof value === 'object') {
            return; // range answers (e.g. shaft_height_in {min,max}) aren't supported by this fallback
        }
        searchModel.addRefinementValues(field, String(value));
    });

    searchModel.search();

    var docs = [];
    var hits = searchModel.getProductSearchHits();
    while (hits.hasNext() && docs.length < MAX_FALLBACK_HITS) {
        var doc = toDoc(hits.next().getProduct());
        if (doc) {
            docs.push(doc);
        }
    }

    docs = sortDocs(docs, params);
    var start = params.start || 0;
    var rows = params.rows || 24;

    return { response: { docs: docs.slice(start, start + rows) } };
}

/**
 * @param {string[]} vgIds
 * @returns {Object} Bloomreach-shaped response ({response: {docs: [...]}})
 */
function lookupByIds(vgIds) {
    var docs = (vgIds || [])
        .filter(identity.isWellFormedId)
        .map(function (id) { return toDoc(ProductMgr.getProduct(id)); })
        .filter(Boolean);

    return { response: { docs: docs } };
}

module.exports = {
    queryByAttributes: queryByAttributes,
    lookupByIds: lookupByIds
};
