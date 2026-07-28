'use strict';

var assert = require('chai').assert;
var sinon = require('sinon');
var proxyquire = require('proxyquire').noCallThru();

var MODULE_PATH = '../../../cartridges/int_ariat_bloomreach/cartridge/scripts/helpers/bloomreachProductLookupHelper';

function load(serviceCall) {
    return proxyquire(MODULE_PATH, {
        '../services/bloomreachService': { call: serviceCall || sinon.stub().returns({ response: { docs: [] } }) },
        './bloomreachLogger': { logServiceFailure: sinon.stub() }
    });
}

describe('int_ariat_bloomreach/helpers/bloomreachProductLookupHelper', function () {
    it('happy path: builds an OR fq over pid (Variation Group ids), never sku/base-product ids', function () {
        var serviceCall = sinon.stub().returns({ response: { docs: [{ pid: 'VG-1' }, { pid: 'VG-2' }] } });
        var mod = load(serviceCall);

        var result = mod.lookupByIds(['VG-1', 'VG-2'], 'Compare');

        assert.isNotNull(result);
        var requestParams = serviceCall.firstCall.args[0];
        assert.equal(requestParams.fq, 'pid:("VG-1" OR "VG-2")');
        assert.equal(requestParams.rows, 2);
    });

    it('rejects fewer than 2 ids', function () {
        var mod = load();
        assert.throws(function () { mod.lookupByIds(['VG-1'], 'Compare'); }, /between 2 and 4/);
    });

    it('rejects more than 4 ids', function () {
        var mod = load();
        assert.throws(function () {
            mod.lookupByIds(['VG-1', 'VG-2', 'VG-3', 'VG-4', 'VG-5'], 'Compare');
        }, /between 2 and 4/);
    });

    it('filters out malformed ids before counting toward the 2-4 bound', function () {
        var mod = load();
        assert.throws(function () {
            mod.lookupByIds(['VG-1', '") OR (1=1'], 'Compare');
        }, /between 2 and 4/);
    });

    it('service failure: logs and returns null rather than throwing out of the controller', function () {
        var error = new Error('503');
        var serviceCall = sinon.stub().throws(error);
        var logServiceFailure = sinon.stub();
        var mod = proxyquire(MODULE_PATH, {
            '../services/bloomreachService': { call: serviceCall },
            './bloomreachLogger': { logServiceFailure: logServiceFailure }
        });

        var result = mod.lookupByIds(['VG-1', 'VG-2'], 'Compare');

        assert.isNull(result);
        assert.isTrue(logServiceFailure.calledOnce);
    });
});
