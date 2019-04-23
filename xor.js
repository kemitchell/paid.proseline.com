var assert = require('assert')

module.exports = function xor (a, b) {
  assert(a.length === b.length)
  var returned = Buffer.alloc(a.length)
  for (var offset = 0; offset < a.length; offset++) {
    returned[offset] = a[offset] ^ b[offset]
  }
  return returned
}
