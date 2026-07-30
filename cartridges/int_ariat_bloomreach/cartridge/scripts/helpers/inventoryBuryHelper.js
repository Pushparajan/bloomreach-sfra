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

var FIELD = 'inventory_level';

// Boosts applied to the two stock branches. Both MUST be positive - Lucene
// has no negative boost (`^-0.5` is a parse error, not a demotion), so
// "bury" is expressed as a lower positive boost on the low-stock branch
// relative to the in-stock one, never as a negative weight.
var IN_STOCK_BOOST = 2;
var LOW_STOCK_BOOST = 0.1;

/**
 * Returns a Bloomreach fq fragment that deprioritizes (does not hard-filter)
 * items at or below the site's low-stock threshold, using a "boost down"
 * range filter shape consistent with the attribute-boost approach used
 * elsewhere in this cartridge.
 *
 * Three properties this fragment must hold, each of which was violated by
 * an earlier version of it:
 *
 * 1. SELF-CONTAINED. Callers join fragments with ' AND '
 *    (bloomreachAttributeQueryHelper.queryByAttributes), and AND binds
 *    tighter than OR, so a bare `A OR B` fragment leaks its trailing clause
 *    to the top level of the whole query - every low-stock product would
 *    then match regardless of the shopper's actual filters, the exact
 *    inverse of burying them. The outer parentheses are load-bearing: do
 *    not remove them, and do not return a fragment from here that isn't a
 *    single parenthesized group.
 * 2. POSITIVE BOOSTS ONLY - see IN_STOCK_BOOST/LOW_STOCK_BOOST above.
 * 3. NEVER EXCLUDES. The docstring's "does not hard-filter" promise only
 *    holds if products with no `inventory_level` value at all still match,
 *    so the group carries an explicit field-missing branch
 *    (`(*:* -inventory_level:[* TO *])`). Without it, an unpopulated feed
 *    field would silently empty every result set on the site.
 *
 * ASSUMPTION (unchanged from this module's header, restated because it
 * bounds what this fragment can achieve): boosts are expressed the same
 * Solr-style way the rest of this cartridge expresses them, inside `fq`. If
 * the real account treats `fq` as a pure filter - the common Solr
 * semantic - boosts here contribute nothing to scoring and this fragment
 * degrades to a harmless no-op that matches everything, rather than to a
 * wrong ranking. Burying would then have to move to whatever boost/rule
 * mechanism the account actually exposes (or stay in the Bloomreach console
 * rule that already does it globally). Confirm with the Bloomreach account
 * team; only this module changes either way.
 *
 * @returns {string|null} a single parenthesized fq fragment, or null if no
 *   threshold is configured
 */
function getBuryFilterQuery() {
    var threshold = Site.getCurrent().getCustomPreferenceValue('lowStockBuryThreshold');
    if (threshold === null || threshold === undefined) {
        return null;
    }
    return '('
        + FIELD + ':[' + threshold + ' TO *]^' + IN_STOCK_BOOST
        + ' OR ' + FIELD + ':[* TO ' + threshold + ']^' + LOW_STOCK_BOOST
        + ' OR (*:* -' + FIELD + ':[* TO *])'
        + ')';
}

module.exports = {
    getBuryFilterQuery: getBuryFilterQuery
};
