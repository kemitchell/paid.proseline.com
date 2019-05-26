var concat = require('simple-concat')
var confirmSubscribe = require('./confirm-subscribe')
var http = require('http')
var requestEncryptionKey = require('./request-encryption-key')
var server = require('./server')
var subscribe = require('./subscribe')
var tape = require('tape')

tape('POST /encryptionkey', function (test) {
  server(function (port, done) {
    var email = 'test@example.com'
    var password = 'a terrible password'
    subscribe({ email, password, port }, function (message) {
      confirmSubscribe(message, port, null, function () {
        requestEncryptionKey(
          email, password, port,
          function (error, statusCode, result) {
            test.ifError(error)
            test.strictEqual(statusCode, 200)
            test.strictEqual(typeof result.clientWrappedKey, 'string')
            test.end()
            done()
          }
        )
      })
    })
  })
})

tape('POST /encryptionkey without confirming', function (test) {
  server(function (port, done) {
    var email = 'test@example.com'
    var password = 'a terrible password'
    subscribe({ email, password, port }, function (message) {
      requestEncryptionKey(
        email, password, port,
        function (error, statusCode, result) {
          test.ifError(error)
          test.strictEqual(statusCode, 400)
          test.end()
          done()
        }
      )
    })
  })
})

tape('GET /encryptionkey', function (test) {
  server(function (port, done) {
    http.request({ path: '/encryptionkey', method: 'GET', port })
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

tape('PUT /encryptionkey', function (test) {
  server(function (port, done) {
    http.request({ path: '/encryptionkey', method: 'PUT', port })
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

tape('POST /encryptionkey with huge body', function (test) {
  server(function (port, done) {
    var request = http.request({
      method: 'POST',
      path: '/encryptionkey',
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
    var buffer = Buffer.alloc(2048)
    for (var i = 0; i < 100; i++) {
      request.write(buffer)
    }
    request.end()
  })
})

tape('POST /encryptionkey with invalid body', function (test) {
  server(function (port, done) {
    var request = http.request({
      method: 'POST',
      path: '/encryptionkey',
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
            JSON.stringify({ error: 'invalid request' }),
            'invalid encryption key request'
          )
          test.end()
          done()
        })
      })
    request.end(JSON.stringify({}))
  })
})

tape('POST /encryptionkey with bad signature body', function (test) {
  server(function (port, done) {
    var message = {
      date: new Date().toISOString(),
      authenticationToken: 'a'.repeat(64),
      clientStretchedPassword: 'a'.repeat(64),
      email: 'test@example.com'
    }
    var data = {
      publicKey: 'a'.repeat(64),
      signature: 'b'.repeat(128),
      message
    }
    var request = http.request({
      method: 'POST',
      path: '/encryptionkey',
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
    request.end(JSON.stringify(data))
  })
})
