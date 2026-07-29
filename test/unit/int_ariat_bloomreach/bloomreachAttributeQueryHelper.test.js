'use strict';

var assert = require('chai').assert;
var sinon = require('sinon');
var proxyquire = require('proxyquire').noCallThru();

var MODULE_PATH = '../../../cartridges/int_ariat_bloomreach/cartridge/scripts/helpers/bloomreachAttributeQueryHelper';

function load(overrides) {
    var serviceCall = (overrides && overrides.serviceCall) || sinon.stub().returns({ response: { docs: [] } });
    var deps = {
        '../services/bloomreachService': { call: serviceCall },
        './inventoryBuryHelper': { getBuryFilterQuery: sinon.stub().returns(null) },
        './bloomreachLogger': { logServiceFailure: sinon.stub(), logWarn: sinon.stub() }
    };
    Object.assign(deps, overrides && overrides.deps);
    var mod = proxyquire(MODULE_PATH, deps);
    return { mod: mod, serviceCall: serviceCall, deps: deps };
}

describe('int_ariat_bloomreach/helpers/bloomreachAttributeQueryHelper', function () {
    describe('buildFilterQueries', function () {
        it('builds soft-boost fragments for non-hard fields', function () {
            var loaded = load();
            var fragments = loaded.mod.buildFilterQueries({ Safety_Toe: 'Composite' }, { applyBuryRule: false });
            assert.deepEqual(fragments, ['Safety_Toe:"Composite"^1.5']);
        });

        it('builds hard (unweighted) fragments for fields listed in hardFields', function () {
            var loaded = load();
            var fragments = loaded.mod.buildFilterQueries(
                { job_type: 'electrical' },
                { hardFields: ['job_type'], applyBuryRule: false }
            );
            assert.deepEqual(fragments, ['job_type:"electrical"']);
        });

        it('builds a range fragment for {min,max} answers (e.g. shaft_height_in)', function () {
            var loaded = load();
            var fragments = loaded.mod.buildFilterQueries(
                { shaft_height_in: { min: 6, max: 10 } },
                { hardFields: ['shaft_height_in'], applyBuryRule: false }
            );
            assert.deepEqual(fragments, ['shaft_height_in:[6 TO 10]']);
        });

        it('skips undefined/null/empty answers rather than emitting a broken clause', function () {
            var loaded = load();
            var fragments = loaded.mod.buildFilterQueries({ Toe_Shape: undefined, Safety_Toe: '' }, { applyBuryRule: false });
            assert.deepEqual(fragments, []);
        });

        it('appends the bury-rule fragment when applyBuryRule is not disabled', function () {
            var loaded = load({
                deps: { './inventoryBuryHelper': { getBuryFilterQuery: sinon.stub().returns('inventory_level:[1 TO *]^0.1') } }
            });
            var fragments = loaded.mod.buildFilterQueries({}, {});
            assert.deepEqual(fragments, ['inventory_level:[1 TO *]^0.1']);
        });
    });

    describe('queryByAttributes', function () {
        it('happy path: calls the service with fq built from answers and sorts by bvRating when review-count boost is off', function () {
            var serviceCall = sinon.stub().returns({ response: { docs: [{ pid: 'VG-1' }] } });
            var loaded = load({ serviceCall: serviceCall });

            var result = loaded.mod.queryByAttributes({
                answers: { Safety_Toe: 'Composite' },
                reviewCountBoostEnabled: false
            }, 'BootFinder');

            assert.deepEqual(result, { response: { docs: [{ pid: 'VG-1' }] } });
            var requestParams = serviceCall.firstCall.args[0];
            assert.include(requestParams.fq, 'Safety_Toe');
            assert.equal(requestParams.sort, 'bvRating desc');
        });

        it('sorts by bvRating,bvReviewCount when the review-count-boost flag is on', function () {
            var serviceCall = sinon.stub().returns({ response: { docs: [] } });
            var loaded = load({ serviceCall: serviceCall });

            loaded.mod.queryByAttributes({ answers: {}, reviewCountBoostEnabled: true }, 'BootFinder');

            assert.equal(serviceCall.firstCall.args[0].sort, 'bvRating,bvReviewCount desc');
        });

        it('appends sales_rank_bucket only when the sales-rank-tiebreak flag is on', function () {
            var serviceCall = sinon.stub().returns({ response: { docs: [] } });
            var loaded = load({ serviceCall: serviceCall });

            loaded.mod.queryByAttributes({
                answers: {},
                reviewCountBoostEnabled: true,
                salesRankTiebreakEnabled: true
            }, 'BootFinder');

            assert.equal(serviceCall.firstCall.args[0].sort, 'bvRating,bvReviewCount,sales_rank_bucket desc');
        });

        it('includes user_id in the request when the caller passes one (e.g. Boot Finder for a logged-in shopper)', function () {
            var serviceCall = sinon.stub().returns({ response: { docs: [] } });
            var loaded = load({ serviceCall: serviceCall });

            loaded.mod.queryByAttributes({ answers: {}, userId: 'cust-123' }, 'BootFinder');

            assert.equal(serviceCall.firstCall.args[0].user_id, 'cust-123');
        });

        it('omits user_id entirely when the caller does not pass one (e.g. Work-JobLanding, or an anonymous shopper)', function () {
            var serviceCall = sinon.stub().returns({ response: { docs: [] } });
            var loaded = load({ serviceCall: serviceCall });

            loaded.mod.queryByAttributes({ answers: {} }, 'WorkJobLanding');

            assert.isUndefined(serviceCall.firstCall.args[0].user_id);
        });

        it('service failure: logs and returns null instead of throwing or returning unrelated data', function () {
            var error = new Error('timeout');
            var serviceCall = sinon.stub().throws(error);
            var logServiceFailure = sinon.stub();
            var loaded = load({
                serviceCall: serviceCall,
                deps: { './bloomreachLogger': { logServiceFailure: logServiceFailure, logWarn: sinon.stub() } }
            });

            var result = loaded.mod.queryByAttributes({ answers: { Safety_Toe: 'Steel' } }, 'BootFinder');

            assert.isNull(result);
            assert.isTrue(logServiceFailure.calledOnce);
            assert.equal(logServiceFailure.firstCall.args[0], 'BootFinder');
            assert.equal(logServiceFailure.firstCall.args[1], error);
        });
    });
});
