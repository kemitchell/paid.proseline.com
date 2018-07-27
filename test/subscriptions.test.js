var cancel = require('./cancel')
var concat = require('simple-concat')
var confirmCancel = require('./confirm-cancel')
var confirmSubscribe = require('./confirm-subscribe')
var constants = require('./constants')
var http = require('http')
var makeKeyPair = require('./make-key-pair')
var server = require('./server')
var sign = require('./sign')
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

tape('POST /subscribe with huge body', function (test) {
  server(function (port, done) {
    var request = http.request({
      method: 'POST',
      path: '/subscribe',
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

tape('POST /subscribe with invalid body', function (test) {
  server(function (port, done) {
    http.request({
      method: 'POST',
      path: '/subscribe',
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
      .end(JSON.stringify({}))
  })
})

tape('POST /subscribe with invalid signature', function (test) {
  server(function (port, done) {
    var message = {
      token: constants.VALID_STRIPE_SOURCE,
      date: new Date().toISOString(),
      email: 'test@example.com'
    }
    var order = {
      publicKey: 'a'.repeat(64),
      signature: 'b'.repeat(128),
      message
    }
    http.request({
      method: 'POST',
      path: '/subscribe',
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
      .end(JSON.stringify(order))
  })
})

tape('POST /subscribe with expired order', function (test) {
  server(function (port, done) {
    var keyPair = makeKeyPair()
    var date = new Date()
    date.setDate(date.getDate() - 30)
    var message = {
      token: constants.VALID_STRIPE_SOURCE,
      date: date.toISOString(),
      email: 'test@example.com'
    }
    var order = {
      publicKey: keyPair.publicKey.toString('hex'),
      signature: sign(message, keyPair.secretKey).toString('hex'),
      message
    }
    http.request({
      method: 'POST',
      path: '/subscribe',
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
      .end(JSON.stringify(order))
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

tape('POST /cancel', function (test) {
  server(function (port, done) {
    var email = 'test@example.com'
    subscribe(email, port, null, function (subscribeMessage) {
      confirmSubscribe(subscribeMessage, port, null, function () {
        cancel(email, port, test, function () {
          test.end()
          done()
        })
      })
    })
  })
})

tape('GET /cancel', function (test) {
  server(function (port, done) {
    var email = 'test@example.com'
    subscribe(email, port, null, function (subscribeMessage) {
      confirmSubscribe(subscribeMessage, port, null, function () {
        cancel(email, port, null, function (cancelMessage) {
          confirmCancel(cancelMessage, port, test, function () {
            test.end()
            done()
          })
        })
      })
    })
  })
})

tape('GET /cancel without capability', function (test) {
  server(function (port, done) {
    http.request({path: '/cancel', port})
      .once('response', function (response) {
        test.equal(
          response.statusCode, 200,
          'responds 200'
        )
        test.assert(
          response.headers['content-type'].includes('text/html'),
          'text/html'
        )
        concat(response, function (error, buffer) {
          var body = buffer.toString()
          test.ifError(error, 'no error')
          var name = 'Cancel'
          test.assert(
            body.includes(name),
            'body includes ' + JSON.stringify(name)
          )
          test.end()
          done()
        })
      })
      .end()
  })
})

tape('PUT /cancel', function (test) {
  server(function (port, done) {
    http.request({path: '/cancel', method: 'PUT', port})
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

tape('POST /subscribe after subscribing', function (test) {
  server(function (port, done) {
    var email = 'test@example.com'
    subscribe(email, port, null, function (subscribeMessage) {
      confirmSubscribe(subscribeMessage, port, null, function () {
        var keyPair = makeKeyPair()
        var message = {
          token: constants.VALID_STRIPE_SOURCE,
          date: new Date().toISOString(),
          email
        }
        var order = {
          publicKey: keyPair.publicKey.toString('hex'),
          signature: sign(message, keyPair.secretKey).toString('hex'),
          message
        }
        http.request({
          method: 'POST',
          path: '/subscribe',
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
          .end(JSON.stringify(order))
      })
    })
  })
})

tape('Resubscribe', function (test) {
  server(function (port, done) {
    var email = 'test@example.com'
    subscribe(email, port, null, function (subscribeMessage) {
      confirmSubscribe(subscribeMessage, port, null, function () {
        cancel(email, port, null, function (cancelMessage) {
          confirmCancel(cancelMessage, port, null, function () {
            subscribe(email, port, test, function (subscribeMessage) {
              test.end()
              done()
            })
          })
        })
      })
    })
  })
})

tape('GET /subscribe without capability', function (test) {
  server(function (port, done) {
    http.request({path: '/subscribe', port})
      .once('response', function (response) {
        test.equal(
          response.statusCode, 400,
          'responds 400'
        )
        test.end()
        done()
      })
      .end()
  })
})

tape('GET /subscribe with invalid capability', function (test) {
  server(function (port, done) {
    http.request({
      path: '/subscribe?capability=' + 'a'.repeat(64),
      port
    })
      .once('response', function (response) {
        test.equal(
          response.statusCode, 400,
          'responds 400'
        )
        concat(response, function (error, buffer) {
          var body = buffer.toString()
          test.ifError(error, 'no error')
          var name = 'Invalid'
          test.assert(
            body.includes(name),
            'body includes ' + JSON.stringify(name)
          )
          test.end()
          done()
        })
      })
      .end()
  })
})
