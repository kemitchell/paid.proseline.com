var aws = require('aws-sdk')
var http = require('http')
var httpHandler = require('./http')
var pino = require('pino')
var websocketHandler = require('./ws')
var ws = require('ws')

var log = pino()

var configuration = {
  log,
  s3: new aws.S3({
    accessKeyId: process.env.S3_ACCESS_KEY,
    secretAccessKey: process.env.S3_SECRET_KEY
  }),
  stripe: require('./env/stripe'),
  mailgun: require('./env/mailgun')
}

var httpServer = http.createServer(httpHandler(configuration))

/* eslint-disable no-new */
new ws.Server({
  server: httpServer,
  perMessageDeflate: false
}, websocketHandler(configuration))
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
