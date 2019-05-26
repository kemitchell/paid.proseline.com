var assert = require('assert')
var indices = require('./indices')
var s3 = require('./s3')
var schemas = require('@proseline/schemas')
var uuid = require('uuid')

var DELIMITER = s3.DELIMITER

function projectKey (projectDiscoveryKey) {
  assert.strictEqual(typeof projectDiscoveryKey, 'string')
  return `projects/${projectDiscoveryKey}`
}

function projectPublicKeyKey (projectDiscoveryKey, logPublicKey) {
  return `${projectKey(projectDiscoveryKey)}/logPublicKeys/${logPublicKey}`
}

exports.putLogPublicKey = function (projectDiscoveryKey, logPublicKey, callback) {
  assert.strictEqual(typeof projectDiscoveryKey, 'string')
  assert.strictEqual(typeof logPublicKey, 'string')
  assert.strictEqual(typeof callback, 'function')
  var key = projectPublicKeyKey(projectDiscoveryKey, logPublicKey)
  s3.put(key, {}, callback)
}

exports.listLogPublicKeys = function (projectDiscoveryKey, callback) {
  assert.strictEqual(typeof projectDiscoveryKey, 'string')
  assert.strictEqual(typeof callback, 'function')
  var prefix = projectPublicKeyKey(projectDiscoveryKey, '')
  s3.list(prefix, function (error, keys) {
    if (error) return callback(error)
    callback(null, keys.map(function (key) {
      return key.split(DELIMITER)[3]
    }))
  })
}

function envelopeKey (projectDiscoveryKey, logPublicKey, index) {
  assert.strictEqual(typeof projectDiscoveryKey, 'string')
  assert.strictEqual(typeof logPublicKey, 'string')
  assert.strictEqual(typeof index, 'number')
  return (
    projectKey(projectDiscoveryKey) +
    `/envelopes/${logPublicKey}/${indices.stringify(index)}`
  )
}

exports.getLastIndex = function (projectDiscoveryKey, logPublicKey, callback) {
  assert.strictEqual(typeof projectDiscoveryKey, 'string')
  assert.strictEqual(typeof logPublicKey, 'string')
  assert.strictEqual(typeof callback, 'function')
  s3.first(
    `${projectKey(projectDiscoveryKey)}/envelopes/${logPublicKey}/`,
    function (error, key) {
      if (error) {
        if (error.code === 'NoSuchKey') return callback(null, 0)
        return callback(error)
      }
      if (!key) return callback(null, undefined)
      var index = key.split(DELIMITER)[4]
      callback(null, indices.parse(index))
    }
  )
}

exports.getOuterEnvelope = function (projectDiscoveryKey, logPublicKey, index, callback) {
  assert.strictEqual(typeof projectDiscoveryKey, 'string')
  assert.strictEqual(typeof logPublicKey, 'string')
  assert.strictEqual(typeof index, 'number')
  assert.strictEqual(typeof callback, 'function')
  s3.get(envelopeKey(projectDiscoveryKey, logPublicKey, index), callback)
}

exports.putOuterEnvelope = function (outerEnvelope, callback) {
  assert.strictEqual(typeof outerEnvelope, 'object')
  assert(outerEnvelope.hasOwnProperty('projectDiscoveryKey'))
  assert(outerEnvelope.hasOwnProperty('logPublicKey'))
  assert(outerEnvelope.hasOwnProperty('index'))
  assert.strictEqual(typeof callback, 'function')
  s3.put(
    envelopeKey(
      outerEnvelope.projectDiscoveryKey,
      outerEnvelope.logPublicKey,
      outerEnvelope.index
    ),
    outerEnvelope,
    callback
  )
}

function projectKeysKey (projectDiscoveryKey) {
  assert.strictEqual(typeof projectDiscoveryKey, 'string')
  return `${projectKey(projectDiscoveryKey)}/keys`
}

exports.getProjectKeys = function (projectDiscoveryKey, callback) {
  assert.strictEqual(typeof projectDiscoveryKey, 'string')
  assert.strictEqual(typeof callback, 'function')
  s3.get(projectKeysKey(projectDiscoveryKey), callback)
}

exports.putProjectKeys = function (options, callback) {
  assert.strictEqual(typeof options, 'object')
  assert.strictEqual(typeof options.projectDiscoveryKey, 'string')
  assert.strictEqual(typeof options.replicationKey, 'string')
  assert.strictEqual(typeof options.readKeyCiphertext, 'string')
  assert.strictEqual(typeof options.readKeyNonce, 'string')
  assert.strictEqual(typeof callback, 'function')
  var projectDiscoveryKey = options.projectDiscoveryKey
  var record = {}
  Object.keys(schemas.invitation.properties)
    .forEach(function (key) { record[key] = options[key] })
  s3.put(projectKeysKey(projectDiscoveryKey), record, callback)
}

