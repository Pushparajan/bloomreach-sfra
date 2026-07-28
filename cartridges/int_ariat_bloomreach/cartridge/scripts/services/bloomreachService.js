'use strict';

/**
 * ASSUMPTION (greenfield scaffold - no existing integration was found to
 * extend, see chat "Assumptions Made" list): this models the custom,
 * non-connector Bloomreach Discovery HTTP service the prompt says already
 * exists. Service ID and endpoint shape follow Bloomreach's public Discovery
 * Search/Suggest widget API (account_id/auth_key/domain_key query params,
 * JSON response with a top-level "response.docs" array). If a real service
 * already exists in the target org, THIS FILE is what should be deleted in
 * favor of it - every other helper in this cartridge only depends on the
 * `call(requestParams)` contract below, not on this file's internals.
 */

var LocalServiceRegistry = require('dw/svc/LocalServiceRegistry');
var Site = require('dw/system/Site');

var SERVICE_ID = 'bloomreach.http.search';

function buildQueryString(params) {
    return Object.keys(params)
        .filter(function (key) { return params[key] !== undefined && params[key] !== null && params[key] !== ''; })
        .map(function (key) { return encodeURIComponent(key) + '=' + encodeURIComponent(params[key]); })
        .join('&');
}

function getService() {
    return LocalServiceRegistry.createService(SERVICE_ID, {
        createRequest: function (svc, requestParams) {
            var prefs = Site.getCurrent().getCustomPreferences();
            var baseParams = {
                account_id: prefs.bloomreachAccountId,
                auth_key: prefs.bloomreachAuthKey,
                domain_key: prefs.bloomreachDomainKey,
                request_id: (requestParams && requestParams.request_id) || String(Date.now())
            };
            var merged = Object.assign({}, baseParams, requestParams || {});
            var queryString = buildQueryString(merged);
            svc.setRequestMethod('GET');
            svc.addHeader('Accept', 'application/json');
            svc.setURL(svc.getConfiguration().getCredential().getURL() + '?' + queryString);
            return null;
        },
        parseResponse: function (svc, httpClient) {
            return httpClient.text;
        },
        filterLogMessage: function (msg) {
            // Strip auth_key from anything that ends up in service logs.
            return msg.replace(/auth_key=[^&\s]+/gi, 'auth_key=***');
        }
    });
}

/**
 * Low-level call shared by every Bloomreach helper (search, suggest,
 * attribute/category widget, and the fq-based lookup used by Boot Finder,
 * Work Job Landing, and Comparison Tool). Returns the parsed JSON body on
 * success and throws on transport/HTTP failure so callers decide how to
 * degrade.
 *
 * @param {Object} requestParams - query params merged onto the base call
 * @returns {Object} parsed JSON response
 */
function call(requestParams) {
    var service = getService();
    var result = service.call(requestParams);
    if (!result.isOk()) {
        var error = new Error('Bloomreach service call failed: ' + result.getErrorMessage());
        error.status = result.getError();
        throw error;
    }
    return JSON.parse(result.getObject());
}

module.exports = {
    SERVICE_ID: SERVICE_ID,
    call: call
};
