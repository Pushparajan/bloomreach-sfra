'use strict';

/**
 * Shared stub factories for dw.* APIs, used with proxyquire across the unit
 * suite. Kept intentionally minimal - only the surface each test actually
 * exercises.
 */

function siteStub(customPreferences) {
    var prefs = customPreferences || {};
    return {
        getCurrent: function () {
            return {
                getCustomPreferenceValue: function (id) {
                    return Object.prototype.hasOwnProperty.call(prefs, id) ? prefs[id] : null;
                },
                getCustomPreferences: function () { return prefs; }
            };
        }
    };
}

function loggerStub() {
    var calls = { error: [], warn: [], info: [] };
    return {
        calls: calls,
        getLogger: function () {
            return {
                error: function (msg) { calls.error.push(msg); },
                warn: function (msg) { calls.warn.push(msg); },
                info: function (msg) { calls.info.push(msg); }
            };
        }
    };
}

module.exports = {
    siteStub: siteStub,
    loggerStub: loggerStub
};
