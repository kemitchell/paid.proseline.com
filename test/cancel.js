var FormData = require('form-data')
var concat = require('simple-concat')
var constants = require('./constants')
var http = require('http')
var mailgun = require('../mailgun/test').events

module.exports = function (email, port, test, callback) {
  mailgun.once('sent', function (message) {
    if (test) {
      test.equal(message.to, email, 'to address')
      test.assert(message.subject.includes('Cancel'), 'subject has "Cancel"')
      test.assert(
        message.paragraphs.some(function (paragraph) {
          return paragraph.includes(
            'https://' + constants.HOSTNAME + '/cancel'
          )
        }),
        'sent capability link'
      )
    }
    callback(message)
  })
  var form = new FormData()
  form.append('email', email)
  var request = http.request({
    method: 'POST',
    path: '/cancel',
    headers: form.getHeaders(),
    port
  })
    .once('response', function (response) {
      if (test) {
        test.equal(
          response.statusCode, 200,
          'responds 200'
        )
        concat(response, function (error, buffer) {
          var body = buffer.toString()
          test.ifError(error, 'no error')
          var string = 'E-Mail Sent'
          test.assert(
            body.includes(string),
            'body includes ' + JSON.stringify(string)
          )
        })
      }
    })
    .once('error', function (error) {
      if (test) test.ifError(error)
      callback()
    })
  form.pipe(request)
}
