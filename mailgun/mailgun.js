var FormData = require('form-data')
var https = require('https')
var simpleConcat = require('simple-concat')

module.exports = function (requestLog, options, callback) {
  var log = requestLog.child({subsystem: 'email'})
  var form = new FormData()
  form.append('from', process.env.MAILGUN_FROM)
  form.append('to', options.to)
  form.append('subject', options.subject)
  form.append('o:dkim', 'yes')
  form.append('o:require-tls', 'yes')
  form.append('text', options.paragraphs.join('\n\n'))
  var request = https.request({
    method: 'POST',
    host: 'api.mailgun.net',
    path: `/v3/${process.env.MAILGUN_DOMAIN}/messages`,
    auth: `api:${process.env.MAILGUN_API_KEY}`,
    headers: form.getHeaders()
  })
  request.once('response', function (response) {
    var status = response.statusCode
    if (status === 200) {
      log.info(options, 'sent')
      return callback()
    }
    simpleConcat(response, function (error, body) {
      if (error) return callback(error)
      var errorMessage = new Error(body.toString())
      errorMessage.statusCode = response.statusCode
      callback(errorMessage)
    })
  })
  form.pipe(request)
}
