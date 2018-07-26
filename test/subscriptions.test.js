var concat = require('simple-concat')
var constants = require('./constants')
var http = require('http')
var mailgun = require('../mailgun/test').events
var makeKeyPair = require('./make-key-pair')
var server = require('./server')
var sodium = require('sodium-native')
var stringify = require('fast-json-stable-stringify')
var tape = require('tape')
var url = require('url')

tape('POST /subscribe', function (test) {
  server(function (port, done) {
    var keyPair = makeKeyPair()
    var email = 'test@exmaple.com'
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
    mailgun.once('sent', function (message) {
      test.equal(message.to, email, 'to address')
      test.assert(message.subject.includes('Confirm'), 'subject has "Confirm"')
      test.assert(
        message.paragraphs.some(function (paragraph) {
          return paragraph.includes(
            'https://' + constants.HOSTNAME + '/subscribe'
          )
        }),
        'sent capability link'
      )
      test.end()
      done()
    })
    http.request({path: '/subscribe', method: 'POST', port})
      .once('response', function (response) {
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
      })
      .end(JSON.stringify(order))
  })
})

tape('GET /subscribe', function (test) {
  server(function (port, done) {
    var keyPair = makeKeyPair()
    var email = 'test@exmaple.com'
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
    mailgun.once('sent', function (message) {
      test.equal(message.to, email, 'to address')
      test.assert(message.subject.includes('Confirm'), 'subject has "Confirm"')
      var link = message.paragraphs.find(function (paragraph) {
        return paragraph.includes(
          'https://' + constants.HOSTNAME + '/subscribe'
        )
      })
      var parsed = url.parse(link)
      http.request({path: parsed.path, port})
        .once('response', function (response) {
          test.equal(
            response.statusCode, 200,
            'responds 200'
          )
          concat(response, function (error, buffer) {
            var body = buffer.toString()
            test.ifError(error, 'no error')
            var name = 'Subscribed'
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
    http.request({path: '/subscribe', method: 'POST', port})
      .once('response', function (response) {
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
      })
      .end(JSON.stringify(order))
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

function sign (data, secretKey) {
  var signature = Buffer.alloc(sodium.crypto_sign_BYTES)
  sodium.crypto_sign_detached(signature, Buffer.from(stringify(data)), secretKey)
  return signature
}
