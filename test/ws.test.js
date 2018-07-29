var confirmSubscribe = require('./confirm-subscribe')
var duplexify = require('duplexify')
var makeKeyPair = require('./make-key-pair')
var multiplex = require('multiplex')
var protocol = require('proseline-protocol')
var runSeries = require('run-series')
var server = require('./server')
var sign = require('./sign')
var sodium = require('sodium-native')
var subscribe = require('./subscribe')
var tape = require('tape')
var websocketStream = require('websocket-stream')

tape.test('Connect to WebSocket', function (test) {
  server(function (port, done) {
    var ws = websocketStream('ws://localhost:' + port, wsOptions)
      .once('error', function (error) {
        test.ifError(error)
      })
      .once('data', function () {
        test.pass('received data')
        ws.destroy()
        done()
        test.end()
      })
  })
})

tape.test('Invitations', function (test) {
  server(function (port, done) {
    var keyPair = makeKeyPair()
    var email = 'test@example.com'
    subscribe({keyPair, email, port}, function (subscribeMessage) {
      confirmSubscribe(subscribeMessage, port, null, function () {
        var replicationKey = makeRandom(32)
        var writeSeed = makeRandom(32)
        var title = 'test project'
        var firstWS = makeWebsocket(port)
        var firstPlex = multiplex()
        var firstProtocol = makeInvitationProtocol(firstPlex)
        var invitation = makeInvitation(keyPair, {
          replicationKey, writeSeed, title
        })
        connect(firstPlex, firstWS)
        firstProtocol.invitation(invitation, function (error) {
          test.ifError(error, 'no send invitation error')
          test.pass('sent invitation')
          var secondWS = makeWebsocket(port)
          var secondPlex = testErrors(multiplex())
          var secondProtocol = makeInvitationProtocol(secondPlex)
          var request = makeInvitationRequest(email, keyPair)
          secondProtocol.request(request, function (error) {
            test.ifError(error, 'no request send error')
            test.pass('sent request')
          })
          secondProtocol.once('invitation', function (invitation) {
            test.pass('received invitation')
            var message = invitation.message
            test.equal(
              message.replicationKey, replicationKey.toString('hex'),
              'received replication key'
            )
            test.equal(
              message.writeSeed, writeSeed.toString('hex'),
              'received received write seed'
            )
            test.equal(
              message.title, title,
              'received title'
            )
            firstWS.destroy()
            secondWS.destroy()
            test.end()
            done()
          })
          connect(secondPlex, secondWS)
        })
      })
    })
  })

  function testErrors (stream) {
    stream.once('error', function (error) {
      test.ifError(error, 'no stream error')
    })
    return stream
  }
})

function makeInvitationProtocol (plex) {
  var transport = plex.createSharedStream('invitation')
  var protocolStream = protocol.Invitation()
  connect(protocolStream, transport)
  return protocolStream
}

function makeInvitationRequest (email, keyPair) {
  return makeMessage(keyPair, {date: new Date().toISOString(), email})
}

function makeInvitation (keyPair, options) {
  return makeMessage(keyPair, {
    replicationKey: options.replicationKey.toString('hex'),
    writeSeed: options.writeSeed.toString('hex'),
    title: options.title
  })
}

function makeMessage (keyPair, message) {
  return {
    publicKey: keyPair.publicKey.toString('hex'),
    signature: sign(message, keyPair.secretKey).toString('hex'),
    message
  }
}

function makeRandom (bytes) {
  var returned = Buffer.alloc(bytes)
  sodium.randombytes_buf(returned)
  return returned
}

tape('invitation for request without subscription', function (test) {
  server(function (port, done) {
    var email = 'test@example.com'
    var keyPair = makeKeyPair()
    var ws = makeWebsocket(port)
    var plex = multiplex()
    connect(plex, ws)
    var invitation = makeInvitationProtocol(plex)
    var request = makeInvitationRequest(email, keyPair)
    invitation.request(request, function (error) {
      test.ifError(error, 'no request send error')
      test.pass('sent request')
      setTimeout(function () {
        ws.destroy()
        test.end()
        done()
      }, 100)
    })
    invitation.once('invitation', function () {
      test.fail('received invitation')
    })
  })
})

