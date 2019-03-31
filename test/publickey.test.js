var concat = require('simple-concat')
var http = require('http')
var server = require('./server')
var tape = require('tape')

tape.test('GET /publickey', function (test) {
  server(function (port, done) {
    http.request({ path: '/publickey', port })
      .once('response', function (response) {
        test.equal(
          response.statusCode, 200,
          'responds 200'
        )
        concat(response, function (error, buffer) {
          test.ifError(error, 'no error')
          test.assert(
            /^[a-f0-9]{64}$/.test(buffer.toString()),
            'hex public key'
          )
          test.end()
          done()
        })
      })
      .end()
  })
})
