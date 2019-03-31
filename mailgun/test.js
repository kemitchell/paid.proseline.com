var EventEmitter = require('events').EventEmitter
var assert = require('assert')

var events = new EventEmitter()

module.exports = function (requestLog, options, callback) {
  assert.strictEqual(typeof requestLog, 'object')
  assert.strictEqual(typeof options, 'object')
  assert.strictEqual(typeof callback, 'function')
  process.nextTick(function () {
    callback()
    events.emit('sent', options)
  })
}

module.exports.events = events
