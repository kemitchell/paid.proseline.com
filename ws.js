var assert = require('assert')
var multiplex = require('multiplex')
var protocol = require('proseline-protocol')
var runParallel = require('run-parallel')
var s3 = require('./s3')
var sodium = require('sodium-native')
var stringify = require('fast-json-stable-stringify')
var stripe = require('./stripe')
var uuid = require('uuid')

module.exports = function (serverLog) {
  return function (socket, request) {
    var log = serverLog.child({socket: uuid.v4()})
    log.info('connection')
    var plex = multiplex()

    // Invitation Stream
    var invitationTransport = plex.createSharedStream('invitation')
    var invitationProtocol = makeInvitationStream({
      log: log.child({protocol: 'invitation'})
    })
    invitationProtocol.pipe(invitationTransport).pipe(invitationProtocol)
    invitationTransport.once('close', function () {
      invitationProtocol.destroy()
    })

    // Replication Streams
    plex.on('stream', function (replicationTransport, discoveryKey) {
      s3.getProjectSecretKey(discoveryKey, function (error, secretKey) {
        if (error) {
          log.error({discoveryKey}, error)
          log.info('destroying')
          return replicationTransport.destroy()
        }
        if (!secretKey) {
          log.info('destroying')
          return replicationTransport.destroy()
        }
        var childLog = log.child({protocol: 'replication', discoveryKey})
        childLog.info({discoveryKey}, 'replicating')
        var replicationProtocol = makeReplicationStream({
          secretKey, discoveryKey, log: childLog
        })
        replicationProtocol.pipe(replicationTransport).pipe(replicationProtocol)
        replicationTransport.once('close', function () {
          replicationProtocol.destroy()
        })
      })
    })

    plex.pipe(socket).pipe(plex)
  }
}

function ensureActiveSubscription (publicKey, callback) {
  s3.getPublicKey(publicKey, function (error, record) {
    if (error) return callback(error)
    if (!record) return callback()
    var email = record.email
    s3.getUser(email, function (error, user) {
      if (error) return callback(error)
      if (!user) return callback()
      stripe.getActiveSubscription(
        user.customerID,
        function (error, subscription) {
          if (error) return callback(error)
          callback(null, email, subscription)
        }
      )
    })
  })
}

function makeInvitationStream (options) {
  assert.equal(typeof options, 'object')
  assert(options.log)
  var log = options.log
  var returned = new protocol.Invitation()

  returned.on('invitation', function (envelope) {
    var publicKey = envelope.publicKey
    var secretKey = envelope.message.secretKey
    log.info({publicKey, secretKey}, 'received invitation')
    ensureActiveSubscription(publicKey, function (error, email, subscription) {
      if (error) return log.error(error)
      if (!subscription) return log.info('no active subscription')
      var discoveryKey = hashHexString(secretKey)
      log.info({discoveryKey}, 'putting')
      runParallel([
        function (done) {
          s3.putProjectSecretKey(discoveryKey, secretKey, done)
        },
        function (done) {
          s3.putProjectUser(discoveryKey, email, done)
        },
        function (done) {
          s3.putUserProject(email, discoveryKey, done)
        }
      ], function (error) {
        if (error) return log.error(error)
      })
    })
  })

  returned.on('request', function (envelope) {
    var publicKey = envelope.publicKey
    log.info({publicKey}, 'received request')
    ensureActiveSubscription(publicKey, function (error, email, subscription) {
      if (error) return log.error(error)
      if (!subscription) return log.info('no active subscription')
      s3.listUserProjects(email, function (error, discoveryKeys) {
        if (error) return log.error(error)
        discoveryKeys.forEach(function (discoveryKey) {
          s3.getProjectSecretKey(discoveryKey, function (error, secretKey) {
            if (error) return log.error(error)
            var invitation = {
              message: {secretKey},
              publicKey: process.env.PUBLIC_KEY
            }
            var signature = Buffer.alloc(sodium.crypto_sign_BYTES)
            sodium.crypto_sign_detached(
              signature,
              Buffer.from(stringify(invitation.message), 'utf8'),
              Buffer.from(process.env.SECRET_KEY, 'hex')
            )
            invitation.signature = signature.toString('hex')
            returned.invitation(invitation, function (error) {
              if (error) return log.error(error)
              log.info({discoveryKey}, 'sent invitation')
            })
          })
        })
      })
    })
  })

  returned.on('invalid', function (message) {
    log.error({message}, 'invalid')
  })

  returned.handshake(function (error) {
    if (error) return log.error(error)
    log.info('sent handshake')
  })

  return returned
}