tape('Replication', function (test) {
  server(function (port, done) {
    // User
    var keyPair = makeKeyPair()
    var email = 'test@example.com'

    // Project
    var replicationKey = makeRandom(32)
    var discoveryKey = hash(replicationKey).toString('hex')
    var writeSeed = makeRandom(32)
    var writeKeyPair = keyPairFromSeed(writeSeed)
    var title = 'test project'

    // First Entry
    var publicKey = keyPair.publicKey.toString('hex')
    var index = 0
    var message = {
      project: discoveryKey,
      index: 0,
      body: {
        type: 'intro',
        name: 'John Doe',
        device: 'laptop',
        timestamp: new Date().toISOString()
      }
    }
    var envelope = {
      message,
      publicKey,
      signature: sign(message, keyPair.secretKey).toString('hex'),
      authorization: sign(message, writeKeyPair.secretKey).toString('hex')
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
      subscribe({keyPair, email, port}, function (subscribeMessage) {
        confirmSubscribe(subscribeMessage, port, null, done)
      })
    }

    function sendEnvelopeToServer (done) {
      var firstWS = makeWebsocket(port)
      var plex = multiplex()
      var invitation = makeInvitationProtocol(plex)
      var invite = makeInvitation(keyPair, {replicationKey, writeSeed, title})
      invitation.invitation(invite, function (error) {
        test.ifError(error, 'no send invitation error')
        setTimeout(function () {
          var replication = makeReplicationProtocol({
            discoveryKey,
            plex,
            replicationKey,
            publicKey: writeKeyPair.publicKey,
            secretKey: writeKeyPair.secretKey
          })
          replication.handshake(function (error) {
            test.ifError(error, 'no error sending handshake')
          })
          replication.once('handshake', function () {
            replication.offer({publicKey, index}, function (error) {
              test.ifError(error, 'no error offering to server')
            })
            replication.once('request', function (request) {
              test.equal(
                request.publicKey, publicKey,
                'server requests public key'
              )
              test.equal(
                request.index, index,
                'server requests index'
              )
              replication.envelope(envelope, function (error) {
                test.ifError(error, 'no error sending envelope')
                firstWS.destroy()
                done()
              })
            })
          })
        }, 100)
      })
      connect(plex, firstWS)
    }

    function getEnvelopeFromServer (done) {
      setTimeout(function () {
        var secondWS = makeWebsocket(port)
        var plex = multiplex()
        var replication = makeReplicationProtocol({
          discoveryKey,
          plex,
          replicationKey,
          publicKey: writeKeyPair.publicKey,
          secretKey: writeKeyPair.secretKey
        })
        replication.handshake(function (error) {
          test.ifError(error, 'no error sending handshake')
        })
        replication.once('handshake', function () {
          replication.once('offer', function (offer) {
            test.equal(
              offer.publicKey, publicKey,
              'server offers public key'
            )
            test.equal(
              offer.index, index,
              'server offers index'
            )
            replication.once('envelope', function (received) {
              test.deepEqual(
                received, envelope,
                'received envelope from server'
              )
              secondWS.destroy()
              done()
            })
            replication.request(offer, function (error) {
              test.ifError(error, 'no error requesting envelope')
            })
          })
        })
        connect(plex, secondWS)
      }, 100)
    }
  })
})

function hash (buffer) {
  var digest = Buffer.alloc(sodium.crypto_generichash_BYTES)
  sodium.crypto_generichash(digest, buffer)
  return digest
}

function connect (a, b) {
  a.pipe(b).pipe(a)
}

var wsOptions = {perMessageDeflate: false}

function makeWebsocket (port) {
  return websocketStream('ws://localhost:' + port, wsOptions)
}

function keyPairFromSeed (seed) {
  var publicKey = Buffer.alloc(sodium.crypto_sign_PUBLICKEYBYTES)
  var secretKey = Buffer.alloc(sodium.crypto_sign_SECRETKEYBYTES)
  sodium.crypto_sign_seed_keypair(publicKey, secretKey, seed)
  return {secretKey, publicKey}
}

