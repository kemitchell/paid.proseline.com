var zeroFill = require('zero-fill')

var INDEX_WIDTH = 15
var MAX_INDEX = parseInt('9'.repeat(INDEX_WIDTH))

exports.stringify = function (index) {
  return zeroFill(INDEX_WIDTH, MAX_INDEX - index)
}

exports.parse = function (string) {
  return MAX_INDEX - parseInt(string)
}
