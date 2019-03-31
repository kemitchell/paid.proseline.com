var assert = require('assert')

exports.DELIMITER = '/'

var data

exports.clear = function () {
  data = new Map()
}

exports.clear()

exports.first = function (prefix, callback) {
  assert.strictEqual(typeof prefix, 'string')
  assert.strictEqual(typeof callback, 'function')
  setImmediate(function () {
    var key = Array.from(data.keys())
      .sort()
      .find(function (key) {
        return key.startsWith(prefix)
      })
    callback(null, key)
  })
}

exports.delete = function (key, callback) {
  assert.strictEqual(typeof key, 'string')
  assert.strictEqual(typeof callback, 'function')
  setImmediate(function () {
    data.delete(key)
    callback()
  })
}

exports.get = function (key, callback) {
  assert.strictEqual(typeof key, 'string')
  assert.strictEqual(typeof callback, 'function')
  setImmediate(function () {
    if (!data.has(key)) return callback(null, undefined)
    callback(null, data.get(key))
  })
}

exports.put = function (key, value, callback) {
  assert.strictEqual(typeof key, 'string')
  assert(value !== undefined)
  assert.strictEqual(typeof callback, 'function')
  setImmediate(function () {
    data.set(key, value)
    callback()
  })
}

exports.list = function (prefix, callback) {
  assert.strictEqual(typeof prefix, 'string')
  assert.strictEqual(typeof callback, 'function')
  setImmediate(function () {
    var keys = Array.from(data.keys())
      .sort()
      .filter(function (key) {
        return key.startsWith(prefix)
      })
    callback(null, keys)
  })
}
