'use strict';

var Site = require('dw/system/Site');
var constants = require('./bloomreachConstants');

/**
 * Single choke point for reading Bloomreach-feature Site Preferences.
 * Every controller/helper in this file tree must go through here instead of
 * calling Site.getCustomPreference() directly, so the logical-name ->
 * preference-ID mapping (see bloomreachConstants.FEATURE_FLAGS) only needs
 * to be correct in one place.
 *
 * @param {string} flagKey - key from constants.FEATURE_FLAGS, e.g. 'JOB_TYPE'
 * @returns {boolean}
 */
function isEnabled(flagKey) {
    var prefId = constants.FEATURE_FLAGS[flagKey];
    if (!prefId) {
        throw new Error('Unknown Bloomreach feature flag key: ' + flagKey);
    }
    var value = Site.getCurrent().getCustomPreferenceValue(prefId);
    return value === true;
}

module.exports = {
    isEnabled: isEnabled
};
