var assert = require('assert')
var data = require('./data')
var multiplex = require('multiplex')
var protocol = require('proseline-protocol')
var runParallel = require('run-parallel')
var sodium = require('sodium-native')
var stripe = require('./stripe')
var uuid = require('uuid')

module.exports = function (configuration) {
  var s3 = configuration.s3
  return function (socket) {
    var log = configuration.log.child({request: uuid.v4()})
    log.info('connection')
    var plex = multiplex()
    var sharedStreams = new Map()

    // Invitation
    var discoveryKeysStream = plex.createSharedStream('discoveryKeys')
    var invitationStream = protocol.Invitation()
    invitationStream.on('invitation', function (envelope) {
      var publicKey = envelope.publicKey
      var secretKey = envelope.message.secretKey
      data.getPublicKey(s3, publicKey, function (error, record) {
        if (error) return log.error(error)
        var email = record.email
        data.getUser(s3, email, function (error, user) {
          if (error) return log.error(error)
          stripe.getActiveSubscription(
            configuration, user.customerID,
            function (error, subscription) {
              if (error) return log.error(error)
              if (!subscription) return log.info({user}, 'no active subscription')
              var discoveryKey = hashHexString(secretKey)
              runParallel([
                function (done) {
                  data.putProjectSecretKey(s3, discoveryKey, secretKey, done)
                },
                function (done) {
                  data.putProjectUser(s3, discoveryKey, email, done)
                },
                function (done) {
                  data.putUserProject(s3, discoveryKey, publicKey, done)
                }
              ])
            }
          )
        })
      })
    })
    invitationStream
      .pipe(discoveryKeysStream)
      .pipe(invitationStream)

    // Replication
    plex.on('stream', function (sharedStream, discoveryKey) {
      data.getProjectSecretKey(discoveryKey, function (error, secretKey) {
        if (error) {
          log.error({discoveryKey}, error)
          return sharedStream.destroy()
        }
        if (!secretKey) {
          return sharedStream.destroy()
        }
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
  }
}

function makeReplicationStream (options) {
  assert.equal(typeof options.secretKey, 'string')
  assert.equal(typeof options.discoveryKey, 'string')
  assert(options.log)
  assert(options.s3)
  var secretKey = options.secretKey
  var discoveryKey = options.discoveryKey
  var log = options.log
  var s3 = options.s3

  var returned = new protocol.Replication(secretKey)
  var requestedFromPeer = []

  returned.once('handshake', function (callback) {
    data.listProjectPublicKeys(s3, discoveryKey, function (error, publicKeys) {
      if (error) return callback(error)
      runParallel(publicKeys.map(function (publicKey) {
        return function (done) {
          data.getLastIndex(discoveryKey, publicKey, function (error, index) {
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
    data.getEnvelope(
      s3, discoveryKey, publicKey, index,
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
    data.getLastIndex(s3, discoveryKey, publicKey, function (error, last) {
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
    data.putEnvelope(s3, envelope, callback)
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
