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
    var sharedStreams = new Map()

    // Invitation
    var invitationTransport = plex.createSharedStream('invitation')
    var invitationStream = protocol.Invitation()

    invitationStream.on('invitation', function (envelope) {
      var publicKey = envelope.publicKey
      var secretKey = envelope.message.secretKey
      log.info({publicKey, secretKey}, 'invited')
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
          log.info('done')
        })
      })
    })

    invitationStream.on('request', function (envelope) {
      var publicKey = envelope.publicKey
      ensureActiveSubscription(publicKey, function (error, email, subscription) {
        if (error) return log.error(error)
        if (!subscription) return log.info('no active subscription')
        log.info({publicKey}, 'requested')
        s3.listUserProjects(email, function (error, discoveryKeys) {
          if (error) return log.error(error)
          discoveryKeys.forEach(function (discoveryKey) {
            s3.getProjectSecretKey(discoveryKeys, function (error, secretKey) {
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
              invitationStream.invitation(invitation, function (error) {
                if (error) return log.error(error)
                log.info({discoveryKey}, 'invited')
              })
            })
          })
        })
      })
    })

    invitationStream.handshake(function (error) {
      if (error) return log.error(error)
      log.info('handshake')
    })

    invitationStream
      .pipe(invitationTransport)
      .pipe(invitationStream)

    // Replication
    plex.on('stream', function (sharedStream, discoveryKey) {
      s3.getProjectSecretKey(discoveryKey, function (error, secretKey) {
        if (error) {
          log.error({discoveryKey}, error)
          return sharedStream.destroy()
        }
        if (!secretKey) {
          return sharedStream.destroy()
        }
        log.info({discoveryKey}, 'replicating')
        var replicationStream = makeReplicationStream({
          secretKey, discoveryKey, log, s3
        })
        var record = {sharedStream, replicationStream}
        sharedStreams.set(discoveryKey, record)
        replicationStream
          .pipe(sharedStream)
          .pipe(replicationStream)
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

function makeReplicationStream (options) {
  assert.equal(typeof options.secretKey, 'string')
  assert.equal(typeof options.discoveryKey, 'string')
  assert(options.log)
  assert(options.s3)
  var secretKey = options.secretKey
  var discoveryKey = options.discoveryKey
  var log = options.log

  var returned = new protocol.Replication(secretKey)
  var requestedFromPeer = []

  returned.once('handshake', function (callback) {
    s3.listProjectPublicKeys(discoveryKey, function (error, publicKeys) {
      if (error) return callback(error)
      runParallel(publicKeys.map(function (publicKey) {
        return function (done) {
          s3.getLastIndex(discoveryKey, publicKey, function (error, index) {
            if (error) {
              log.error(error)
              return done()
            }
            var offer = {publicKey, index}
            var requestIndex = requestedFromPeer
              .findIndex(function (request) {
                return (
                  request.publicKey === offer.publicKey &&
                  request.index === offer.index
                )
              })
            if (requestIndex !== -1) {
              requestedFromPeer.splice(requestIndex, 1)
              return done()
            }
            protocol.offer(offer, done)
          })
        }
      }), callback)
    })
  })

  // When our peer requests an envelope...
  returned.on('request', function (request, callback) {
    var publicKey = request.publicKey
    var index = request.index
    s3.getEnvelope(
      discoveryKey, publicKey, index,
      function (error, envelope) {
        if (error) return log.error(error)
        returned.envelope(envelope, callback)
      }
    )
  })

  // When our peer offers an envelope...
  returned.on('offer', function (offer, callback) {
    var publicKey = offer.publicKey
    var offeredIndex = offer.index
    s3.getLastIndex(discoveryKey, publicKey, function (error, last) {
      if (error) return log.error(error)
      if (last === undefined) last = -1
      var index = last + 1
      requestNextEnvelope()
      function requestNextEnvelope () {
        if (index > offeredIndex) return callback()
        protocol.request({publicKey, index}, function (error) {
          if (error) return callback(error)
          requestedFromPeer.push({publicKey, index})
          index++
          requestNextEnvelope()
        })
      }
    })
  })

  // When our peer sends an envelope...
  returned.on('envelope', function (envelope, callback) {
    if (envelope.messsage.project !== discoveryKey) {
      log.error({envelope, discoveryKey}, 'project mismatch')
      return callback()
    }
    s3.putEnvelope(envelope, callback)
  })

  returned.handshake(function () {
    log.info('sent handshake')
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
