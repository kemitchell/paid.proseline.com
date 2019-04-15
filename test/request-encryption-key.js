var concat = require('simple-concat')
var http = require('http')
var keyserverProtocol = require('../keyserver-protocol')
var makeKeyPair = require('./make-key-pair')
var sign = require('./sign')

module.exports = function (email, password, port, callback) {
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
      var statusCode = response.statusCode
      concat(response, function (error, buffer) {
        if (error) return callback(error)
        var body = buffer.toString()
        var parsed = JSON.parse(body)
        callback(null, statusCode, parsed)
      })
    })
    .end(JSON.stringify(body))
}
