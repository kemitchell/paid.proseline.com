var http = require('http')
var server = require('./server')
var tape = require('tape')
var constants = require('./constants')

tape('POST /webhook', function (test) {
  server(function (port, done) {
    http.request({
      method: 'POST',
      path: '/webhook',
      port,
      headers: { 'Stripe-Signature': constants.VALID_STRIPE_SIGNATURE }
    })
      .once('response', function (response) {
        test.equal(
          response.statusCode, 200,
          'responds 200'
        )
        test.end()
        done()
      })
      .end(JSON.stringify({}))
  })
})

tape('POST /webhook with invalid JSON', function (test) {
  server(function (port, done) {
    http.request({
      method: 'POST',
      path: '/webhook',
      port,
      headers: { 'Stripe-Signature': constants.VALID_STRIPE_SIGNATURE }
    })
      .once('response', function (response) {
        test.equal(
          response.statusCode, 400,
          'responds 400'
        )
        test.end()
        done()
      })
      .end('invalid json')
  })
})

tape('POST /webhook with non-object', function (test) {
  server(function (port, done) {
    http.request({
      method: 'POST',
      path: '/webhook',
      port,
      headers: { 'Stripe-Signature': constants.VALID_STRIPE_SIGNATURE }
    })
      .once('response', function (response) {
        test.equal(
          response.statusCode, 400,
          'responds 400'
        )
        test.end()
        done()
      })
      .end(JSON.stringify('string, not an object'))
  })
})

tape('POST /webhook with invalid signature', function (test) {
  server(function (port, done) {
    http.request({
      method: 'POST',
      path: '/webhook',
      port,
      headers: { 'Stripe-Signature': 'invalid' }
    })
      .once('response', function (response) {
        test.equal(
          response.statusCode, 400,
          'responds 400'
        )
        test.end()
        done()
      })
      .end(JSON.stringify({}))
  })
})

tape('GET /webhook', function (test) {
  server(function (port, done) {
    http.request({
      method: 'GET',
      path: '/webhook',
      port
    })
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
