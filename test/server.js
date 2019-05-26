var constants = require('./constants')
var crypto = require('@proseline/crypto')
var fs = require('fs')
var http = require('http')
var httpHandler = require('../http')
var pino = require('pino')
var s3 = require('../s3/test')
var websocketHandler = require('../ws')
var websocketStream = require('websocket-stream')

module.exports = function (test) {
  var log = pino(fs.createWriteStream('test-server.log'))
  process.env.HOSTNAME = constants.HOSTNAME
  var keyPair = crypto.signingKeyPair()
  process.env.PUBLIC_KEY = keyPair.publicKey.toString('hex')
  process.env.SECRET_KEY = keyPair.secretKey.toString('hex')
  var server = http.createServer(httpHandler(log))
  websocketStream.createServer({
    server: server,
    perMessageDeflate: false
  }, websocketHandler(log.child({ subsytem: 'ws' })))
  server.listen(0, function () {
    test(this.address().port, function () {
      s3.clear()
      server.close()
    })
  })
}
