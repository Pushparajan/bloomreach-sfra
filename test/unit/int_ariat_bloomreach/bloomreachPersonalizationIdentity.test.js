'use strict';

var assert = require('chai').assert;
var sinon = require('sinon');
var proxyquire = require('proxyquire').noCallThru();

var MODULE_PATH = '../../../cartridges/int_ariat_bloomreach/cartridge/scripts/helpers/bloomreachPersonalizationIdentity';

function load(isEnabled) {
    return proxyquire(MODULE_PATH, {
        './featureFlags': { isEnabled: isEnabled || sinon.stub().returns(true) }
    });
}

describe('int_ariat_bloomreach/helpers/bloomreachPersonalizationIdentity', function () {
    describe('flag off (the required default)', function () {
        it('returns a null userId for a logged-in customer when the flag is off - no code path may bypass this', function () {
            var mod = load(sinon.stub().returns(false));

            var result = mod.resolveShopperIdentity({ authenticated: true, ID: 'cust-123' });

            assert.isNull(result.userId);
            assert.isTrue(result.isLoggedIn, 'isLoggedIn still reflects real auth state, independent of the flag');
        });

        it('returns a null userId for a guest when the flag is off', function () {
            var mod = load(sinon.stub().returns(false));

            var result = mod.resolveShopperIdentity({ authenticated: false, ID: 'guest-session-id' });

            assert.isNull(result.userId);
            assert.isFalse(result.isLoggedIn);
        });

        it('checks the PERSONALIZATION_ONE_TO_ONE flag key', function () {
            var isEnabled = sinon.stub().returns(true);
            var mod = load(isEnabled);

            mod.resolveShopperIdentity({ authenticated: true, ID: 'cust-123' });

            assert.isTrue(isEnabled.calledWith('PERSONALIZATION_ONE_TO_ONE'));
        });
    });

    describe('flag on', function () {
        it('returns the customer id for an authenticated shopper', function () {
            var mod = load(sinon.stub().returns(true));

            var result = mod.resolveShopperIdentity({ authenticated: true, ID: 'cust-123' });

            assert.equal(result.userId, 'cust-123');
            assert.isTrue(result.isLoggedIn);
        });

        it('still returns a null userId for a guest, regardless of the flag', function () {
            var mod = load(sinon.stub().returns(true));

            var result = mod.resolveShopperIdentity({ authenticated: false, ID: 'guest-session-id' });

            assert.isNull(result.userId);
            assert.isFalse(result.isLoggedIn);
        });

        it('returns a null userId when no customer is provided', function () {
            var mod = load(sinon.stub().returns(true));

            assert.isNull(mod.resolveShopperIdentity(null).userId);
            assert.isNull(mod.resolveShopperIdentity(undefined).userId);
        });

        it('returns a null userId when authenticated but somehow has no id, rather than guessing', function () {
            var mod = load(sinon.stub().returns(true));

            var result = mod.resolveShopperIdentity({ authenticated: true, ID: null });

            assert.isNull(result.userId);
        });
    });
});
