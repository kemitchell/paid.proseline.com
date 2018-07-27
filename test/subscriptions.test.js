var confirmSubscribe = require('./confirm-subscribe')
var http = require('http')
var server = require('./server')
var subscribe = require('./subscribe')
var tape = require('tape')

tape('POST /subscribe', function (test) {
  server(function (port, done) {
    subscribe('test@example.com', port, test, function () {
      test.end()
      done()
    })
  })
})

tape('GET /subscribe', function (test) {
  server(function (port, done) {
    subscribe('test@example.com', port, null, function (email) {
      confirmSubscribe(email, port, test, function () {
        test.end()
        done()
      })
    })
  })
})

tape('PUT /subscribe', function (test) {
  server(function (port, done) {
    http.request({path: '/subscribe', method: 'PUT', port})
      .once('response', function (response) {
        test.equal(
          response.statusCode, 405,
          'responds 405'
        )
        test.end()
        done()
      })
      .end()
  })
})
