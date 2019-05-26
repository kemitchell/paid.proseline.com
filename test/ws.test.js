var ReplicationProtocol = require('../protocol')
var assert = require('assert')
var confirmSubscribe = require('./confirm-subscribe')
var crypto = require('@proseline/crypto')
var invite = require('./invite')
var keyserverProtocol = require('../keyserver-protocol')
var requestEncryptionKey = require('./request-encryption-key')
var runSeries = require('run-series')
var server = require('./server')
var stringify = require('fast-json-stable-stringify')
var subscribe = require('./subscribe')
var tape = require('tape')
var websocketStream = require('websocket-stream')

var wsOptions = { perMessageDeflate: false }

tape.test('connect to invalid path', function (test) {
  server(function (port, done) {
    var receivedData = false
    websocketStream('ws://localhost:' + port, wsOptions)
      .once('error', function (error) {
        test.ifError(error)
      })
      .once('data', function (chunk) {
        receivedData = true
      })
      .once('end', function () {
        test.assert(!receivedData, 'no data')
        done()
        test.end()
      })
  })
})

tape('Replication', function (test) {
  server(function (port, done) {
    // User
    var clientKeyPair = crypto.signingKeyPair()
    var logKeyPair = crypto.signingKeyPair()
    var logPublicKey = logKeyPair.publicKey
    var email = 'test@example.com'
    var password = 'a terrible password'

    // Project
    var replicationKey = crypto.projectReplicationKey()
    var projectDiscoveryKey = crypto.discoveryKey(replicationKey)
    var readKey = crypto.projectReadKey()
    var writeSeed = crypto.signingKeyPairSeed()
    var writeKeyPair = crypto.signingKeyPairFromSeed(writeSeed)

    // First Entry
    var index = 0
    var entry = {
      type: 'intro',
      name: 'John Doe',
      device: 'laptop',
      timestamp: new Date().toISOString()
    }
    var innerEnvelope = { entry }
    crypto.sign(innerEnvelope, logKeyPair.secretKey, 'logSignature')
    crypto.sign(innerEnvelope, writeKeyPair.secretKey, 'projectSignature')
    var nonce = crypto.randomNonce()
    var stringified = stringify(entry)
    var outerEnvelope = {
      projectDiscoveryKey,
      logPublicKey,
      index: 0,
      nonce,
      encryptedInnerEnvelope: crypto.encryptUTF8(
        stringified, nonce, readKey
      )
    }

    runSeries([
      createSubscription,
      sendEnvelopeToServer,
      getEnvelopeFromServer
    ], function () {
      test.end()
      done()
    })

    function createSubscription (done) {
      var subscribeOptions = {
        keyPair: clientKeyPair,
        email,
        password,
        port
      }
      subscribe(subscribeOptions, function (subscribeMessage) {
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
              var accountEncryptionKey = clientResult.encryptionKey.toString('hex')
              invite({
                clientKeyPair,
                accountEncryptionKey,
                replicationKey,
                readKey,
                writeSeed
              }, port, test, done)
            }
          )
        })
      })
    }

    function sendEnvelopeToServer (done) {
      replicate({
        projectDiscoveryKey, replicationKey, test, port
      }, function (socket, protocol) {
        protocol.offer({ logPublicKey, index }, function (error) {
          test.ifError(error, 'no error offering to server')
        })
        protocol.once('request', function (request) {
          test.equal(
            request.logPublicKey, logPublicKey,
            'server requests public key'
          )
          test.equal(
            request.index, index,
            'server requests index'
          )
          protocol.outerEnvelope(outerEnvelope, function (error) {
            test.ifError(error, 'no error sending envelope')
            protocol.end()
            socket.end()
            done()
          })
        })
      })
    }

    function getEnvelopeFromServer (done) {
      replicate({
        projectDiscoveryKey, replicationKey, test, port
      }, function (socket, protocol) {
        protocol.once('offer', function (offer) {
          test.equal(
            offer.logPublicKey, logPublicKey,
            'server offers public key'
          )
          test.equal(
            offer.index, index,
            'server offers index'
          )
          protocol.once('outerEnvelope', function (received) {
            test.deepEqual(
              received, outerEnvelope,
              'received envelope from server'
            )
            protocol.end()
            socket.end()
            done()
          })
          protocol.request(offer, function (error) {
            test.ifError(error, 'no error requesting envelope')
          })
        })
      })
    }
  })
})

function replicate (options, done) {
  assert(typeof options === 'object')
  assert(typeof done === 'function')
  var projectDiscoveryKey = options.projectDiscoveryKey
  assert(typeof projectDiscoveryKey === 'string')
  var port = options.port
  assert(Number.isSafeInteger(port))
  var replicationKey = options.replicationKey
  assert(typeof replicationKey === 'string')
  var test = options.test
  assert(typeof test === 'object')
  var socket = websocketStream(
    'ws://localhost:' + port + '/' + projectDiscoveryKey,
    wsOptions
  )
  var key = Buffer.from(replicationKey, 'hex')
  var protocol = new ReplicationProtocol({ key })
  protocol.once('handshake', function () {
    done(socket, protocol)
  })
  protocol.handshake(function (error) {
    test.ifError(error, 'no error sending handshake')
  })
  socket.pipe(protocol).pipe(socket)
}

