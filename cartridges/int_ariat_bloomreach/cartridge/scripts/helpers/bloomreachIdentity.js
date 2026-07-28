'use strict';

var constants = require('./bloomreachConstants');

/**
 * R-Identity gate: enforces the VG-vs-SKU rule from the integration spec.
 * Every feature that forwards an id to Bloomreach (or reads one back) must
 * pass through here rather than assuming shape.
 */

var VG_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

/**
 * Asserts a value looks like a Variation Group id and was NOT sourced from
 * dw.catalog.Product.getMasterProduct() (Base Product) or a bare Variant.
 * SFCC has no reliable runtime way to tell a VG id from a Base Product id by
 * shape alone, so callers MUST pass the ProductSearchHit / Product instance
 * so we can check isVariationGroup() explicitly - this function fails loudly
 * rather than guessing.
 *
 * @param {dw.catalog.Product} product
 * @returns {string} the Variation Group id
 */
function requireVariationGroupId(product) {
    if (!product) {
        throw new Error('bloomreachIdentity.requireVariationGroupId: product is required');
    }
    if (typeof product.isVariationGroup === 'function' && !product.isVariationGroup()) {
        throw new Error('bloomreachIdentity.requireVariationGroupId: product ' + product.ID
            + ' is not a Variation Group - refusing to send it to Bloomreach as a "product" id');
    }
    return product.ID;
}

/**
 * Asserts a value looks like a Variation (SKU) id.
 *
 * @param {dw.catalog.Product} variant
 * @returns {string} the Variation id
 */
function requireVariantId(variant) {
    if (!variant) {
        throw new Error('bloomreachIdentity.requireVariantId: variant is required');
    }
    if (typeof variant.isVariant === 'function' && !variant.isVariant()) {
        throw new Error('bloomreachIdentity.requireVariantId: product ' + variant.ID
            + ' is not a Variant - refusing to send it to Bloomreach as a "sku" id');
    }
    return variant.ID;
}

/**
 * Maps a raw Bloomreach search hit into { vgId, skuId } using the documented
 * field names, so nothing downstream re-derives field names ad hoc.
 *
 * @param {Object} hit - raw Bloomreach result record
 * @returns {{vgId: string, skuId: string}}
 */
function fromBloomreachHit(hit) {
    if (!hit) {
        return { vgId: null, skuId: null };
    }
    return {
        vgId: hit[constants.IDENTITY.PID_FIELD] || null,
        skuId: hit[constants.IDENTITY.SKU_FIELD] || null
    };
}

function isWellFormedId(id) {
    return typeof id === 'string' && VG_ID_PATTERN.test(id);
}

module.exports = {
    requireVariationGroupId: requireVariationGroupId,
    requireVariantId: requireVariantId,
    fromBloomreachHit: fromBloomreachHit,
    isWellFormedId: isWellFormedId
};
