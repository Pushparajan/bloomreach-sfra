'use strict';

var assert = require('chai').assert;
var sinon = require('sinon');
var proxyquire = require('proxyquire').noCallThru();

var MODULE_PATH = '../../../cartridges/int_ariat_bloomreach/cartridge/scripts/jobs/GenerateThematicPages';

function makeCombo(overrides) {
    return Object.assign({
        combinationKey: 'electrical-composite',
        jobType: 'electrical',
        safetySpec: null,
        toeShape: 'Composite',
        enabled: true
    }, overrides);
}

function iteratorFor(combos) {
    var index = 0;
    return {
        hasNext: function () { return index < combos.length; },
        next: function () { return { custom: combos[index++] }; },
        close: function () {}
    };
}

function loggerStub() {
    return { getLogger: sinon.stub().returns({ error: sinon.stub(), warn: sinon.stub(), info: sinon.stub() }) };
}

function statusStub() {
    function Status(status, code, msg) { this.status = status; this.code = code; this.msg = msg; }
    Status.OK = 'OK';
    Status.ERROR = 'ERROR';
    return Status;
}

function load(options) {
    var opts = options || {};
    var queryByAttributes = opts.queryByAttributes || sinon.stub().returns({ response: { docs: [{ pid: 'VG-1', title: 'Boot A' }] } });
    var contentMgr = opts.contentMgr || {
        getContent: sinon.stub().returns({ setOnline: sinon.stub(), custom: {} }),
        getFolder: sinon.stub().returns({ assignContent: sinon.stub() }),
        createContent: sinon.stub().returns({ setOnline: sinon.stub(), custom: {} })
    };
    var isEnabled = opts.isEnabled || sinon.stub().returns(true);

    var mod = proxyquire(MODULE_PATH, {
        'dw/object/CustomObjectMgr': { getAllCustomObjects: sinon.stub().returns(iteratorFor(opts.combos || [makeCombo()])) },
        'dw/content/ContentMgr': contentMgr,
        'dw/system/Transaction': { wrap: function (fn) { return fn(); } },
        'dw/system/Status': statusStub(),
        'dw/system/Logger': loggerStub(),
        '../helpers/bloomreachAttributeQueryHelper': { queryByAttributes: queryByAttributes },
        '../helpers/bloomreachIdentity': { fromBloomreachHit: function (hit) { return { vgId: hit.pid, skuId: hit.sku }; } },
        '../helpers/bloomreachConstants': require('../../../cartridges/int_ariat_bloomreach/cartridge/scripts/helpers/bloomreachConstants'),
        '../helpers/featureFlags': { isEnabled: isEnabled }
    });

    return { mod: mod, queryByAttributes: queryByAttributes, contentMgr: contentMgr, isEnabled: isEnabled };
}

describe('int_ariat_bloomreach/jobs/GenerateThematicPages', function () {
    it('happy path: processes an eligible combination and sets content online with product data', function () {
        var content = { setOnline: sinon.stub(), custom: {} };
        var contentMgr = {
            getContent: sinon.stub().returns(content),
            getFolder: sinon.stub().returns({ assignContent: sinon.stub() }),
            createContent: sinon.stub()
        };
        var loaded = load({ contentMgr: contentMgr });

        var status = loaded.mod.execute({ DryRun: false });

        assert.equal(status.status, 'OK');
        assert.isTrue(content.setOnline.calledWith(true));
        assert.isDefined(content.custom.body);
    });

    it('R-21 gate: skips a combination with a safetySpec when finder.safetySpecRefinement.enabled is off', function () {
        var isEnabled = sinon.stub().callsFake(function (flag) { return flag !== 'SAFETY_SPEC_REFINEMENT'; });
        var queryByAttributes = sinon.stub().returns({ response: { docs: [{ pid: 'VG-1' }] } });
        var loaded = load({
            combos: [makeCombo({ combinationKey: 'welding-eh', safetySpec: 'EH' })],
            isEnabled: isEnabled,
            queryByAttributes: queryByAttributes
        });

        loaded.mod.execute({ DryRun: false });

        assert.isFalse(queryByAttributes.called);
    });

    it('processes a safetySpec combination once the flag is on', function () {
        var queryByAttributes = sinon.stub().returns({ response: { docs: [{ pid: 'VG-1' }] } });
        var loaded = load({
            combos: [makeCombo({ combinationKey: 'welding-eh', safetySpec: 'EH' })],
            isEnabled: sinon.stub().returns(true),
            queryByAttributes: queryByAttributes
        });

        loaded.mod.execute({ DryRun: false });

        assert.isTrue(queryByAttributes.called);
    });

    it('hides (sets offline) a combination that now returns zero in-stock products, to protect SEO authority', function () {
        var content = { setOnline: sinon.stub(), custom: {} };
        var contentMgr = {
            getContent: sinon.stub().returns(content),
            getFolder: sinon.stub().returns({ assignContent: sinon.stub() }),
            createContent: sinon.stub()
        };
        var loaded = load({
            contentMgr: contentMgr,
            queryByAttributes: sinon.stub().returns({ response: { docs: [] } })
        });

        loaded.mod.execute({ DryRun: false });

        assert.isTrue(content.setOnline.calledWith(false));
    });

    it('Bloomreach service failure: does not write content and is counted as an error, not a silent success', function () {
        var contentMgr = {
            getContent: sinon.stub(),
            getFolder: sinon.stub(),
            createContent: sinon.stub()
        };
        var loaded = load({
            contentMgr: contentMgr,
            queryByAttributes: sinon.stub().returns(null)
        });

        var status = loaded.mod.execute({ DryRun: false });

        assert.isFalse(contentMgr.getContent.called);
        assert.equal(status.status, 'ERROR');
    });

    it('dry run: never calls ContentMgr at all', function () {
        var contentMgr = {
            getContent: sinon.stub(),
            getFolder: sinon.stub(),
            createContent: sinon.stub()
        };
        var loaded = load({ contentMgr: contentMgr });

        loaded.mod.execute({ DryRun: true });

        assert.isFalse(contentMgr.getContent.called);
        assert.isFalse(contentMgr.createContent.called);
    });

    it('identity mapping: schema.org markup links use the VG id (pid), never a bare sku', function () {
        var content = { setOnline: sinon.stub(), custom: {} };
        var contentMgr = {
            getContent: sinon.stub().returns(content),
            getFolder: sinon.stub().returns({ assignContent: sinon.stub() }),
            createContent: sinon.stub()
        };
        var loaded = load({
            contentMgr: contentMgr,
            queryByAttributes: sinon.stub().returns({ response: { docs: [{ pid: 'VG-1', sku: 'SKU-1', title: 'Boot A' }] } })
        });

        loaded.mod.execute({ DryRun: false });

        var markup = JSON.parse(content.custom.body);
        assert.include(markup.itemListElement[0].url, 'pid=VG-1');
        assert.notInclude(markup.itemListElement[0].url, 'SKU-1');
    });
});
