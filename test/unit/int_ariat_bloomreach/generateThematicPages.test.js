'use strict';

var assert = require('chai').assert;
var sinon = require('sinon');
var proxyquire = require('proxyquire').noCallThru();

var MODULE_PATH = '../../../cartridges/int_ariat_bloomreach/cartridge/scripts/jobs/GenerateThematicPages';

function extractSchemaOrgMarkup(body) {
    var match = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(body);
    return match && JSON.parse(match[1]);
}

function makeCombo(overrides) {
    return Object.assign({
        key: 'electrical-composite',
        jobType: 'electrical',
        safetySpec: null,
        toeShape: 'Composite'
    }, overrides);
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
        '../helpers/thematicPageCombinations': { getEnabledCombinations: sinon.stub().returns(opts.combos || [makeCombo()]) },
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
        assert.deepEqual(JSON.parse(content.custom.productData), [{ pid: 'VG-1', title: 'Boot A' }]);
    });

    it('R-21 gate: skips a combination with a safetySpec when finder.safetySpecRefinement.enabled is off', function () {
        var isEnabled = sinon.stub().callsFake(function (flag) { return flag !== 'SAFETY_SPEC_REFINEMENT'; });
        var queryByAttributes = sinon.stub().returns({ response: { docs: [{ pid: 'VG-1' }] } });
        var loaded = load({
            combos: [makeCombo({ key: 'welding-eh', safetySpec: 'EH' })],
            isEnabled: isEnabled,
            queryByAttributes: queryByAttributes
        });

        loaded.mod.execute({ DryRun: false });

        assert.isFalse(queryByAttributes.called);
    });

    it('processes a safetySpec combination once the flag is on', function () {
        var queryByAttributes = sinon.stub().returns({ response: { docs: [{ pid: 'VG-1' }] } });
        var loaded = load({
            combos: [makeCombo({ key: 'welding-eh', safetySpec: 'EH' })],
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

        var markup = extractSchemaOrgMarkup(content.custom.body);
        assert.include(markup.itemListElement[0].url, 'pid=VG-1');
        assert.notInclude(markup.itemListElement[0].url, 'SKU-1');
    });

    it('product grid: renders a compare checkbox per product using the VG id, matching compareControl.isml\'s contract', function () {
        var content = { setOnline: sinon.stub(), custom: {} };
        var contentMgr = {
            getContent: sinon.stub().returns(content),
            getFolder: sinon.stub().returns({ assignContent: sinon.stub() }),
            createContent: sinon.stub()
        };
        var loaded = load({
            contentMgr: contentMgr,
            queryByAttributes: sinon.stub().returns({
                response: {
                    docs: [
                        { pid: 'VG-1', sku: 'SKU-1', title: 'Boot A', thumb_image: '/a.jpg', price: 99.99 },
                        { pid: 'VG-2', sku: 'SKU-2', title: 'Boot B', thumb_image: '/b.jpg', price: 129.99 }
                    ]
                }
            })
        });

        loaded.mod.execute({ DryRun: false });

        var body = content.custom.body;
        assert.match(body, /data-compare-select/);
        assert.include(body, 'data-vg-id="VG-1"');
        assert.include(body, 'data-vg-id="VG-2"');
        assert.notInclude(body, 'SKU-1', 'compare checkbox must key off the VG id, never a bare sku');
        assert.include(body, 'data-name="Boot A"');
        assert.include(body, 'data-image="/a.jpg"');
    });

    it('product grid: includes a View Comparison trigger using compare.js\'s existing data-compare-view contract', function () {
        var content = { setOnline: sinon.stub(), custom: {} };
        var contentMgr = {
            getContent: sinon.stub().returns(content),
            getFolder: sinon.stub().returns({ assignContent: sinon.stub() }),
            createContent: sinon.stub()
        };
        var loaded = load({
            contentMgr: contentMgr,
            queryByAttributes: sinon.stub().returns({ response: { docs: [{ pid: 'VG-1', title: 'Boot A' }] } })
        });

        loaded.mod.execute({ DryRun: false });

        assert.match(content.custom.body, /data-compare-view/);
        assert.match(content.custom.body, /data-url="[^"]*Compare-Show"/);
        assert.include(content.custom.body, 'data-theme-key="electrical-composite"');
    });

    it('product grid: HTML-escapes product data so a feed value cannot break out of markup', function () {
        var content = { setOnline: sinon.stub(), custom: {} };
        var contentMgr = {
            getContent: sinon.stub().returns(content),
            getFolder: sinon.stub().returns({ assignContent: sinon.stub() }),
            createContent: sinon.stub()
        };
        var loaded = load({
            contentMgr: contentMgr,
            queryByAttributes: sinon.stub().returns({
                response: { docs: [{ pid: 'VG-1', title: '<script>alert(1)</script>', thumb_image: '"><img>' }] }
            })
        });

        loaded.mod.execute({ DryRun: false });

        assert.notInclude(content.custom.body, '<script>alert(1)</script>');
        assert.notInclude(content.custom.body, '"><img>');
    });

    it('schema.org JSON-LD: escapes "</script>" in a feed value so it cannot close the surrounding script tag early', function () {
        var content = { setOnline: sinon.stub(), custom: {} };
        var contentMgr = {
            getContent: sinon.stub().returns(content),
            getFolder: sinon.stub().returns({ assignContent: sinon.stub() }),
            createContent: sinon.stub()
        };
        var loaded = load({
            contentMgr: contentMgr,
            queryByAttributes: sinon.stub().returns({
                response: { docs: [{ pid: 'VG-1', title: '</script><script>alert(1)</script>' }] }
            })
        });

        loaded.mod.execute({ DryRun: false });

        assert.notInclude(content.custom.body, '</script><script>alert(1)</script>');
        var markup = extractSchemaOrgMarkup(content.custom.body);
        assert.equal(markup.itemListElement[0].name, '</script><script>alert(1)</script>');
    });

    it('new content asset: creates and assigns to folder when content does not yet exist', function () {
        var newContent = { setOnline: sinon.stub(), custom: {} };
        var folder = { assignContent: sinon.stub() };
        var contentMgr = {
            getContent: sinon.stub().returns(null),
            getFolder: sinon.stub().returns(folder),
            createContent: sinon.stub().returns(newContent)
        };
        var loaded = load({ contentMgr: contentMgr });

        var status = loaded.mod.execute({ DryRun: false });

        assert.isTrue(contentMgr.createContent.called, 'createContent must be called for new asset');
        assert.isTrue(folder.assignContent.calledWith(newContent), 'new content must be assigned to folder');
        assert.isTrue(newContent.setOnline.calledWith(true), 'new content must be set online when products exist');
        assert.equal(status.status, 'OK');
    });

    it('folder not found: logs error and skips write but still counts combination as processed', function () {
        var contentMgr = {
            getContent: sinon.stub().returns(null),
            getFolder: sinon.stub().returns(null),
            createContent: sinon.stub()
        };
        var loaded = load({ contentMgr: contentMgr });

        var status = loaded.mod.execute({ DryRun: false });

        assert.isFalse(contentMgr.createContent.called, 'createContent must not be called when folder is missing');
        assert.equal(status.status, 'OK', 'a skipped combination still counts as processed, not an error');
    });
});
