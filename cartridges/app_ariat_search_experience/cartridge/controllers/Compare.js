'use strict';

var server = require('server');
var interactiveCache = require('*/cartridge/scripts/middleware/interactiveCache');
var productLookupHelper = require('*/cartridge/scripts/helpers/bloomreachProductLookupHelper');
var compareModel = require('*/cartridge/scripts/compare/compareModel');
var bloomreachLogger = require('*/cartridge/scripts/helpers/bloomreachLogger');

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

    var bloomreachResponse;
    try {
        bloomreachResponse = productLookupHelper.lookupByIds(vgIds, FEATURE);
    } catch (e) {
        bloomreachLogger.logServiceFailure(FEATURE, e, { vgIds: vgIds });
        res.setStatusCode(502);
        res.render('compare/tableError', { message: 'We could not load comparison data right now.' });
        next();
        return;
    }

    if (!bloomreachResponse) {
        res.setStatusCode(502);
        res.render('compare/tableError', { message: 'We could not load comparison data right now.' });
        next();
        return;
    }

    var docs = (bloomreachResponse.response && bloomreachResponse.response.docs) || [];
    var table = compareModel.build(docs);

    res.render('compare/table', table);
    next();
});

module.exports = server.exports();
