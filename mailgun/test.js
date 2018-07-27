var EventEmitter = require('events').EventEmitter
var assert = require('assert')

var events = new EventEmitter()

module.exports = function (requestLog, options, callback) {
  assert.equal(typeof requestLog, 'object')
  assert.equal(typeof options, 'object')
  assert.equal(typeof callback, 'function')
  process.nextTick(function () {
    callback()
    events.emit('sent', options)
  })
}

module.exports.events = events
