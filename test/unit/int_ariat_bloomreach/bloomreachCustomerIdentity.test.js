'use strict';

var assert = require('chai').assert;
var mod = require('../../../cartridges/int_ariat_bloomreach/cartridge/scripts/helpers/bloomreachCustomerIdentity');

describe('int_ariat_bloomreach/helpers/bloomreachCustomerIdentity', function () {
    it('returns the customer id when authenticated', function () {
        var userId = mod.resolveUserId({ authenticated: true, ID: 'abc123' });

        assert.equal(userId, 'abc123');
    });

    it('returns null when not authenticated (guest/anonymous shopper)', function () {
        assert.isNull(mod.resolveUserId({ authenticated: false, ID: 'guest-session-id' }));
    });

    it('returns null when no customer is provided', function () {
        assert.isNull(mod.resolveUserId(null));
        assert.isNull(mod.resolveUserId(undefined));
    });

    it('returns null when authenticated but somehow has no id', function () {
        assert.isNull(mod.resolveUserId({ authenticated: true, ID: null }));
    });
});
