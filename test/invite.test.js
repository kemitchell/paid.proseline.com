var confirmSubscribe = require('./confirm-subscribe')
var crypto = require('@proseline/crypto')
var http = require('http')
var keyserverProtocol = require('../keyserver-protocol')
var requestEncryptionKey = require('./request-encryption-key')
var server = require('./server')
var subscribe = require('./subscribe')
var tape = require('tape')

tape('invite', function (test) {
  server(function (port, done) {
    var keyPair = crypto.signingKeyPair()
    var email = 'test@example.com'
    var password = 'a terrible password'
    subscribe({ keyPair, password, email, port }, function (subscribeMessage) {
      confirmSubscribe(subscribeMessage, port, null, function () {
        requestEncryptionKey(
          email, password, port,
          function (error, statusCode, result) {
            test.ifError(error, 'no error')
            test.strictEqual(statusCode, 200, 'encryption key: responds 200')
            var clientWrappedKey = result.clientWrappedKey
            var clientStretchedPassword = result.clientStretchedPassword
            var clientResult = keyserverProtocol.client.request({
              clientStretchedPassword,
              clientWrappedKey
            })
            var encryptionKey = clientResult.encryptionKey.toString('hex')
            var replicationKey = crypto.projectReplicationKey()
            var readKey = crypto.projectReadKey()
            var writeSeed = crypto.signingKeyPairSeed()
            var title = 'test project'
            var body = makeInvitationMessage({
              keyPair,
              encryptionKey,
              replicationKey,
              readKey,
              writeSeed,
              title
            })
            http.request({
              path: '/invites',
              method: 'POST',
              port
            })
              .once('response', function (response) {
                test.equal(
                  response.statusCode, 204,
                  'POST invite: responds 204'
                )
                done()
                test.end()
              })
              .end(JSON.stringify(body))
          }
        )
      })
    })
  })
})

function makeInvitationMessage (options) {
  var keyPair = options.keyPair
  var encryptionKey = options.encryptionKey
  var replicationKey = options.replicationKey
  var readKey = options.readKey
  var readKeyNonce = crypto.randomNonce()
  var writeSeed = options.writeSeed
  var writeSeedNonce = crypto.randomNonce()
  var title = options.title
  var titleNonce = crypto.randomNonce()
  var invitation = {
    replicationKey: replicationKey,
    readKeyCiphertext: crypto.encryptHex(
      readKey, readKeyNonce, encryptionKey
    ),
    readKeyNonce,
    writeSeedCiphertext: crypto.encryptHex(
      writeSeed, writeSeedNonce, encryptionKey
    ),
    writeSeedNonce,
    titleCiphertext: crypto.encryptHex(
      title, titleNonce, encryptionKey
    ),
    titleNonce
  }
  var message = {
    publicKey: keyPair.publicKey,
    message: invitation
  }
  crypto.sign(message, keyPair.secretKey, 'signature', 'message')
  return message
}
