var http = require('http')
var url = require('url')
var constants = require('./constants')
var concat = require('simple-concat')

module.exports = function (email, port, test, callback) {
  var link = email.paragraphs.find(function (paragraph) {
    return paragraph.includes(
      'https://' + constants.HOSTNAME + '/subscribe'
    )
  })
  var parsed = url.parse(link)
  http.request({path: parsed.path, port})
    .once('response', function (response) {
      if (test) {
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
          callback()
        })
      } else return callback()
    })
    .end()
}
