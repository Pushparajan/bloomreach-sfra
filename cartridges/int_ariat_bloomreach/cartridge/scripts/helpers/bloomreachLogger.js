'use strict';

var Logger = require('dw/system/Logger');

var LOG_CATEGORY = 'bloomreach';

/**
 * Query params carrying a shopper-identifying value. These are stripped
 * before anything reaches the log, so the "never PII" guarantee below is
 * enforced here rather than trusted to each call site - the same reasoning
 * that puts the personalization flag check inside
 * helpers/bloomreachPersonalizationIdentity rather than at its callers.
 *
 * `user_id` (R-38) is the one that matters today: failure paths log the
 * request params verbatim, and those params carry the logged-in shopper's
 * id whenever personalization.oneToOne.enabled is on. Add any future
 * identifier param to this list.
 */
var REDACTED_PARAM_KEYS = ['user_id'];
var REDACTED_PLACEHOLDER = '***';

/**
 * Returns a copy of `context` with any shopper-identifying request param
 * replaced by a placeholder. The key is kept (so logs still show WHETHER a
 * personalized call was in flight, which matters when diagnosing a
 * personalization failure) while the value never lands in the log.
 *
 * @param {Object} context
 * @returns {Object} redacted copy - the caller's object is never mutated
 */
function redact(context) {
    if (!context || typeof context !== 'object') {
        return context;
    }

    var copy = Object.keys(context).reduce(function (acc, key) {
        var value = context[key];
        acc[key] = (value && typeof value === 'object') ? redact(value) : value;
        return acc;
    }, {});

    REDACTED_PARAM_KEYS.forEach(function (key) {
        if (copy[key] !== undefined && copy[key] !== null) {
            copy[key] = REDACTED_PLACEHOLDER;
        }
    });

    return copy;
}

/**
 * Thin wrapper over the standard dw.system.Logger so every Bloomreach
 * consumer logs failures the same way: which feature, which query params,
 * never PII (no customer name/email/address - VG/SKU ids and facet values
 * only), and never a shopper identifier (see redact above).
 */
function log(feature, message, context) {
    var logger = Logger.getLogger(LOG_CATEGORY, feature);
    var suffix = context ? ' | context=' + JSON.stringify(redact(context)) : '';
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
        var suffix = context ? ' | context=' + JSON.stringify(redact(context)) : '';
        return logger.warn(message + suffix);
    }
};
