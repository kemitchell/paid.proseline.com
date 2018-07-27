var add = require('./add')
var confirmSubscribe = require('./confirm-subscribe')
var server = require('./server')
var subscribe = require('./subscribe')
var tape = require('tape')

tape('POST /add', function (test) {
  server(function (port, done) {
    var email = 'test@example.com'
    subscribe(email, port, null, function (message) {
      confirmSubscribe(message, port, null, function () {
        add(email, port, test, function () {
          test.end()
          done()
        })
      })
    })
  })
})
