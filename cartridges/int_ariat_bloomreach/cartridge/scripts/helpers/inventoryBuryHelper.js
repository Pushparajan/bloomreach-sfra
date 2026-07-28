'use strict';

/**
 * ASSUMPTION (see chat "Assumptions Made"): the prompt says to "reuse
 * whatever rule/config already suppresses low-stock items elsewhere - do not
 * hardcode a new threshold." No such existing rule was found (greenfield
 * repo), so this module stands in for it with a single custom preference
 * (`lowStockBuryThreshold`) that a real integration would already have.
 * Every caller must go through `applyBuryRule` rather than re-implementing
 * a threshold check, so swapping this stub for the real rule later is a
 * one-file change.
 */

var Site = require('dw/system/Site');

/**
 * Returns a Bloomreach fq fragment that deprioritizes (does not hard-filter)
 * items at or below the site's low-stock threshold, using a "boost down"
 * range filter shape consistent with the attribute-boost approach used
 * elsewhere in this cartridge.
 *
 * @returns {string|null} fq fragment, or null if no threshold is configured
 */
function getBuryFilterQuery() {
    var threshold = Site.getCurrent().getCustomPreferenceValue('lowStockBuryThreshold');
    if (threshold === null || threshold === undefined) {
        return null;
    }
    return 'inventory_level:[' + threshold + ' TO *]^0.1 OR inventory_level:[* TO ' + threshold + ']^-0.5';
}

module.exports = {
    getBuryFilterQuery: getBuryFilterQuery
};
