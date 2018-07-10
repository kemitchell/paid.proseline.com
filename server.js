var http = require('http')
var httpHandler = require('./http')
var pino = require('pino')
var websocketHandler = require('./ws')
var ws = require('ws')

var log = pino()

var httpServer = http.createServer(httpHandler(log))

/* eslint-disable no-new */
new ws.Server({
  server: httpServer,
  perMessageDeflate: false
}, websocketHandler(log))
/* eslint-enable no-new */

function trap () {
  log.info('signal')
  cleanup()
}

function cleanup () {
  httpServer.close(function () {
    log.info('closed server')
    process.exit(0)
  })
}

process.on('SIGTERM', trap)
process.on('SIGQUIT', trap)
process.on('SIGINT', trap)
process.on('uncaughtException', function (exception) {
  log.error(exception)
  cleanup()
})

var port = process.env.PORT || 8080
httpServer.listen(port, function () {
  var port = this.address().port
  log.info({port}, 'listening')
})
