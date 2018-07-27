var assert = require('assert')
var mailgun = require('./mailgun')

exports.subscribe = function (
  requestLog, email, capability, callback
) {
  assert.equal(typeof requestLog, 'object')
  assert.equal(typeof email, 'string')
  assert.equal(typeof capability, 'string')
  assert.equal(typeof callback, 'function')
  mailgun(requestLog, {
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
  assert.equal(typeof requestLog, 'object')
  assert.equal(typeof email, 'string')
  assert.equal(typeof name, 'string')
  assert.equal(typeof capability, 'string')
  assert.equal(typeof callback, 'function')
  mailgun(requestLog, {
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
  assert.equal(typeof requestLog, 'object')
  assert.equal(typeof email, 'string')
  assert.equal(typeof capability, 'string')
  assert.equal(typeof callback, 'function')
  mailgun(requestLog, {
    to: email,
    subject: 'Cancel Your Proseline Subscription',
    paragraphs: [
      'Click this link to cancel your Proseline subscription:',
      `https://${process.env.HOSTNAME}/cancel?capability=${capability}`
    ]
  }, callback)
}
