var concat = require('simple-concat')
var constants = require('./constants')
var http = require('http')
var server = require('./server')
var subscribe = require('./subscribe')
var tape = require('tape')
var url = require('url')

tape('POST /subscribe', function (test) {
  server(function (port, done) {
    subscribe('test@example.com', port, test, function () {
      test.end()
      done()
    })
  })
})

tape.only('GET /subscribe', function (test) {
  server(function (port, done) {
    subscribe('test@example.com', port, null, function (email) {
      var link = email.paragraphs.find(function (paragraph) {
        return paragraph.includes(
          'https://' + constants.HOSTNAME + '/subscribe'
        )
      })
      var parsed = url.parse(link)
      http.request({path: parsed.path, port})
        .once('response', function (response) {
          test.equal(
            response.statusCode, 200,
            'responds 200'
          )
          concat(response, function (error, buffer) {
            var body = buffer.toString()
            test.ifError(error, 'no error')
            var name = 'Subscribed'
            test.assert(
              body.includes(name),
              'body includes ' + JSON.stringify(name)
            )
            test.end()
            done()
          })
        })
        .end()
    })
  })
})

tape('PUT /subscribe', function (test) {
  server(function (port, done) {
    http.request({path: '/subscribe', method: 'PUT', port})
      .once('response', function (response) {
        test.equal(
          response.statusCode, 405,
          'responds 405'
        )
        test.end()
        done()
      })
      .end()
  })
})
