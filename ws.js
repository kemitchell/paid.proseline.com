var assert = require('assert')
var async = require('async')
var duplexify = require('duplexify')
var multiplex = require('multiplex')
var protocol = require('proseline-protocol')
var runParallel = require('run-parallel')
var s3 = require('./s3')
var sodium = require('sodium-native')
var stringify = require('fast-json-stable-stringify')
var stripe = require('./stripe')
var uuid = require('uuid')

var INVITATION_STREAM_NAME = 'invitation'

module.exports = function (serverLog) {
  return function (socket, request) {
    var log = serverLog.child({socket: uuid.v4()})
    log.info({
      ip: request.connection.remoteAddress,
      headers: request.headers
    }, 'connection')

    var plex = multiplex()
      .on('error', function (error) {
        log.error(error)
      })
    var streams = new Map()

    // Invitation Stream
    var invitationTransport = plex.createSharedStream(INVITATION_STREAM_NAME)
    streams.set(INVITATION_STREAM_NAME, invitationTransport)
    var invitationProtocol = makeInvitationStream({
      log: log.child({protocol: 'invitation'})
    })
    connect(invitationTransport, invitationProtocol)
    invitationTransport.once('close', function () {
      invitationProtocol.destroy()
      streams.delete(INVITATION_STREAM_NAME)
    })

    // Replication Streams
    plex.on('stream', function (receiveStream, discoveryKey) {
      var childLog = log.child({protocol: 'replication', discoveryKey})
      var replicationTransport = duplexify(
        plex.createStream(discoveryKey),
        receiveStream
      )
      streams.set(discoveryKey, replicationTransport)
      s3.getProjectKeys(discoveryKey, function (error, keys) {
        if (error) {
          childLog.error(error)
          return destroy()
        }
        if (!keys) return destroy()
        var replicationKey = keys.replicationKey
        var writeSeed = keys.writeSeed
        childLog.info('replicating')
        var replicationProtocol = makeReplicationStream({
          replicationKey, discoveryKey, writeSeed, log: childLog
        })
        replicationProtocol
          .on('error', function (error) {
            childLog.error(error)
          })
          .once('close', function () {
            destroy()
          })
        replicationTransport
          .on('error', function (error) {
            childLog.error(error)
          })
          .once('close', function () {
            destroy()
          })
        replicationProtocol.pipe(replicationTransport).pipe(replicationProtocol)
        function destroy () {
          childLog.info('destroying')
          if (replicationProtocol) replicationProtocol.destroy()
          if (replicationTransport) replicationTransport.destroy()
          streams.delete(discoveryKey)
        }
      })
    })

    connect(plex, socket)
  }
}

function connect (a, b) {
  a.pipe(b).pipe(a)
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
    var replicationKey = envelope.message.replicationKey
    log.info({publicKey, replicationKey}, 'received invitation')
    var writeSeed = envelope.message.writeSeed
    if (!writeSeed) return log.info('no write seed')
    ensureActiveSubscription(publicKey, function (error, email, subscription) {
      if (error) return log.error(error)
      if (!subscription) return log.info('no active subscription')
      var discoveryKey = hashHexString(replicationKey)
      log.info({discoveryKey}, 'putting')
      runParallel([
        function (done) {
          s3.putProjectKeys(discoveryKey, replicationKey, writeSeed, done)
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
          s3.getProjectKeys(discoveryKey, function (error, keys) {
            if (error) return log.error(error)
            var invitation = {
              message: {replicationKey: keys.replicationKey, writeSeed: keys.writeSeed},
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
  assert.equal(typeof options.replicationKey, 'string')
  assert.equal(typeof options.discoveryKey, 'string')
  assert.equal(typeof options.writeSeed, 'string')
  assert(options.log)
  var replicationKey = options.replicationKey
  var discoveryKey = options.discoveryKey
  var writeSeed = options.writeSeed
  var log = options.log.child({discoveryKey})

  var returned = new protocol.Replication({
    encryptionKey: Buffer.from(replicationKey, 'hex'),
    seed: Buffer.from(writeSeed, 'hex')
  })

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
          if (index === undefined) {
            return log.error({discoveryKey, publicKey}, 'no envelopes')
          }
          var offer = {publicKey, index}
          log.info(offer, 'last index')
          log.info(offer, 'sending offer')
          returned.offer(offer, function (error) {
            if (error) return log.error(error)
            log.info(offer, 'sent offer')
          })
        })
      })
    })
  })

  // When our peer requests an envelope...
  var requestQueue = async.queue(function (request, done) {
    var publicKey = request.publicKey
    var index = request.index
    s3.getEnvelope(
      discoveryKey, publicKey, index,
      function (error, envelope) {
        if (error) return done(error)
        if (!envelope) return done()
        log.info(request, 'sending envelope')
        returned.envelope(envelope, function (error) {
          if (error) return done(error)
          log.info(request, 'sent envelope')
          done()
        })
      }
    )
  }, 1)

  returned.on('request', function (request) {
    log.info(request, 'received request')
    requestQueue.push(request, function (error) {
      if (error) log.error(error)
    })
  })

  // When our peer offers an envelope...
  returned.on('offer', function (offer) {
    log.info(offer, 'received offer')
    var publicKey = offer.publicKey
    var offeredIndex = offer.index
    s3.getLastIndex(discoveryKey, publicKey, function (error, last) {
      if (error) return log.error(error)
      if (last === undefined) last = -1
      log.info({publicKey, last}, 'last index')
      for (var index = last + 1; index <= offeredIndex; index++) {
        var pair = {publicKey, index}
        log.info(pair, 'sending request')
        returned.request(pair, function (error) {
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
    if (envelope.message.project !== discoveryKey) {
      return log.error(pair, 'project mismatch')
    }
    log.info(pair, 'putting envelope')
    if (index === 0) {
      s3.putProjectPublicKey(
        discoveryKey, publicKey,
        function (error) {
          if (error) return log.error(error)
          log.info({discoveryKey, publicKey}, 'put public key')
        }
      )
    }
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
