var add = require('./add')
var concat = require('simple-concat')
var confirmAdd = require('./confirm-add')
var confirmSubscribe = require('./confirm-subscribe')
var http = require('http')
var server = require('./server')
var subscribe = require('./subscribe')
var tape = require('tape')

tape('POST /add', function (test) {
  server(function (port, done) {
    var email = 'test@example.com'
    var password = 'a terrible password'
    subscribe({ email, password, port }, function (message) {
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
    var password = 'a terrible password'
    subscribe({ email, password, port }, function (subscribeMessage) {
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
    http.request({ path: '/add', method: 'PUT', port })
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

tape.skip('POST /add with huge body', function (test) {
  server(function (port, done) {
    var request = http.request({
      method: 'POST',
      path: '/add',
      port
    })
      .once('response', function (response) {
        test.equal(
          response.statusCode, 413,
          'responds 413'
        )
        test.end()
        done()
      })
    var buffer = Buffer.alloc(512)
    for (var i = 0; i < 100; i++) {
      request.write(buffer)
    }
    request.end()
  })
})

tape('POST /add with invalid body', function (test) {
  server(function (port, done) {
    var request = http.request({
      method: 'POST',
      path: '/add',
      port
    })
      .once('response', function (response) {
        test.equal(
          response.statusCode, 400,
          'responds 400'
        )
        concat(response, function (error, buffer) {
          test.ifError(error, 'no error')
          test.equal(
            buffer.toString(),
            JSON.stringify({ error: 'invalid add' }),
            'invalid add message'
          )
          test.end()
          done()
        })
      })
    request.end(JSON.stringify({}))
  })
})

tape('POST /add with bad signature body', function (test) {
  server(function (port, done) {
    var message = {
      name: 'test device',
      date: new Date().toISOString(),
      email: 'test@example.com'
    }
    var add = {
      publicKey: 'a'.repeat(64),
      signature: 'b'.repeat(128),
      message
    }
    var request = http.request({
      method: 'POST',
      path: '/add',
      port
    })
      .once('response', function (response) {
        test.equal(
          response.statusCode, 400,
          'responds 400'
        )
        test.end()
        done()
      })
    request.end(JSON.stringify(add))
  })
})