tape('replicate unknown project', function (test) {
  server(function (port, done) {
    var replicationKey = crypto.projectReplicationKey()
    var projectDiscoveryKey = crypto.discoveryKey(replicationKey)
    var receivedData = false
    websocketStream(
      'ws://localhost:' + port + '/' + projectDiscoveryKey,
      wsOptions
    )
      .on('data', function () {
        receivedData = true
      })
      .once('close', function () {
        test.assert(!receivedData, 'received no data')
        test.end()
        done()
      })
  })
})

tape('replicate project with wrong key', function (test) {
  server(function (port, done) {
    // User
    var clientKeyPair = crypto.signingKeyPair()
    var email = 'test@example.com'
    var password = 'a terrible password'

    // Project
    var replicationKey = crypto.projectReplicationKey()
    var projectDiscoveryKey = crypto.discoveryKey(replicationKey)
    var readKey = crypto.projectReadKey()
    var writeSeed = crypto.signingKeyPairSeed()

    runSeries([
      subscribeAndInvite,
      tryToReplicateWithWrongKey
    ], function () {
      test.end()
      done()
    })

    function subscribeAndInvite (done) {
      var subscribeOptions = {
        keyPair: clientKeyPair,
        email,
        password,
        port
      }
      subscribe(subscribeOptions, function (subscribeMessage) {
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
              var accountEncryptionKey = clientResult.encryptionKey.toString('hex')
              invite({
                clientKeyPair,
                accountEncryptionKey,
                replicationKey,
                readKey,
                writeSeed
              }, port, test, done)
            }
          )
        })
      })
    }

    function tryToReplicateWithWrongKey (done) {
      test.pass('replicating')
      var socket = websocketStream(
        'ws://localhost:' + port + '/' + projectDiscoveryKey,
        wsOptions
      )
      var protocol = new ReplicationProtocol({
        key: Buffer.from(crypto.projectReplicationKey(), 'hex')
      })
      protocol.handshake(function (error) {
        test.ifError(error, 'no handshake error')
      })
      socket.once('end', function () {
        test.pass('ended')
        protocol.end()
        done()
      })
      socket.pipe(protocol).pipe(socket)
    }
  })
})

tape('envelopes across sockets', function (test) {
  server(function (port, done) {
    // User
    var clientKeyPair = crypto.signingKeyPair()
    var logKeyPair = crypto.signingKeyPair()
    var logPublicKey = logKeyPair.publicKey
    var email = 'test@example.com'
    var password = 'a terrible password'

    // Project
    var replicationKey = crypto.projectReplicationKey()
    var projectDiscoveryKey = crypto.discoveryKey(replicationKey)
    var readKey = crypto.projectReadKey()
    var writeSeed = crypto.signingKeyPairSeed()
    var writeKeyPair = crypto.signingKeyPairFromSeed(writeSeed)

    // First Entry
    var entry = {
      type: 'intro',
      name: 'John Doe',
      device: 'laptop',
      timestamp: new Date().toISOString()
    }
    var index = 0
    var innerEnvelope = { entry }
    crypto.sign(innerEnvelope, logKeyPair.secretKey, 'logSignature')
    crypto.sign(innerEnvelope, writeKeyPair.secretKey, 'projectSignature')
    var nonce = crypto.randomNonce()
    var outerEnvelope = {
      projectDiscoveryKey,
      logPublicKey,
      index,
      nonce,
      encryptedInnerEnvelope: crypto.encryptUTF8(
        stringify(entry), nonce, readKey
      )
    }

    runSeries([
      subscribeAndInvite,
      awaitOffer,
      sendEnvelope
    ])

    function finish () {
      test.end()
      done()
    }

    function subscribeAndInvite (done) {
      var subscribeOptions = {
        keyPair: clientKeyPair,
        email,
        password,
        port
      }
      subscribe(subscribeOptions, function (subscribeMessage) {
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
              var accountEncryptionKey = clientResult.encryptionKey.toString('hex')
              invite({
                clientKeyPair,
                accountEncryptionKey,
                replicationKey,
                readKey,
                writeSeed
              }, port, test, done)
            }
          )
        })
      })
    }

    function awaitOffer (done) {
      replicate({
        projectDiscoveryKey, replicationKey, test, port
      }, function (socket, protocol) {
        protocol.once('offer', function (offer) {
          test.equal(
            offer.logPublicKey, logPublicKey,
            'server offers public key'
          )
          test.equal(
            offer.index, index,
            'server offers entry 0'
          )
          protocol.end()
          socket.end()
          finish()
        })
        done()
      })
    }

    function sendEnvelope (done) {
      replicate({
        projectDiscoveryKey, replicationKey, test, port
      }, function (socket, protocol) {
        protocol.offer({ logPublicKey, index }, function (error) {
          test.ifError(error, 'no error offering to server')
        })
        protocol.once('request', function (request) {
          test.equal(
            request.logPublicKey, logPublicKey,
            'server requests public key'
          )
          test.equal(
            request.index, index,
            'server requests index'
          )
          protocol.outerEnvelope(outerEnvelope, function (error) {
            test.ifError(error, 'no error sending envelope')
            protocol.end()
            socket.end()
            done()
          })
        })
      })
    }
  })
})
