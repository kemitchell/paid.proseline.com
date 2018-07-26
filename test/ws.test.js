var server = require('./server')
var tape = require('tape')
var websocketStream = require('websocket-stream')

tape.test('Connect to WebSocket', function (test) {
  server(function (port, done) {
    var ws = websocketStream('ws://localhost:' + port, {
      perMessageDeflate: false
    })
      .once('error', function (error) {
        test.ifError(error)
      })
      .once('data', function () {
        test.pass('received data')
        ws.destroy()
        done()
        test.end()
      })
  })
})
