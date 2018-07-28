var confirmSubscribe = require('./confirm-subscribe')
var makeKeyPair = require('./make-key-pair')
var multiplex = require('multiplex')
var protocol = require('proseline-protocol')
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
            /*
            test.equal(
              message.title, title,
              'received title'
            )
            */
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

  function makeInvitationProtocol (plex) {
    var transport = testErrors(plex.createSharedStream('invitation'))
    var protocolStream = testErrors(protocol.Invitation())
    connect(protocolStream, transport)
    return protocolStream
  }

  function testErrors (stream) {
    stream.once('error', function (error) {
      test.ifError(error, 'no stream error')
    })
    return stream
  }
})

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

tape('Replication', function (test) {
  server(function (port, done) {
    var keyPair = makeKeyPair()
    var email = 'test@example.com'
    subscribe({keyPair, email, port}, function (subscribeMessage) {
      confirmSubscribe(subscribeMessage, port, null, function () {
        var replicationKey = makeRandom(32)
        var discoveryKey = hash(replicationKey).toString('hex')
        var writeSeed = makeRandom(32)
        var writeKeyPair = keyPairFromSeed(writeSeed)
        var title = 'test project'
        var firstWS = makeWebsocket(port)
        var plex = multiplex()

        var invitationTransport = plex.createSharedStream('invitation')
        var invitationProtocol = new protocol.Invitation()
        connect(invitationProtocol, invitationTransport)

        var invitation = makeInvitation(keyPair, {
          replicationKey, writeSeed, title
        })
        invitationProtocol.invitation(invitation, function (error) {
          test.ifError(error, 'no send invitation error')
          setTimeout(function () {
            var replicationTransport = plex.createSharedStream(discoveryKey)
            var replicationProtocol = new protocol.Replication({
              encryptionKey: replicationKey,
              publicKey: writeKeyPair.publicKey,
              secretKey: writeKeyPair.secretKey
            })
            replicationProtocol.handshake(function (error) {
              test.ifError(error, 'no error sending handshake')
            })
            replicationProtocol.once('handshake', function () {
              var publicKey = keyPair.publicKey.toString('hex')
              var index = 0
              replicationProtocol.offer({publicKey, index}, function (error) {
                test.ifError(error, 'no error sending offer')
              })
              replicationProtocol.once('request', function (request) {
                test.equal(
                  request.publicKey, publicKey,
                  'requests public key'
                )
                test.equal(
                  request.index, index,
                  'requests index'
                )
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
                replicationProtocol.envelope(envelope, function (error) {
                  test.ifError(error, 'no error sending envelope')
                  setTimeout(function () {
                    firstWS.destroy()
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
                          'offers public key'
                        )
                        test.equal(
                          offer.index, index,
                          'offers index'
                        )
                        replication.once('envelope', function (received) {
                          test.deepEqual(
                            received, envelope,
                            'received envelope'
                          )
                          secondWS.destroy()
                          test.end()
                          done()
                        })
                        replication.request(offer, function (error) {
                          test.ifError(error, 'no error requesting envelope')
                        })
                      })
                    })
                    connect(plex, secondWS)
                  }, 100)
                })
              })
            })
            connect(replicationProtocol, replicationTransport)
          }, 100)
        })

        connect(plex, firstWS)
      })
    })
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
