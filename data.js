var assert = require('assert')
var indices = require('./indices')
var s3 = require('./s3')
var uuid = require('uuid')

var DELIMITER = s3.DELIMITER

function projectKey (discoveryKey) {
  assert.equal(typeof discoveryKey, 'string')
  return `projects/${discoveryKey}`
}

function projectPublicKeyKey (discoveryKey, publicKey) {
  return `${projectKey(discoveryKey)}/publicKeys/${publicKey}`
}

exports.putProjectPublicKey = function (discoveryKey, publicKey, callback) {
  assert.equal(typeof discoveryKey, 'string')
  assert.equal(typeof publicKey, 'string')
  assert.equal(typeof callback, 'function')
  var key = projectPublicKeyKey(discoveryKey, publicKey)
  s3.put(key, {}, callback)
}

exports.listProjectPublicKeys = function (discoveryKey, callback) {
  assert.equal(typeof discoveryKey, 'string')
  assert.equal(typeof callback, 'function')
  var prefix = projectPublicKeyKey(discoveryKey, '')
  s3.list(prefix, function (error, keys) {
    if (error) return callback(error)
    callback(null, keys.map(function (key) {
      return key.split(DELIMITER)[3]
    }))
  })
}

function envelopeKey (discoveryKey, publicKey, index) {
  assert.equal(typeof discoveryKey, 'string')
  assert.equal(typeof publicKey, 'string')
  assert.equal(typeof index, 'number')
  return (
    projectKey(discoveryKey) +
    `/envelopes/${publicKey}/${indices.stringify(index)}`
  )
}

exports.getLastIndex = function (discoveryKey, publicKey, callback) {
  assert.equal(typeof discoveryKey, 'string')
  assert.equal(typeof publicKey, 'string')
  assert.equal(typeof callback, 'function')
  s3.first(
    `${projectKey(discoveryKey)}/envelopes/${publicKey}/`,
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

exports.getEnvelope = function (discoveryKey, publicKey, index, callback) {
  assert.equal(typeof discoveryKey, 'string')
  assert.equal(typeof publicKey, 'string')
  assert.equal(typeof index, 'number')
  assert.equal(typeof callback, 'function')
  s3.get(envelopeKey(discoveryKey, publicKey, index), callback)
}

exports.putEnvelope = function (envelope, callback) {
  assert.equal(typeof envelope, 'object')
  assert(envelope.hasOwnProperty('message'))
  assert(envelope.hasOwnProperty('publicKey'))
  assert(envelope.hasOwnProperty('signature'))
  assert(envelope.message.hasOwnProperty('project'))
  assert(envelope.message.hasOwnProperty('index'))
  assert.equal(typeof callback, 'function')
  s3.put(
    envelopeKey(
      envelope.message.project,
      envelope.publicKey,
      envelope.message.index
    ),
    envelope,
    callback
  )
}

function projectKeysKey (discoveryKey) {
  assert.equal(typeof discoveryKey, 'string')
  return `${projectKey(discoveryKey)}/keys`
}

exports.getProjectKeys = function (discoveryKey, callback) {
  assert.equal(typeof discoveryKey, 'string')
  assert.equal(typeof callback, 'function')
  s3.get(projectKeysKey(discoveryKey), callback)
}

exports.putProjectKeys = function (discoveryKey, replicationKey, writeSeed, callback) {
  assert.equal(typeof discoveryKey, 'string')
  assert.equal(typeof replicationKey, 'string')
  assert.equal(typeof writeSeed, 'string')
  assert.equal(typeof callback, 'function')
  s3.put(
    projectKeysKey(discoveryKey), {replicationKey, writeSeed}, callback
  )
}

function projectUserKey (discoveryKey, email) {
  assert.equal(typeof discoveryKey, 'string')
  assert.equal(typeof email, 'string')
  return `${projectKey(discoveryKey)}/users/${encodeURIComponent(email)}`
}

exports.putProjectUser = function (discoveryKey, email, callback) {
  assert.equal(typeof discoveryKey, 'string')
  assert.equal(typeof email, 'string')
  assert.equal(typeof callback, 'function')
  s3.put(
    projectUserKey(discoveryKey, email),
    {date: new Date().toISOString()},
    callback
  )
}

function userProjectKey (email, discoveryKey) {
  assert.equal(typeof email, 'string')
  assert.equal(typeof discoveryKey, 'string')
  return `${userKey(email)}/projects/${discoveryKey}`
}

exports.putUserProject = function (email, discoveryKey, callback) {
  assert.equal(typeof email, 'string')
  assert.equal(typeof discoveryKey, 'string')
  assert.equal(typeof callback, 'function')
  s3.put(
    userProjectKey(email, discoveryKey),
    {date: new Date().toISOString()},
    callback
  )
}

exports.listUserProjects = function (email, callback) {
  assert.equal(typeof email, 'string')
  assert.equal(typeof callback, 'function')
  var prefix = `${userKey(email)}/projects/`
  s3.list(prefix, function (error, keys) {
    if (error) return callback(error)
    callback(null, keys.map(function (key) {
      return key.split(DELIMITER)[3]
    }))
  })
}

function publicKeyKey (publicKey) {
  assert.equal(typeof publicKey, 'string')
  return `publicKeys/${publicKey}`
}

exports.getPublicKey = function (publicKey, callback) {
  assert.equal(typeof publicKey, 'string')
  assert.equal(typeof callback, 'function')
  s3.get(publicKeyKey(publicKey), callback)
}

exports.putPublicKey = function (publicKey, data, callback) {
  assert.equal(typeof publicKey, 'string')
  assert.equal(typeof data, 'object')
  assert.equal(typeof callback, 'function')
  data.date = new Date().toISOString()
  s3.put(publicKeyKey(publicKey), data, callback)
}

function userKey (email) {
  assert.equal(typeof email, 'string')
  return `users/${encodeURIComponent(email)}`
}

exports.getUser = function (email, callback) {
  assert.equal(typeof email, 'string')
  assert.equal(typeof callback, 'function')
  s3.get(userKey(email), callback)
}

exports.putUser = function (email, data, callback) {
  assert.equal(typeof email, 'string')
  assert.equal(typeof data, 'object')
  assert.equal(typeof callback, 'function')
  data.email = email
  s3.put(userKey(email), data, callback)
}

function capabilityKey (capability) {
  assert.equal(typeof capability, 'string')
  return `capabilities/${capability}`
}

exports.putCapability = function (email, customerID, capability, data, callback) {
  assert.equal(typeof email, 'string')
  assert.equal(typeof customerID, 'string')
  assert.equal(typeof capability, 'string')
  assert.equal(typeof data, 'object')
  assert.equal(typeof callback, 'function')
  data.date = new Date().toISOString()
  data.email = email
  data.customerID = customerID
  s3.put(capabilityKey(capability), data, callback)
}

exports.getCapability = function (capability, callback) {
  assert.equal(typeof capability, 'string')
  assert.equal(typeof callback, 'function')
  s3.get(capabilityKey(capability), callback)
}

exports.deleteCapability = function (capability, callback) {
  assert.equal(typeof capability, 'string')
  assert.equal(typeof callback, 'function')
  s3.delete(capabilityKey(capability), callback)
}

exports.putWebhook = function (data, callback) {
  assert.equal(typeof data, 'object')
  assert.equal(typeof callback, 'function')
  var id = new Date().toISOString() + '-' + uuid.v4()
  s3.put(`webhooks/${id}`, data, function (error) {
    if (error) return callback(error)
    callback(null, id)
  })
}
