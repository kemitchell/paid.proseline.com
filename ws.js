var Protocol = require('./protocol')
var async = require('async')
var data = require('./data')
var events = require('./events')
var uuid = require('uuid')

module.exports = function (serverLog) {
  return function (socket, request) {
    // Set up logging.
    var log = serverLog.child({ socket: uuid.v4() })
    log.info({
      ip: request.connection.remoteAddress,
      headers: request.headers
    }, 'connection')

    // Parse URL for project discovery key.
    var match = /^\/([a-f0-9]{64})$/.exec(request.url)
    if (match) {
      var projectDiscoveryKey = match[1]
      log.info({ projectDiscoveryKey }, 'valid project discovery key')
    } else {
      log.error('invalid project discovery key')
      return socket.end()
    }

    data.getProjectKeys(projectDiscoveryKey, function (error, keys) {
      if (error) {
        log.error(error)
        return socket.end()
      }
      if (!keys) {
        log.info('unknown project')
        return socket.end()
      }
      log.info('replicating')
      replicate(keys.replicationKey)
    })

    function replicate (replicationKey) {
      // For each log, track the highest index that we believe our
      // peer has, and use it to avoid sending unnecessary offers.
      var heads = new Map()

      function advancePeerHead (reference) {
        var logPublicKey = reference.logPublicKey
        var index = reference.index
        var current = heads.get(logPublicKey)
        if (current === undefined) return
        if (index > current) heads.set(logPublicKey, index)
      }

      function shouldSend (reference) {
        if (closed) return false
        var current = heads.get(reference.logPublicKey)
        if (current === undefined) return true
        if (reference.index > current) return true
        return false
      }

      var protocol = new Protocol({
        key: Buffer.from(replicationKey, 'hex')
      })

      var receivedData = false
      setTimeout(function () {
        if (!receivedData) close()
      }, 1000)
      protocol.once('handshake', function () {
        log.info('received handshake')
        protocol.handshake(function (error) {
          if (error) return log.error(error)
          log.info('sent handshake')
        })
        offerEnvelopes()
      })

      // 1. Sending

      // When our peer requests an envelope...
      var requestQueue = async.queue(sendEnvelope, 1)

      protocol.on('request', function (request) {
        receivedData = true
        log.info(request, 'received request')
        requestQueue.push(request, function (error) {
          if (error) log.error(error)
        })
      })

      function sendEnvelope (reference, done) {
        var logPublicKey = reference.logPublicKey
        var index = reference.index
        data.getOuterEnvelope(
          projectDiscoveryKey, logPublicKey, index,
          function (error, outerEnvelope) {
            if (error) return done(error)
            if (!outerEnvelope) return done()
            log.info(reference, 'sending envelope')
            protocol.outerEnvelope(outerEnvelope, function (error) {
              if (error) return done(error)
              advancePeerHead(reference)
              log.info(reference, 'sent envelope')
              done()
            })
          }
        )
      }

      // Listen to events about outer envelopes for this project
      // received from other peers.
      var eventName = `project:${projectDiscoveryKey}`
      events.addListener(eventName, onEnvelopeEvent)
      function onEnvelopeEvent (reference) {
        log.info({}, reference, 'envelope event')
        sendOffer(reference)
      }

      function offerEnvelopes () {
        data.listLogPublicKeys(projectDiscoveryKey, function (error, logPublicKeys) {
          if (error) return log.error(error)
          log.info({ logPublicKeys }, 'log public keys')
          logPublicKeys.forEach(function (logPublicKey) {
            data.getLastIndex(projectDiscoveryKey, logPublicKey, function (error, index) {
              if (error) return log.error(error)
              if (index === undefined) {
                return log.error({ projectDiscoveryKey, logPublicKey }, 'no envelopes')
              }
              log.info({ logPublicKey, index }, 'last index')
              sendOffer({ logPublicKey, index })
            })
          })
        })
      }

      function sendOffer (reference) {
        if (!shouldSend(reference)) return
        log.info({
          logPublicKey: reference.logPublicKey,
          index: reference.index
        }, 'sending offer')
        protocol.offer(reference, function (error) {
          if (error) return log.error(error)
          log.info({}, reference, 'sent offer')
        })
      }

      // 2. Receiving

      // When our peer offers an envelope...
      protocol.on('offer', function (reference) {
        receivedData = true
        log.info(reference, 'received offer')
        var logPublicKey = reference.logPublicKey
        var offeredIndex = reference.index
        advancePeerHead(reference)
        data.getLastIndex(projectDiscoveryKey, logPublicKey, function (error, last) {
          if (error) return log.error(error)
          if (last === undefined) last = -1
          log.info({ logPublicKey, last }, 'last index')
          for (var index = last + 1; index <= offeredIndex; index++) {
            log.info({ logPublicKey, index }, 'sending request')
            var pair = { logPublicKey, index }
            protocol.request(pair, function (error) {
              if (error) return log.error(error)
              log.info(pair, 'sent request')
            })
          }
        })
      })

      // When our peer sends an envelope...
      protocol.on('outerEnvelope', function (outerEnvelope) {
        receivedData = true
        var logPublicKey = outerEnvelope.logPublicKey
        var index = outerEnvelope.index
        log.info({ logPublicKey, index }, 'received envelope')
        advancePeerHead({ logPublicKey, index })
        if (outerEnvelope.projectDiscoveryKey !== projectDiscoveryKey) {
          return log.error({ logPublicKey, index }, 'project mismatch')
        }
        log.info({ logPublicKey, index }, 'putting outer envelope')
        if (index === 0) {
          data.putLogPublicKey(
            projectDiscoveryKey, logPublicKey,
            function (error) {
              if (error) return log.error(error)
              log.info({ projectDiscoveryKey, logPublicKey }, 'put public key')
            }
          )
        }
        data.putOuterEnvelope(outerEnvelope, function (error) {
          if (error) return log.error(error)
          log.info({ logPublicKey, index }, 'put envelope')
          events.emit(`project:${projectDiscoveryKey}`, { logPublicKey, index })
        })
      })

      protocol.on('invalid', function (message) {
        log.error({ message }, 'invalid')
      })

      protocol.on('error', function (error) {
        log.error(error)
      })

      protocol.once('close', close)
      socket.once('close', close)
      var closed = false
      function close () {
        if (closed) return
        log.info('closing')
        events.removeListener(eventName, onEnvelopeEvent)
        protocol.end()
        socket.end()
        closed = true
      }

      socket.pipe(protocol).pipe(socket)
    }
  }
}
