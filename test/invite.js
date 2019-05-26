var crypto = require('@proseline/crypto')
var http = require('http')

module.exports = function (options, port, test, done) {
  var clientKeyPair = options.clientKeyPair
  var accountEncryptionKey = options.accountEncryptionKey
  var replicationKey = options.replicationKey
  var readKey = options.readKey
  var writeSeed = options.writeSeed
  var title = options.title || 'Untitled'
  var invite = makeInvite({
    clientKeyPair,
    accountEncryptionKey,
    replicationKey,
    readKey,
    writeSeed,
    title
  })
  http.request({
    path: '/invitation',
    method: 'POST',
    port
  })
    .once('response', function (response) {
      test.equal(
        response.statusCode, 204,
        'POST /invitation: responds 204'
      )
      done()
    })
    .end(JSON.stringify(invite))
}

function makeInvite (options) {
  var clientKeyPair = options.clientKeyPair
  var accountEncryptionKey = options.accountEncryptionKey
  var replicationKey = options.replicationKey
  var readKey = options.readKey
  var readKeyNonce = crypto.randomNonce()
  var writeSeed = options.writeSeed
  var writeSeedNonce = crypto.randomNonce()
  var title = options.title || 'Untitled'
  var titleNonce = crypto.randomNonce()
  var message = {
    replicationKey: replicationKey,
    readKeyCiphertext: crypto.encryptHex(
      readKey, readKeyNonce, accountEncryptionKey
    ),
    readKeyNonce,
    writeSeedCiphertext: crypto.encryptHex(
      writeSeed, writeSeedNonce, accountEncryptionKey
    ),
    writeSeedNonce,
    titleCiphertext: crypto.encryptHex(
      title, titleNonce, accountEncryptionKey
    ),
    titleNonce
  }
  var returned = {
    publicKey: clientKeyPair.publicKey,
    message
  }
  crypto.sign(returned, clientKeyPair.secretKey, 'signature', 'message')
  return returned
}
