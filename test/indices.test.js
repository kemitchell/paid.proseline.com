var tape = require('tape')
var indices = require('../indices')

tape('indices', function (test) {
  test.equal(indices.parse(indices.stringify(100)), 100)
  test.equal(indices.parse(indices.stringify(0)), 0)
  test.equal(indices.parse(indices.stringify(999999999999999)), 999999999999999)
  test.end()
})
