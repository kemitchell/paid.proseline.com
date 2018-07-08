var assert = require('assert')

var indices = require('./indices')

assert.equal(indices.parse(indices.stringify(100)), 100)
assert.equal(indices.parse(indices.stringify(0)), 0)
assert.equal(indices.parse(indices.stringify(999999999999999)), 999999999999999)