function makeReplicationProtocol (options) {
  var transport = options.plex.createSharedStream(options.discoveryKey)
  var protocolStream = protocol.Replication({
    encryptionKey: options.replicationKey,
    publicKey: options.publicKey,
    secretKey: options.secretKey
  })
  connect(protocolStream, transport)
  return protocolStream
}

tape('replicate unknown project', function (test) {
  server(function (port, done) {
    // Project
    var replicationKey = makeRandom(32)
    var discoveryKey = hash(replicationKey).toString('hex')
    var writeSeed = makeRandom(32)
    var writeKeyPair = keyPairFromSeed(writeSeed)

    var ws = makeWebsocket(port)
      .once('close', function () {
        test.pass('ws closed')
        plex.destroy()
      })
    var plex = multiplex()
    var transport = plex.createSharedStream(discoveryKey)
    var replication = protocol.Replication({
      encryptionKey: replicationKey,
      publicKey: writeKeyPair.publicKey,
      secretKey: writeKeyPair.secretKey
    })
    connect(replication, transport)
    replication.handshake(function (error) {
      test.ifError(error, 'no handshake error')
    })
    transport.once('error', function (error) {
      test.assert(
        /destroyed/i.test(error.message),
        'destroyed'
      )
      replication.destroy()
      ws.destroy()
      test.end()
      done()
    })
    connect(plex, ws)
  })
})

tape('invitations across websockets', function (test) {
  server(function (port, done) {
    // User
    var email = 'test@example.com'
    var keyPair = makeKeyPair()
    var title = 'test project'

    // Project
    var replicationKey = makeRandom(32)
    var discoveryKey = hash(replicationKey).toString('hex')
    var writeSeed = makeRandom(32)
    var writeKeyPair = keyPairFromSeed(writeSeed)

    runSeries([
      createSubscription,
      // Connect a WebSocket client that expects to try and fail
      // to replicate the project, then receives an offer to
      // successfully replicate the same project.
      connectAndAwaitReplication,
      // Connect a WebSocket client that sends the invitation
      // that enables to server to replicate the project.
      connectAndInvite
    ])

    function createSubscription (done) {
      subscribe({keyPair, email, port}, function (message) {
        confirmSubscribe(message, port, null, done)
      })
    }

    function connectAndAwaitReplication (done) {
      var ws = makeWebsocket(port)
      var plex = multiplex()
      makeInvitationProtocol(plex)
      var firstReplicationTransport = duplexify(
        plex.createStream(discoveryKey),
        plex.receiveStream(discoveryKey)
      )
      var firstReplication = protocol.Replication({
        encryptionKey: replicationKey,
        publicKey: writeKeyPair.publicKey,
        secretKey: writeKeyPair.secretKey
      })
      plex.once('stream', function (receiveStream, id) {
        test.equal(
          discoveryKey, id,
          'offered replication'
        )
        var secondReplicationTransport = duplexify(
          plex.createStream(discoveryKey),
          receiveStream
        )
        var secondReplication = protocol.Replication({
          encryptionKey: replicationKey,
          publicKey: writeKeyPair.publicKey,
          secretKey: writeKeyPair.secretKey
        })
        secondReplication.handshake(function (error) {
          test.ifError(error, 'no second handshake error')
        })
        secondReplication.once('handshake', function () {
          test.pass('received second handshake')
          ws.destroy()
          finish()
        })
        connect(secondReplication, secondReplicationTransport)
      })
      firstReplication.handshake(function (error) {
        test.ifError(error, 'no handshake error')
      })
      firstReplicationTransport.once('error', function (error) {
        test.assert(
          /destroyed/i.test(error.message),
          'destroyed'
        )
        done()
      })
      connect(firstReplication, firstReplicationTransport)
      connect(plex, ws)
    }

    function connectAndInvite (done) {
      var ws = makeWebsocket(port)
      var plex = multiplex()
      connect(plex, ws)
      var invitation = makeInvitationProtocol(plex)
      var invite = makeInvitation(keyPair, {replicationKey, writeSeed, title})
      invitation.invitation(invite, function (error) {
        test.ifError(error, 'no send invitation error')
        test.pass('sent invitation')
        setTimeout(function () {
          ws.destroy()
          done()
        }, 100)
      })
    }

    function finish () {
      test.end()
      done()
    }
  })
})
