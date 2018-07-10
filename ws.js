var assert = require('assert')
var indices = require('./indices')
var multiplex = require('multiplex')
var parse = require('json-parse-errback')
var protocol = require('proseline-protocol')
var runParallel = require('run-parallel')
var runWaterfall = require('run-waterfall')
var sodium = require('sodium-native')
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
      getPublicKey(s3, publicKey, function (error, record) {
        if (error) return log.error(error)
        var userID = record.userID
        getUser(s3, userID, function (error, user) {
          if (error) return log.error(error)
          if (!user.active) return log.info({user}, 'inactive user')
          var discoveryKey = hashHexString(secretKey)
          runParallel([
            function (done) {
              putProjectSecretKey(s3, discoveryKey, secretKey, done)
            },
            function (done) {
              putProjectUser(s3, discoveryKey, userID, done)
            },
            function (done) {
              putUserProject(s3, discoveryKey, publicKey, done)
            }
          ])
        })
      })
    })
    invitationStream
      .pipe(discoveryKeysStream)
      .pipe(invitationStream)

    // Replication
    plex.on('stream', function (sharedStream, discoveryKey) {
      getProjectSecretKey(discoveryKey, function (error, secretKey) {
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
    listProjectPublicKeys(s3, discoveryKey, function (error, publicKeys) {
      if (error) return callback(error)
      runParallel(publicKeys.map(function (publicKey) {
        return function (done) {
          getLastIndex(discoveryKey, publicKey, function (error, index) {
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
    getEnvelope(
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
    getLastIndex(s3, discoveryKey, publicKey, function (error, last) {
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
    putEnvelope(s3, envelope, callback)
  })

  returned.handshake(function () {
    log.info('sent handshake')
  })

  return returned
}

var DELIMITER = '/'

function projectKey (discoveryKey) {
  return `projects/${discoveryKey}`
}

function listProjectPublicKeys (s3, discoveryKey, callback) {
  var prefix = `${projectKey(discoveryKey)}/publicKeys/`
  recurse(false, callback)
  function recurse (marker, done) {
    var options = {Delimiter: DELIMITER, Prefix: prefix}
    if (marker) options.Marker = marker
    s3.listObjects(options, function (error, data) {
      if (error) return callback(error)
      var contents = data.Contents.map(function (element) {
        return element.Key.split(DELIMITER)[3]
      })
      if (data.IsTruncated) {
        return recurse(data.NextMarker, function (error, after) {
          if (error) return done(error)
          done(null, contents.concat(after))
        })
      }
      done(null, contents)
    })
  }
}

function envelopeKey (discoveryKey, publicKey, index) {
  return (
    `${projectKey(discoveryKey)}` +
    `/envelopes/${publicKey}/${indices.stringify(index)}`
  )
}

function getLastIndex (s3, discoveryKey, publicKey, callback) {
  s3.listObjects({
    Delimiter: DELIMITER,
    Prefix: `${projectKey(discoveryKey)}/envelopes/${publicKey}/`,
    MaxKeys: 1
  }, function (error, data) {
    if (error) return callback(error)
    var contents = data.Contents
    if (contents.length === 0) return callback(null, undefined)
    var key = contents[0].split(DELIMITER)[4]
    callback(null, indices.parse(key))
  })
}

function getEnvelope (s3, discoveryKey, publicKey, index, callback) {
  getJSONObject(
    s3, envelopeKey(discoveryKey, publicKey, index), callback
  )
}

var ServerSideEncryption = 'AES256'

function putEnvelope (s3, envelope, callback) {
  putJSONObject(
    s3,
    envelopeKey(
      envelope.message.project,
      envelope.publicKey,
      envelope.message.index
    ),
    envelope,
    callback
  )
}

function projectSecretKeyKey (discoveryKey) {
  return `${projectKey(discoveryKey)}/secretKey`
}

function getProjectSecretKey (s3, discoveryKey, callback) {
  getJSONObject(s3, projectSecretKeyKey(discoveryKey), callback)
}

function putProjectSecretKey (s3, discoveryKey, secretKey, callback) {
  putJSONObject(
    s3, projectSecretKeyKey(discoveryKey), secretKey, callback
  )
}

function projectUserKey (discoveryKey, userID) {
  return `${projectKey(discoveryKey)}/users/${userID}`
}

function putProjectUser (s3, discoveryKey, userID, callback) {
  putJSONObject(
    s3,
    projectUserKey(discoveryKey, userID),
    {date: new Date().toISOString()},
    callback
  )
}

function userProjectKey (s3, discoveryKey, userID) {
  return `${userKey(userID)}/projects/${discoveryKey}`
}

function putUserProject (s3, discoveryKey, userID, callback) {
  putJSONObject(
    s3,
    userProjectKey(discoveryKey, userID),
    {date: new Date().toISOString()},
    callback
  )
}

function publicKeyKey (publicKey) {
  return `/publicKeys/${publicKey}`
}

function getPublicKey (s3, publicKey, callback) {
  getJSONObject(s3, publicKeyKey(publicKey), callback)
}

function userKey (userID) {
  return `users/${userID}`
}

function getUser (s3, userID, callback) {
  getJSONObject(s3, userKey(userID), callback)
}

function hashHexString (hex) {
  assert(typeof hex === 'string')
  assert(hex.length > 0)
  var digest = Buffer.alloc(sodium.crypto_generichash_BYTES)
  sodium.crypto_generichash(digest, Buffer.from(hex, 'hex'))
  return digest.toString('hex')
}

function getJSONObject (s3, key, callback) {
  assert(s3)
  assert.equal(typeof key, 'string')
  assert.equal(typeof callback, 'function')
  runWaterfall([
    function (done) {
      s3.getObject({Key: key}, function (error, data) {
        if (error) return done(error)
        done(null, data.Body)
      })
    },
    parse
  ], callback)
}

function putJSONObject (s3, key, value, callback) {
  assert(s3)
  assert.equal(typeof key, 'string')
  assert(value)
  assert.equal(typeof callback, 'function')
  s3.putObject({
    Key: key,
    Body: Buffer.from(JSON.stringify(value)),
    ContentType: 'application/json',
    ServerSideEncryption
  }, function (error) {
    if (error) return callback(error)
    callback()
  })
}
