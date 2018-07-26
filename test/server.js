var fs = require('fs')
var http = require('http')
var httpHandler = require('../http')
var pino = require('pino')
var websocketHandler = require('../ws')
var websocketStream = require('websocket-stream')

module.exports = function (test) {
  var log = pino(fs.createWriteStream('test-server.log'))
  var server = http.createServer(httpHandler(log))
  websocketStream.createServer({
    server: server,
    perMessageDeflate: false
  }, websocketHandler(log.child({subsytem: 'ws'})))
  server.listen(0, function () {
    test(this.address().port, function () {
      server.close()
    })
  })
}
