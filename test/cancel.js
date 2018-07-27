var FormData = require('form-data')
var concat = require('simple-concat')
var http = require('http')

module.exports = function (email, port, test, callback) {
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
          callback()
        })
      } else return callback()
    })
    .once('error', function (error) {
      if (test) test.ifError(error)
      callback()
    })
  form.pipe(request)
}
