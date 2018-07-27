var add = require('./add')
var confirmAdd = require('./confirm-add')
var confirmSubscribe = require('./confirm-subscribe')
var http = require('http')
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

tape('GET /add', function (test) {
  server(function (port, done) {
    var email = 'test@example.com'
    subscribe(email, port, null, function (subscribeMessage) {
      confirmSubscribe(subscribeMessage, port, test, function () {
        add(email, port, null, function (addMessage) {
          confirmAdd(addMessage, port, test, function () {
            test.end()
            done()
          })
        })
      })
    })
  })
})

tape('PUT /add', function (test) {
  server(function (port, done) {
    http.request({path: '/add', method: 'PUT', port})
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