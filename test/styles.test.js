var http = require('http')
var server = require('./server')
var tape = require('tape')

tape.test('GET /styles.css', function (test) {
  server(function (port, done) {
    http.request({ path: '/styles.css', port: port })
      .once('response', function (response) {
        test.equal(
          response.statusCode, 200,
          'responds 200'
        )
        test.assert(
          response.headers['content-type'].includes('text/css'),
          'text/css'
        )
        test.end()
        done()
      })
      .end()
  })
})
