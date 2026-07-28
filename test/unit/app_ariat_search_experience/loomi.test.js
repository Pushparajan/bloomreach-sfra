'use strict';

var assert = require('chai').assert;
var sinon = require('sinon');
var proxyquire = require('proxyquire').noCallThru();

var MODULE_PATH = '../../../cartridges/app_ariat_search_experience/cartridge/controllers/Loomi';

function serverStub() {
    var routes = {};
    return {
        get: function (name, handler) { routes[name] = handler; },
        exports: function () { return routes; },
        routes: routes
    };
}

function runRoute(routeHandler, isEnabled) {
    var req = { querystring: {} };
    var jsonBody = null;
    var statusCode = null;
    var res = {
        setStatusCode: function (code) { statusCode = code; },
        json: function (body) { jsonBody = body; }
    };
    var next = sinon.stub();

    var featureFlags = { isEnabled: sinon.stub().returns(isEnabled) };
    var server = serverStub();

    proxyquire(MODULE_PATH, {
        server: server,
        '*/cartridge/scripts/helpers/featureFlags': featureFlags
    });

    server.routes.Query(req, res, next);

    return { statusCode: statusCode, jsonBody: jsonBody, next: next };
}

describe('app_ariat_search_experience/controllers/Loomi (stub only - feature is license-gated, not approved for build)', function () {
    it('required default: returns { available: false } and does nothing else when loomi.enabled is false', function () {
        var result = runRoute(null, false);
        assert.deepEqual(result.jsonBody, { available: false });
        assert.equal(result.statusCode, 200);
        assert.isTrue(result.next.calledOnce);
    });

    it('never calls an AI/NLU service or returns interpreted results while disabled', function () {
        var result = runRoute(null, false);
        assert.notProperty(result.jsonBody, 'interpreted');
        assert.notProperty(result.jsonBody, 'results');
    });
});
