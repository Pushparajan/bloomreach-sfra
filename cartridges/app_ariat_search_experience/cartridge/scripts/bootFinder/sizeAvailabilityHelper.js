'use strict';

/**
 * Size/width resolution happens at the SFCC variant level against the
 * existing catalog/inventory APIs, not as a new Bloomreach attribute (per
 * spec: "resolve at variant level against the existing size/inventory
 * service - do not add a new attribute for this"). This runs as a
 * post-filter over the VG ids Bloomreach already returned, so Bloomreach
 * stays the relevance/ranking source of truth and SFCC stays the
 * availability source of truth.
 */

var ProductMgr = require('dw/catalog/ProductMgr');

/**
 * @param {string[]} vgIds - Variation Group ids from the Bloomreach response
 * @param {string} [size]
 * @param {string} [width]
 * @returns {string[]} the subset of vgIds that have at least one orderable
 *   variant matching the requested size/width (or all of vgIds if no
 *   size/width was answered)
 */
function filterByAvailability(vgIds, size, width) {
    if (!size && !width) {
        return vgIds;
    }

    return vgIds.filter(function (vgId) {
        var variationGroup = ProductMgr.getProduct(vgId);
        if (!variationGroup || !variationGroup.isVariationGroup()) {
            return false;
        }
        var variants = variationGroup.getVariants();
        for (var i = 0; i < variants.length; i++) {
            var variant = variants[i];
            var matchesSize = !size || variant.custom.size === size;
            var matchesWidth = !width || variant.custom.width === width;
            if (matchesSize && matchesWidth && variant.availabilityModel.orderable) {
                return true;
            }
        }
        return false;
    });
}

module.exports = {
    filterByAvailability: filterByAvailability
};
