var assert = require('assert')
var async = require('async')
var data = require('./data')
var duplexify = require('duplexify')
var events = require('./events')
var multiplex = require('multiplex')
var protocol = require('proseline-protocol')
var runParallel = require('run-parallel')
var sodium = require('sodium-native')
var stringify = require('fast-json-stable-stringify')
var stripe = require('./stripe')
var uuid = require('uuid')

var INVITATION_STREAM_NAME = 'invitation'

module.exports = function (serverLog) {
  return function (socket, request) {
    var log = serverLog.child({ socket: uuid.v4() })
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
      log: log.child({ protocol: 'invitation' })
    })
    connect(invitationTransport, invitationProtocol)
    invitationTransport.once('close', function () {
      invitationProtocol.destroy()
      streams.delete(INVITATION_STREAM_NAME)
    })

    // Unknown Projects
    var unknownProjects = new Set()

    function addUnknownProject (projectDiscoveryKey) {
      log.info({ projectDiscoveryKey }, 'adding unknown')
      if (unknownProjects.has(projectDiscoveryKey)) return
      unknownProjects.add(projectDiscoveryKey)
      var eventName = `invitation:${projectDiscoveryKey}`
      events.addListener(eventName, onUnknownProject)
    }

    function removeUnknownProject (projectDiscoveryKey) {
      unknownProjects.delete(projectDiscoveryKey)
      var eventName = `invitation:${projectDiscoveryKey}`
      events.removeListener(eventName, onUnknownProject)
    }

    function onUnknownProject (data) {
      var projectDiscoveryKey = data.projectDiscoveryKey
      log.info({ projectDiscoveryKey }, 'invited to unknown')
      replicateProject({ projectDiscoveryKey })
    }

    function removeUnknownProjectListeners () {
      Array.from(unknownProjects).forEach(function (projectDiscoveryKey) {
        var eventName = `project:${projectDiscoveryKey}`
        events.removeListener(eventName, onUnknownProject)
      })
    }

    // Replication Streams
    plex.on('stream', function (receiveStream, projectDiscoveryKey) {
      var transport = duplexify(
        plex.createStream(projectDiscoveryKey),
        receiveStream
      )
      replicateProject({ projectDiscoveryKey, transport })
    })

    function replicateProject (options) {
      var projectDiscoveryKey = options.projectDiscoveryKey
      var transport = options.transport
      if (!transport) {
        // Create and duplexify send and receive streams to avoid
        // createSharedStream, which creates lazy send streams.
        transport = duplexify(
          plex.createStream(projectDiscoveryKey),
          plex.receiveStream(projectDiscoveryKey)
        )
      }
      var childLog = log.child({ protocol: 'replication', projectDiscoveryKey })
      streams.set(projectDiscoveryKey, transport)
      data.getProjectKeys(projectDiscoveryKey, function (error, keys) {
        if (error) {
          childLog.error(error)
          return destroy()
        }
        if (!keys) {
          addUnknownProject(projectDiscoveryKey)
          return destroy()
        }
        removeUnknownProject(projectDiscoveryKey)
        var replicationKey = keys.replicationKey
        var writeSeed = keys.writeSeed
        childLog.info('replicating')
        var replicationProtocol = makeReplicationStream({
          replicationKey, projectDiscoveryKey, writeSeed, log: childLog
        })
        replicationProtocol
          .on('error', function (error) {
            childLog.error(error)
          })
          .once('close', function () {
            destroy()
          })
        transport
          .on('error', function (error) {
            childLog.error(error)
          })
          .once('close', function () {
            destroy()
          })
        replicationProtocol.pipe(transport).pipe(replicationProtocol)
        function destroy () {
          childLog.info('destroying')
          if (replicationProtocol) replicationProtocol.destroy()
          transport.destroy()
          streams.delete(projectDiscoveryKey)
        }
      })
    }

    socket.once('close', function () {
      removeUnknownProjectListeners()
      invitationTransport.destroy()
      Array.from(streams.values()).forEach(function (stream) {
        stream.destroy()
      })
      plex.destroy()
    })

    connect(plex, socket)
  }
}

function connect (a, b) {
  a.pipe(b).pipe(a)
}

