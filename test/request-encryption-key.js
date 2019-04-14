var concat = require('simple-concat')
var http = require('http')
var keyserverProtocol = require('../keyserver-protocol')
var makeKeyPair = require('./make-key-pair')
var sign = require('./sign')

module.exports = function (email, password, port, test, callback) {
  var keyPair = makeKeyPair()
  var result = keyserverProtocol.client.login({ email, password })
  var authenticationToken = result.authenticationToken.toString('hex')
  var clientStretchedPassword = result.clientStretchedPassword.toString('hex')
  var message = {
    email,
    authenticationToken,
    clientStretchedPassword,
    date: new Date().toISOString()
  }
  var body = {
    publicKey: keyPair.publicKey.toString('hex'),
    signature: sign(message, keyPair.secretKey).toString('hex'),
    message
  }
  http.request({ path: '/encryptionkey', method: 'POST', port })
    .once('response', function (response) {
      test.equal(
        response.statusCode, 200,
        'responds 200'
      )
      concat(response, function (error, buffer) {
        test.ifError(error, 'no error')
        var body = buffer.toString()
        var parsed = JSON.parse(body)
        test.strictEqual(parsed.error, undefined)
        test.assert(parsed.hasOwnProperty('serverWrappedKey'))
        callback(null, parsed)
      })
    })
    .end(JSON.stringify(body))
}
