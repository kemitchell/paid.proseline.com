var concat = require('simple-concat')
var constants = require('./constants')
var crypto = require('@proseline/crypto')
var http = require('http')
var keyserverProtocol = require('../keyserver-protocol')
var mailgun = require('../mailgun/test').events
var makeKeyPair = require('./make-key-pair')

module.exports = function (options, callback) {
  var keyPair = options.keyPair || makeKeyPair()
  var email = options.email
  var port = options.port
  var test = options.test
  var password = options.password
  var result = keyserverProtocol.client.login({ password, email })
  var authenticationToken = result.authenticationToken.toString('hex')
  var clientStretchedPassword = result.clientStretchedPassword.toString('hex')
  var message = {
    token: constants.VALID_STRIPE_SOURCE,
    date: new Date().toISOString(),
    authenticationToken,
    clientStretchedPassword,
    email
  }
  var order = {
    publicKey: keyPair.publicKey.toString('hex'),
    message
  }
  crypto.sign(order, keyPair.secretKey, 'signature', 'message')
  mailgun.once('sent', function (message) {
    if (test) {
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
    }
    callback(message)
  })
  http.request({ path: '/subscribe', method: 'POST', port })
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
            body, JSON.stringify({ message: 'e-mail sent' }),
            'e-mail sent message'
          )
        })
      }
    })
    .end(JSON.stringify(order))
}
