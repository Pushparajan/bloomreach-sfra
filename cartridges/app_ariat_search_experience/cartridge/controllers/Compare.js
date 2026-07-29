'use strict';

var server = require('server');
var interactiveCache = require('*/cartridge/scripts/middleware/interactiveCache');
var productLookupHelper = require('*/cartridge/scripts/helpers/bloomreachProductLookupHelper');
var compareModel = require('*/cartridge/scripts/compare/compareModel');
var bloomreachLogger = require('*/cartridge/scripts/helpers/bloomreachLogger');
var thematicPageLookup = require('*/cartridge/scripts/helpers/thematicPageLookup');
var dwSearchFallbackHelper = require('*/cartridge/scripts/helpers/dwSearchFallbackHelper');
var bloomreachPersonalizationIdentity = require('*/cartridge/scripts/helpers/bloomreachPersonalizationIdentity');

var FEATURE = 'Compare';

/**
 * Renders the comparison table for 2-4 selected VG ids. Accepts the id list
 * as a comma-separated `pids` query param so add/remove/swap on the client
 * can re-request this same route without a full page reload.
 */
server.get('Show', interactiveCache.applyNoCache, function (req, res, next) {
    var vgIds = (req.querystring.pids || '').split(',').map(function (id) { return id.trim(); }).filter(Boolean);

    if (vgIds.length < productLookupHelper.MIN_COMPARE_ITEMS) {
        res.render('compare/tableError', {
            message: 'Select at least ' + productLookupHelper.MIN_COMPARE_ITEMS + ' products to compare.'
        });
        next();
        return;
    }
    if (vgIds.length > productLookupHelper.MAX_COMPARE_ITEMS) {
        vgIds = vgIds.slice(0, productLookupHelper.MAX_COMPARE_ITEMS);
    }

    // When the shopper arrived from a Thematic Page (see data-theme-key in
    // GenerateThematicPages), reuse that page's own stored product set
    // instead of a live Bloomreach call. Any failure, missing page, or
    // partial match (e.g. an id added from elsewhere on the site) falls
    // back to the normal live lookup below - this is purely a performance
    // optimization, never a behavior change.
    var themeKey = req.querystring.theme;
    var docs = null;
    if (themeKey) {
        try {
            docs = thematicPageLookup.findDocsByCombinationKey(themeKey, vgIds);
        } catch (e) {
            bloomreachLogger.logWarn(FEATURE, 'Thematic page lookup failed, falling back to live query', {
                error: e.message
            });
        }
    }

    if (!docs) {
        // 1:1 personalization — gated on personalization.oneToOne.enabled,
        // see R-38. resolveShopperIdentity returns a null userId whenever
        // the flag is off, the shopper is a guest, or identity is ambiguous
        // - Work-JobLanding's shell and Search are excluded by never calling
        // this helper at all (see helpers/bloomreachPersonalizationIdentity).
        var userId = bloomreachPersonalizationIdentity
            .resolveShopperIdentity(req.currentCustomer && req.currentCustomer.raw).userId;
        var bloomreachResponse;
        try {
            bloomreachResponse = productLookupHelper.lookupByIds(vgIds, FEATURE, userId);
        } catch (e) {
            bloomreachLogger.logServiceFailure(FEATURE, e, { vgIds: vgIds });
            bloomreachResponse = null;
        }

        // Bloomreach unreachable - fall back to SFCC's native product
        // lookup rather than a 502, since a live shopper is waiting. See
        // helpers/dwSearchFallbackHelper.
        if (!bloomreachResponse) {
            try {
                bloomreachResponse = dwSearchFallbackHelper.lookupByIds(vgIds);
            } catch (e) {
                bloomreachLogger.logWarn(FEATURE, 'dw search fallback failed', { error: e.message });
            }
        }

        if (!bloomreachResponse) {
            res.setStatusCode(502);
            res.render('compare/tableError', { message: 'We could not load comparison data right now.' });
            next();
            return;
        }

        docs = (bloomreachResponse.response && bloomreachResponse.response.docs) || [];
    }

    var table = compareModel.build(docs);

    res.render('compare/table', table);
    next();
});

module.exports = server.exports();
