var FormData = require('form-data')
var https = require('https')
var pump = require('pump')

var KEY = process.env.MAILGUN_KEY
var DOMAIN = process.env.MAILGUN_DOMAIN
var FROM = process.env.MAILGUN_FROM
var HOSTNAME = process.env.HOSTNAME

exports.subscribe = function (
  requestLog, email, capability, callback
) {
  send(requestLog, {
    to: email,
    subject: 'Confirm Your Proseline Subscription',
    paragraphs: [
      'Click this link to confirm your Proseline subscription:',
      `https://${HOSTNAME}/subscribe?capability=${capability}`
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
      `https://${HOSTNAME}/add?capability=${capability}`
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
      `https://${HOSTNAME}/cancel?capability=${capability}`
    ]
  }, callback)
}

function send (requestLog, options, callback) {
  var log = requestLog.child({subsystem: 'email'})
  var form = new FormData()
  form.append('from', FROM)
  form.append('to', options.to)
  form.append('subject', options.subject)
  form.append('o:dkim', 'yes')
  form.append('o:require-tls', 'yes')
  form.append('text', options.paragraphs.join('\n\n'))
  pump(form, https.request({
    method: 'POST',
    host: 'api.mailgun.net',
    path: `/v3/${DOMAIN}/message`,
    auth: `api:${KEY}`,
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