function makeReplicationStream (options) {
  assert.equal(typeof options, 'object')
  assert.equal(typeof options.secretKey, 'string')
  assert.equal(typeof options.discoveryKey, 'string')
  assert(options.log)
  var secretKey = options.secretKey
  var discoveryKey = options.discoveryKey
  var log = options.log.child({discoveryKey})

  var returned = new protocol.Replication(secretKey)

  returned.once('handshake', function () {
    log.info('received handshake')
    log.info('sending handshake')
    returned.handshake(function (error) {
      if (error) return log.error(error)
      log.info('sent handshake')
    })
    s3.listProjectPublicKeys(discoveryKey, function (error, publicKeys) {
      if (error) return log.error(error)
      log.info({publicKeys}, 'public keys')
      publicKeys.forEach(function (publicKey) {
        s3.getLastIndex(discoveryKey, publicKey, function (error, index) {
          if (error) return log.error(error)
          var offer = {publicKey, index}
          log.info(offer, 'last index')
          log.info(offer, 'sending offer')
          protocol.offer(offer, function (error) {
            if (error) return log.error(error)
            log.info(offer, 'sent offer')
          })
        })
      })
    })
  })

  // When our peer requests an envelope...
  returned.on('request', function (request) {
    var publicKey = request.publicKey
    var index = request.index
    var pair = {publicKey, index}
    log.info(pair, 'received request')
    s3.getEnvelope(
      discoveryKey, publicKey, index,
      function (error, envelope) {
        if (error) return log.error(error)
        if (!envelope) return
        log.info(pair, 'sending envelope')
        returned.envelope(envelope, function (error) {
          if (error) return log.error(error)
          log.info(pair, 'sent envelope')
        })
      }
    )
  })

  // When our peer offers an envelope...
  returned.on('offer', function (offer) {
    log.info(offer, 'received offer')
    var publicKey = offer.publicKey
    var offeredIndex = offer.index
    s3.getLastIndex(discoveryKey, publicKey, function (error, last) {
      if (error) return log.error(error)
      for (var index = last + 1; index <= offeredIndex; index++) {
        var pair = {publicKey, index}
        log.info(pair, 'sending request')
        protocol.request(pair, function (error) {
          if (error) return log.error(error)
          log.info(pair, 'sent request')
        })
      }
    })
  })

  // When our peer sends an envelope...
  returned.on('envelope', function (envelope) {
    var publicKey = envelope.publicKey
    var index = envelope.message.index
    var pair = {publicKey, index}
    log.info(pair, 'received envelope')
    if (envelope.messsage.project !== discoveryKey) {
      return log.error(pair, 'project mismatch')
    }
    log.info(pair, 'putting envelope')
    s3.putEnvelope(envelope, function (error) {
      if (error) return log.error(error)
      log.info(pair, 'put envelope')
    })
  })

  returned.on('invalid', function (message) {
    log.error({message}, 'invalid')
  })

  return returned
}

function hashHexString (hex) {
  assert(typeof hex === 'string')
  assert(hex.length > 0)
  var digest = Buffer.alloc(sodium.crypto_generichash_BYTES)
  sodium.crypto_generichash(digest, Buffer.from(hex, 'hex'))
  return digest.toString('hex')
}
