'use strict';

/**
 * Builds the attribute-row data for the comparison table. Each row is
 * flag-gated per the shared attribute table; a row whose flag is off is
 * omitted entirely rather than rendered blank/wrong, per spec.
 */

var constants = require('*/cartridge/scripts/helpers/bloomreachConstants');
var identity = require('*/cartridge/scripts/helpers/bloomreachIdentity');
var featureFlags = require('*/cartridge/scripts/helpers/featureFlags');

var ATTR = constants.ATTRIBUTES;

/**
 * @returns {{key: string, label: string, field: string|string[]}[]} rows
 *   that are currently eligible given feature flags
 */
function getActiveRows() {
    var rows = [
        { key: 'safetyToe', label: 'Safety Toe', field: ATTR.SAFETY_TOE },
        { key: 'toeShape', label: 'Toe Shape', field: ATTR.TOE_SHAPE },
        { key: 'shaftHeight', label: 'Shaft Height', field: ATTR.SHAFT_HEIGHT }
    ];

    if (featureFlags.isEnabled('SHAFT_HEIGHT_RANGE')) {
        rows.push({ key: 'shaftHeightIn', label: 'Shaft Height (in)', field: ATTR.SHAFT_HEIGHT_IN });
    }
    if (featureFlags.isEnabled('WATERPROOF_QUESTION')) {
        rows.push({ key: 'waterproof', label: 'Waterproof', field: ATTR.FEATURE_WATERPROOF });
    }
    if (featureFlags.isEnabled('INSULATION_QUESTION')) {
        rows.push({ key: 'warmthRating', label: 'Certification / Insulation', field: ATTR.WARMTH_RATING });
    }

    rows.push({
        key: 'rating',
        label: 'Rating',
        field: featureFlags.isEnabled('REVIEW_COUNT_BOOST') ? [ATTR.BV_RATING, ATTR.BV_REVIEW_COUNT] : [ATTR.BV_RATING]
    });

    return rows;
}

/**
 * @param {Object[]} docs - raw Bloomreach hits, in the order the caller
 *   wants columns to appear
 * @returns {{rows: Object[], columns: Object[]}}
 */
function build(docs) {
    var rows = getActiveRows();
    var columns = docs.map(function (doc) {
        var ids = identity.fromBloomreachHit(doc);
        var values = {};
        rows.forEach(function (row) {
            if (Array.isArray(row.field)) {
                values[row.key] = row.field.map(function (f) { return doc[f]; });
            } else {
                values[row.key] = doc[row.field];
            }
        });
        return {
            vgId: ids.vgId,
            name: doc.title,
            image: doc.thumb_image,
            price: doc.price,
            values: values
        };
    });

    return { rows: rows, columns: columns };
}

module.exports = {
    getActiveRows: getActiveRows,
    build: build
};