function projectUserKey (projectDiscoveryKey, email) {
  assert.strictEqual(typeof projectDiscoveryKey, 'string')
  assert.strictEqual(typeof email, 'string')
  return `${projectKey(projectDiscoveryKey)}/users/${encodeURIComponent(email)}`
}

exports.putProjectUser = function (projectDiscoveryKey, email, callback) {
  assert.strictEqual(typeof projectDiscoveryKey, 'string')
  assert.strictEqual(typeof email, 'string')
  assert.strictEqual(typeof callback, 'function')
  s3.put(
    projectUserKey(projectDiscoveryKey, email),
    { date: new Date().toISOString() },
    callback
  )
}

function userProjectKey (email, projectDiscoveryKey) {
  assert.strictEqual(typeof email, 'string')
  assert.strictEqual(typeof projectDiscoveryKey, 'string')
  return `${userKey(email)}/projects/${projectDiscoveryKey}`
}

exports.putUserProject = function (email, projectDiscoveryKey, callback) {
  assert.strictEqual(typeof email, 'string')
  assert.strictEqual(typeof projectDiscoveryKey, 'string')
  assert.strictEqual(typeof callback, 'function')
  s3.put(
    userProjectKey(email, projectDiscoveryKey),
    { date: new Date().toISOString() },
    callback
  )
}

exports.listUserProjects = function (email, callback) {
  assert.strictEqual(typeof email, 'string')
  assert.strictEqual(typeof callback, 'function')
  var prefix = `${userKey(email)}/projects/`
  s3.list(prefix, function (error, keys) {
    if (error) return callback(error)
    callback(null, keys.map(function (key) {
      return key.split(DELIMITER)[3]
    }))
  })
}

function clientPublicKeyKey (clientPublicKey) {
  assert.strictEqual(typeof clientPublicKey, 'string')
  return `clientPublicKeys/${clientPublicKey}`
}

exports.getClientPublicKey = function (clientPublicKey, callback) {
  assert.strictEqual(typeof clientPublicKey, 'string')
  assert.strictEqual(typeof callback, 'function')
  s3.get(clientPublicKeyKey(clientPublicKey), callback)
}

exports.putClientPublicKey = function (clientPublicKey, data, callback) {
  assert.strictEqual(typeof clientPublicKey, 'string')
  assert.strictEqual(typeof data, 'object')
  assert.strictEqual(typeof callback, 'function')
  data.date = new Date().toISOString()
  s3.put(clientPublicKeyKey(clientPublicKey), data, callback)
}

function userKey (email) {
  assert.strictEqual(typeof email, 'string')
  return `users/${encodeURIComponent(email)}`
}

exports.getUser = function (email, callback) {
  assert.strictEqual(typeof email, 'string')
  assert.strictEqual(typeof callback, 'function')
  s3.get(userKey(email), callback)
}

exports.putUser = function (email, data, callback) {
  assert.strictEqual(typeof email, 'string')
  assert.strictEqual(typeof data, 'object')
  assert.strictEqual(typeof callback, 'function')
  data.email = email
  s3.put(userKey(email), data, callback)
}

function capabilityKey (capability) {
  assert.strictEqual(typeof capability, 'string')
  return `capabilities/${capability}`
}

exports.putCapability = function (email, customerID, capability, data, callback) {
  assert.strictEqual(typeof email, 'string')
  assert.strictEqual(typeof customerID, 'string')
  assert.strictEqual(typeof capability, 'string')
  assert.strictEqual(typeof data, 'object')
  assert.strictEqual(typeof callback, 'function')
  data.date = new Date().toISOString()
  data.email = email
  data.customerID = customerID
  s3.put(capabilityKey(capability), data, callback)
}

exports.getCapability = function (capability, callback) {
  assert.strictEqual(typeof capability, 'string')
  assert.strictEqual(typeof callback, 'function')
  s3.get(capabilityKey(capability), callback)
}

exports.deleteCapability = function (capability, callback) {
  assert.strictEqual(typeof capability, 'string')
  assert.strictEqual(typeof callback, 'function')
  s3.delete(capabilityKey(capability), callback)
}

exports.putWebhook = function (data, callback) {
  assert.strictEqual(typeof data, 'object')
  assert.strictEqual(typeof callback, 'function')
  var id = new Date().toISOString() + '-' + uuid.v4()
  s3.put(`webhooks/${id}`, data, function (error) {
    if (error) return callback(error)
    callback(null, id)
  })
}
