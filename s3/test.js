exports.DELIMITER = '/'

var data

exports.clear = function () {
  data = new Map()
}

exports.clear()

exports.first = function (prefix, callback) {
  setImmediate(function () {
    var key = data
      .keys()
      .sort()
      .find(function (element) {
        return element.key.startsWith(prefix)
      })
    callback(null, key)
  })
}

exports.delete = function (key, callback) {
  setImmediate(function () {
    data.delete(key)
    callback()
  })
}

exports.get = function (key, callback) {
  setImmediate(function () {
    if (!data.has(key)) return callback(null, undefined)
    callback(null, data.get(key))
  })
}

exports.put = function (key, value, callback) {
  setImmediate(function () {
    data.set(key, value)
    callback()
  })
}

exports.list = function (prefix, callback) {
  setImmediate(function () {
    var keys = data
      .keys()
      .sort()
      .filter(function (element) {
        return element.key.startsWith(prefix)
      })
    callback(null, keys)
  })
}
