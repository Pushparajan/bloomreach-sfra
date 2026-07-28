'use strict';

var Logger = require('dw/system/Logger');

var LOG_CATEGORY = 'bloomreach';

/**
 * Thin wrapper over the standard dw.system.Logger so every Bloomreach
 * consumer logs failures the same way: which feature, which query params,
 * never PII (no customer name/email/address - VG/SKU ids and facet values
 * only).
 */
function log(feature, message, context) {
    var logger = Logger.getLogger(LOG_CATEGORY, feature);
    var suffix = context ? ' | context=' + JSON.stringify(context) : '';
    return logger.error(message + suffix);
}

module.exports = {
    logServiceFailure: function (feature, error, queryParams) {
        return log(feature, 'Bloomreach service call failed: ' + (error && error.message ? error.message : error), {
            feature: feature,
            params: queryParams
        });
    },
    logWarn: function (feature, message, context) {
        var logger = Logger.getLogger(LOG_CATEGORY, feature);
        var suffix = context ? ' | context=' + JSON.stringify(context) : '';
        return logger.warn(message + suffix);
    }
};
