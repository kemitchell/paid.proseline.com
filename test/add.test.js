var concat = require('simple-concat')
var confirmSubscribe = require('./confirm-subscribe')
var http = require('http')
var makeKeyPair = require('./make-key-pair')
var server = require('./server')
var sign = require('./sign')
var subscribe = require('./subscribe')
var tape = require('tape')

tape('POST /add', function (test) {
  server(function (port, done) {
    var email = 'test@example.com'
    subscribe(email, port, null, function (message) {
      confirmSubscribe(message, port, null, function () {
        var keyPair = makeKeyPair()
        var message = {
          name: 'test device',
          date: new Date().toISOString(),
          email
        }
        var add = {
          publicKey: keyPair.publicKey.toString('hex'),
          signature: sign(message, keyPair.secretKey).toString('hex'),
          message
        }
        http.request({path: '/add', method: 'POST', port})
          .once('response', function (response) {
            if (test) {
              test.equal(
                response.statusCode, 200,
                'responds 200'
              )
              concat(response, function (error, buffer) {
                var body = buffer.toString()
                test.ifError(error, 'no error')
                test.equal(
                  body, JSON.stringify({message: 'e-mail sent'}),
                  'e-mail sent message'
                )
              })
              test.end()
              done()
            }
          })
          .end(JSON.stringify(add))
      })
    })
  })
})
