var concat = require('simple-concat')
var crypto = require('@proseline/crypto')
var http = require('http')
var keyserverProtocol = require('../keyserver-protocol')

module.exports = function (email, password, port, callback) {
  var keyPair = crypto.signingKeyPair()
  var result = keyserverProtocol.client.login({ email, password })
  var clientStretchedPassword = result.clientStretchedPassword
  var authenticationToken = result.authenticationToken.toString('hex')
  var message = {
    email,
    authenticationToken,
    date: new Date().toISOString()
  }
  var body = {
    publicKey: keyPair.publicKey.toString('hex'),
    message
  }
  crypto.sign(body, keyPair.secretKey, 'signature', 'message')
  http.request({ path: '/encryptionkey', method: 'POST', port })
    .once('response', function (response) {
      var statusCode = response.statusCode
      concat(response, function (error, buffer) {
        if (error) return callback(error)
        var body = buffer.toString()
        var parsed = JSON.parse(body)
        parsed.clientStretchedPassword = clientStretchedPassword
        callback(null, statusCode, parsed)
      })
    })
    .end(JSON.stringify(body))
}
