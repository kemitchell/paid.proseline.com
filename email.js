var FormData = require('form-data')
var https = require('https')
var pump = require('pump')

// TODO: hostname from env var

exports.confirmation = function (
  configuration, requestLog, email, capability, callback
) {
  send(configuration, requestLog, {
    to: email,
    subject: 'Confirm Your Proseline Subscription',
    text: [
      'Click this link to confirm your Proseline subscription:',
      'https://paid.proseline.com/subscribe?capability=' + capability
    ].join('\n\n')
  }, callback)
}

exports.cancel = function (
  configuration, requestLog, email, capability, callback
) {
  send(configuration, requestLog, {
    to: email,
    subject: 'Cancel Your Proseline Subscription',
    text: [
      'Click this link to cancel your Proseline subscription:',
      'https://paid.proseline.com/cancel?capability=' + capability
    ].join('\n\n')
  }, callback)
}

function send (configuration, requestLog, options, callback) {
  var domain = configuration.email.domain
  var key = configuration.email.key
  var from = configuration.email.sender + '@' + domain
  var log = requestLog.child({subsystem: 'email'})
  var form = new FormData()
  form.append('from', from)
  form.append('to', options.to)
  form.append('subject', options.subject)
  form.append('o:dkim', 'yes')
  form.append('o:require-tls', 'yes')
  form.append('text', options.text)
  pump(form, https.request({
    method: 'POST',
    host: 'api.mailgun.net',
    path: '/v3/' + domain + '/messages',
    auth: 'api:' + key,
    headers: form.getHeaders()
  }, function (response) {
    var status = response.statusCode
    if (status === 200) {
      log.info({event: 'sent'})
      return callback()
    }
    var chunks = []
    response
      .on('data', function (chunk) {
        chunks.push(chunk)
      })
      .once('error', function (error) {
        log.error(error)
        callback(error)
      })
      .once('end', function () {
        var body = Buffer.concat(chunks)
        var error = {
          status: response.statusCode,
          body: body.toString()
        }
        log.error(error)
        callback(error)
      })
  }))
}
