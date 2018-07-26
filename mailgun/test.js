var EventEmitter = require('events').EventEmitter

var events = new EventEmitter()

module.exports = function (requestLog, options, callback) {
  setImmediate(function () {
    callback()
    events.emit('sent', options)
  })
}

module.exports.events = events
