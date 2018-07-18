var FormData = require('form-data')
var https = require('https')
var simpleConcat = require('simple-concat')

exports.subscribe = function (
  requestLog, email, capability, callback
) {
  send(requestLog, {
    to: email,
    subject: 'Confirm Your Proseline Subscription',
    paragraphs: [
      'Click this link to confirm your Proseline subscription:',
      `https://${process.env.HOSTNAME}/subscribe?capability=${capability}`
    ]
  }, callback)
}

exports.add = function (
  requestLog, email, name, capability, callback
) {
  send(requestLog, {
    to: email,
    subject: 'Add a New Device to Your Proseline Subscription',
    paragraphs: [
      'Click this link to confirm adding the new device ' +
      `"${name}" to you Proseline subscription:`,
      `https://${process.env.HOSTNAME}/add?capability=${capability}`
    ]
  }, callback)
}

exports.cancel = function (
  requestLog, email, capability, callback
) {
  send(requestLog, {
    to: email,
    subject: 'Cancel Your Proseline Subscription',
    paragraphs: [
      'Click this link to cancel your Proseline subscription:',
      `https://${process.env.HOSTNAME}/cancel?capability=${capability}`
    ]
  }, callback)
}

function send (requestLog, options, callback) {
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
    path: `/v3/${process.env.MAILGUN_DOMAIN}/message`,
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
