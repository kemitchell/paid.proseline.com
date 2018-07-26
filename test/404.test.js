var concat = require('simple-concat')
var http = require('http')
var server = require('./server')
var tape = require('tape')

tape.test('GET /nonexistent', function (test) {
  server(function (port, done) {
    http.request({path: '/nonexistent', port})
      .once('response', function (response) {
        test.equal(
          response.statusCode, 404,
          'responds 404'
        )
        test.assert(
          response.headers['content-type'].includes('text/html'),
          'text/html'
        )
        concat(response, function (error, buffer) {
          var body = buffer.toString()
          test.ifError(error, 'no error')
          var message = 'Not Found'
          test.assert(
            body.includes(message),
            'body includes ' + JSON.stringify(message)
          )
          test.end()
          done()
        })
      })
      .end()
  })
})
