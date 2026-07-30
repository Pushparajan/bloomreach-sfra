'use strict';

var assert = require('chai').assert;
var sinon = require('sinon');
var proxyquire = require('proxyquire').noCallThru();

var MODULE_PATH = '../../../cartridges/int_ariat_bloomreach/cartridge/scripts/helpers/bloomreachLogger';

function load() {
    var error = sinon.stub();
    var warn = sinon.stub();
    var mod = proxyquire(MODULE_PATH, {
        'dw/system/Logger': {
            getLogger: function () { return { error: error, warn: warn }; }
        }
    });
    return { mod: mod, error: error, warn: warn };
}

describe('int_ariat_bloomreach/helpers/bloomreachLogger', function () {
    // R-38's user_id is the logged-in shopper's customer id. Failure paths
    // log the Bloomreach request params verbatim, so without redaction here
    // every service failure writes a shopper identifier into the SFCC log -
    // contradicting this module's own "never PII" guarantee.
    it('redacts user_id from a logged service failure while keeping the rest of the params', function () {
        var loaded = load();

        loaded.mod.logServiceFailure('Compare', new Error('timeout'), {
            fq: 'pid:("VG-1" OR "VG-2")',
            rows: 2,
            user_id: 'customer-abc-123'
        });

        var logged = loaded.error.firstCall.args[0];
        assert.notInclude(logged, 'customer-abc-123');
        assert.include(logged, '"user_id":"***"');
        assert.include(logged, 'pid:(\\"VG-1\\" OR \\"VG-2\\")');
        assert.include(logged, '"rows":2');
    });

    it('redacts user_id nested inside a params object, which is how queryByAttributes passes it', function () {
        var loaded = load();

        loaded.mod.logServiceFailure('BootFinder', new Error('boom'), {
            feature: 'BootFinder',
            params: { fq: 'job_type:"electrical"', user_id: 'customer-abc-123' }
        });

        var logged = loaded.error.firstCall.args[0];
        assert.notInclude(logged, 'customer-abc-123');
        assert.include(logged, '"user_id":"***"');
    });

    it('redacts user_id on the warn path too', function () {
        var loaded = load();

        loaded.mod.logWarn('WorkJobLandingPersonalized', 'call failed', { user_id: 'customer-abc-123' });

        assert.notInclude(loaded.warn.firstCall.args[0], 'customer-abc-123');
    });

    it('keeps the user_id key when the value is absent, so logs still show an anonymous call was anonymous', function () {
        var loaded = load();

        loaded.mod.logServiceFailure('BootFinder', new Error('boom'), { fq: 'job_type:"electrical"', user_id: null });

        assert.include(loaded.error.firstCall.args[0], '"user_id":null');
    });

    it('does not mutate the caller\'s context object', function () {
        var loaded = load();
        var context = { user_id: 'customer-abc-123' };

        loaded.mod.logServiceFailure('Compare', new Error('boom'), context);

        assert.equal(context.user_id, 'customer-abc-123');
    });
});