function ensureActiveSubscription (publicKey, callback) {
  data.getPublicKey(publicKey, function (error, record) {
    if (error) return callback(error)
    if (!record) return callback()
    var email = record.email
    data.getUser(email, function (error, user) {
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
  assert.strictEqual(typeof options, 'object')
  assert(options.log)
  var log = options.log
  var returned = new protocol.Invitation()

  returned.on('invitation', function (envelope) {
    var publicKey = envelope.publicKey
    var replicationKey = envelope.message.replicationKey
    log.info({ publicKey, replicationKey }, 'received invitation')
    var writeSeed = envelope.message.writeSeed
    if (!writeSeed) return log.info('no write seed')
    var title = envelope.message.title
    ensureActiveSubscription(publicKey, function (error, email, subscription) {
      if (error) return log.error(error)
      if (!subscription) return log.info('no active subscription')
      var projectDiscoveryKey = hashHexString(replicationKey)
      log.info({ projectDiscoveryKey }, 'putting')
      runParallel([
        function (done) {
          data.putProjectKeys({
            projectDiscoveryKey, replicationKey, writeSeed, title
          }, done)
        },
        function (done) {
          data.putProjectUser(projectDiscoveryKey, email, done)
        },
        function (done) {
          data.putUserProject(email, projectDiscoveryKey, done)
        }
      ], function (error) {
        if (error) return log.error(error)
        var data = { email, projectDiscoveryKey }
        log.info('emitting events')
        events.emit(`invitation:${email}`, data)
        events.emit(`invitation:${projectDiscoveryKey}`, data)
      })
    })
  })

  var eventName

  returned.on('request', function (envelope) {
    var publicKey = envelope.publicKey
    console.log('%s is %j', 'publicKey', publicKey)
    log.info({ publicKey }, 'received request')
    console.error('received request')
    ensureActiveSubscription(publicKey, function (error, email, subscription) {
      if (error) return log.error(error)
      if (!subscription) return log.info('no active subscription')
      eventName = `invitation:${email}`
      events.addListener(eventName, onInvitationEvent)
      data.listUserProjects(email, function (error, projectDiscoveryKeys) {
        if (error) return log.error(error)
        projectDiscoveryKeys.forEach(sendInvitation)
      })
    })
  })

  function sendInvitation (projectDiscoveryKey) {
    data.getProjectKeys(projectDiscoveryKey, function (error, keys) {
      if (error) return log.error(error)
      var invitation = {
        message: {
          replicationKeyCiphertext: keys.replicationKeyCiphertext,
          replicationKeyNonce: keys.replicationKeyNonce,
          writeSeedCiphertext: keys.writeSeedCiphertext,
          writeSeedNonce: keys.writeSeedNonce,
          titleCiphertext: keys.title,
          titleNonce: keys.titleNonce
        },
        publicKey: process.env.PUBLIC_KEY
      }
      console.log(invitation)
      var signature = Buffer.alloc(sodium.crypto_sign_BYTES)
      sodium.crypto_sign_detached(
        signature,
        Buffer.from(stringify(invitation.message), 'utf8'),
        Buffer.from(process.env.SECRET_KEY, 'hex')
      )
      invitation.signature = signature.toString('hex')
      returned.invitation(invitation, function (error) {
        if (error) return log.error(error)
        log.info({ projectDiscoveryKey }, 'sent invitation')
      })
    })
  }

  function onInvitationEvent (message) {
    sendInvitation(message.projectDiscoveryKey)
  }

  returned.once('close', function () {
    if (eventName) events.removeListener(eventName, onInvitationEvent)
  })

  returned.on('invalid', function (message) {
    log.error({ message }, 'invalid')
  })

  returned.handshake(function (error) {
    if (error) return log.error(error)
    log.info('sent handshake')
  })

  return returned
}

function makeReplicationStream (options) {
  assert.strictEqual(typeof options, 'object')
  assert.strictEqual(typeof options.replicationKeyCiphertext, 'string')
  assert.strictEqual(typeof options.replicationKeyNonce, 'string')
  assert.strictEqual(typeof options.projectDiscoveryKey, 'string')
  assert.strictEqual(typeof options.writeSeedCiphertext, 'string')
  assert.strictEqual(typeof options.writeSeedNonce, 'string')
  assert(options.log)
  var replicationKeyCiphertext = options.replicationKeyCiphertext
  var replicationKeyNonce = options.replicationKeyNonce
  var projectDiscoveryKey = options.projectDiscoveryKey
  var writeSeedCiphertext = options.writeSeedCiphertext
  var writeSeedNonce = options.writeSeedNonce
  var log = options.log.child({ projectDiscoveryKey })

  // For each log, track the highest index that we believe our
  // peer has, and use it to avoid sending unnecessary offers.
  var heads = new Map()

  function advancePeerHead (reference) {
    assert(isReference(reference))
    var publicKey = reference.publicKey
    var index = reference.index
    var current = heads.get(publicKey)
    if (current === undefined) return
    if (index > current) heads.set(publicKey, index)
  }

  function shouldSend (reference) {
    assert(isReference(reference))
    var current = heads.get(reference.publicKey)
    if (current === undefined) return true
    if (reference.index > current) return true
    return false
  }

  var returned = new protocol.Replication({
    encryptionKey: Buffer.from(replicationKey, 'hex'),
    seed: Buffer.from(writeSeed, 'hex')
  })

  var eventName = `project:${projectDiscoveryKey}`
  events.addListener(eventName, onEnvelopeEvent)

  returned.once('handshake', function () {
    log.info('received handshake')
    log.info('sending handshake')
    returned.handshake(function (error) {
      if (error) return log.error(error)
      log.info('sent handshake')
    })
    data.listProjectPublicKeys(projectDiscoveryKey, function (error, publicKeys) {
      if (error) return log.error(error)
      log.info({ publicKeys }, 'public keys')
      publicKeys.forEach(function (publicKey) {
        data.getLastIndex(projectDiscoveryKey, publicKey, function (error, index) {
          if (error) return log.error(error)
          if (index === undefined) {
            return log.error({ projectDiscoveryKey, publicKey }, 'no envelopes')
          }
          log.info({ publicKey, index }, 'last index')
          sendOffer({ publicKey, index })
        })
      })
    })
  })

  // When our peer requests an envelope...
  var requestQueue = async.queue(sendEnvelope, 1)

  returned.on('request', function (request) {
    log.info(request, 'received request')
    requestQueue.push(request, function (error) {
      if (error) log.error(error)
    })
  })

  function sendEnvelope (reference, done) {
    assert(isReference(reference))
    var publicKey = reference.publicKey
    var index = reference.index
    data.getEnvelope(
      projectDiscoveryKey, publicKey, index,
      function (error, envelope) {
        if (error) return done(error)
        if (!envelope) return done()
        log.info(reference, 'sending envelope')
        returned.envelope(envelope, function (error) {
          if (error) return done(error)
          advancePeerHead(reference)
          log.info(reference, 'sent envelope')
          done()
        })
      }
    )
  }

  // When our peer offers an envelope...
  returned.on('offer', function (reference) {
    log.info(reference, 'received offer')
    var publicKey = reference.publicKey
    var offeredIndex = reference.index
    advancePeerHead(reference)
    data.getLastIndex(projectDiscoveryKey, publicKey, function (error, last) {
      if (error) return log.error(error)
      if (last === undefined) last = -1
      log.info({ publicKey, last }, 'last index')
      for (var index = last + 1; index <= offeredIndex; index++) {
        log.info({ publicKey, index }, 'sending request')
        var pair = { publicKey, index }
        returned.request(pair, function (error) {
          if (error) return log.error(error)
          log.info(pair, 'sent request')
        })
      }
    })
  })

  function onEnvelopeEvent (reference) {
    log.info({}, reference, 'envelope event')
    sendOffer(reference)
  }

  function sendOffer (reference) {
    if (!shouldSend(reference)) return
    log.info({
      publicKey: reference.publicKey,
      index: reference.index
    }, 'sending offer')
    returned.offer(reference, function (error) {
      if (error) return log.error(error)
      log.info({
        publicKey: reference.publicKey,
        index: reference.index
      }, 'sent offer')
    })
  }

  // When our peer sends an envelope...
  returned.on('envelope', function (envelope) {
    var publicKey = envelope.publicKey
    var index = envelope.message.index
    log.info({ publicKey, index }, 'received envelope')
    advancePeerHead({ publicKey, index })
    if (envelope.message.project !== projectDiscoveryKey) {
      return log.error({ publicKey, index }, 'project mismatch')
    }
    log.info({ publicKey, index }, 'putting envelope')
    if (index === 0) {
      data.putProjectPublicKey(
        projectDiscoveryKey, publicKey,
        function (error) {
          if (error) return log.error(error)
          log.info({ projectDiscoveryKey, publicKey }, 'put public key')
        }
      )
    }
    data.putEnvelope(envelope, function (error) {
      if (error) return log.error(error)
      log.info({ publicKey, index }, 'put envelope')
      events.emit(`project:${projectDiscoveryKey}`, { publicKey, index })
    })
  })

  returned.once('close', function () {
    if (eventName) events.removeListener(eventName, onEnvelopeEvent)
  })

  returned.on('invalid', function (message) {
    log.error({ message }, 'invalid')
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

function isReference (object) {
  return (
    typeof object === 'object' &&
    typeof object.publicKey === 'string' &&
    typeof object.index === 'number'
  )
}
