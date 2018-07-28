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

var wsOptions = {perMessageDeflate: false}

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
        var firstWS = makeWebsocket()
        var firstPlex = multiplex()
        var firstProtocol = makeInvitationProtocol(firstPlex)
        var invitation = makeInvitation(keyPair, {
          replicationKey, writeSeed, title
        })
        connect(firstPlex, firstWS)
        firstProtocol.invitation(invitation, function (error) {
          test.ifError(error, 'no send invitation error')
          test.pass('sent invitation')
          var secondWS = makeWebsocket()
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

    function makeWebsocket () {
      return testErrors(websocketStream('ws://localhost:' + port, wsOptions))
    }
  })

  function makeInvitationProtocol (plex) {
    var transport = testErrors(plex.createSharedStream('invitation'))
    var protocolStream = testErrors(protocol.Invitation())
    connect(protocolStream, transport)
    return protocolStream
  }

  function connect (a, b) {
    a.pipe(b).pipe(a)
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
