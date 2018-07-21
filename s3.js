var assert = require('assert')
var aws = require('aws-sdk')
var indices = require('./indices')
var parse = require('json-parse-errback')
var runWaterfall = require('run-waterfall')
var uuid = require('uuid')

var DELIMITER = '/'

var BUCKET = process.env.S3_BUCKET

var s3 = new aws.S3({
  accessKeyId: process.env.S3_ACCESS_KEY,
  secretAccessKey: process.env.S3_SECRET_KEY
})

function projectKey (discoveryKey) {
  assert.equal(typeof discoveryKey, 'string')
  return `projects/${discoveryKey}`
}

exports.listProjectPublicKeys = function (discoveryKey, callback) {
  assert.equal(typeof discoveryKey, 'string')
  assert.equal(typeof callback, 'function')
  var prefix = `${projectKey(discoveryKey)}/publicKeys/`
  listAllKeys(prefix, function (error, keys) {
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
    `${projectKey(discoveryKey)}` +
    `/envelopes/${publicKey}/${indices.stringify(index)}`
  )
}

exports.getLastIndex = function (discoveryKey, publicKey, callback) {
  assert.equal(typeof discoveryKey, 'string')
  assert.equal(typeof publicKey, 'string')
  assert.equal(typeof callback, 'function')
  s3.listObjects({
    Bucket: BUCKET,
    Delimiter: DELIMITER,
    Prefix: `${projectKey(discoveryKey)}/envelopes/${publicKey}/`,
    MaxKeys: 1
  }, function (error, data) {
    if (error) {
      if (error.code === 'NoSuchKey') return callback(null, 0)
      return callback(error)
    }
    var contents = data.Contents
    if (contents.length === 0) return callback(null, undefined)
    var key = contents[0].split(DELIMITER)[4]
    callback(null, indices.parse(key))
  })
}

exports.getEnvelope = function (discoveryKey, publicKey, index, callback) {
  assert.equal(typeof discoveryKey, 'string')
  assert.equal(typeof publicKey, 'string')
  assert.equal(typeof index, 'number')
  assert.equal(typeof callback, 'function')
  getJSONObject(
    envelopeKey(discoveryKey, publicKey, index), callback
  )
}

exports.putEnvelope = function (envelope, callback) {
  assert.equal(typeof envelope, 'object')
  assert(envelope.hasOwnProperty('message'))
  assert(envelope.hasOwnProperty('publicKey'))
  assert(envelope.hasOwnProperty('signature'))
  assert(envelope.message.hasOwnProperty('project'))
  assert(envelope.message.hasOwnProperty('index'))
  assert.equal(typeof callback, 'function')
  putJSONObject(
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
  getJSONObject(projectKeysKey(discoveryKey), callback)
}

exports.putProjectKeys = function (discoveryKey, replicationKey, writeSeed, callback) {
  assert.equal(typeof discoveryKey, 'string')
  assert.equal(typeof replicationKey, 'string')
  assert.equal(typeof writeSeed, 'string')
  assert.equal(typeof callback, 'function')
  putJSONObject(
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
  putJSONObject(
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
  putJSONObject(
    userProjectKey(email, discoveryKey),
    {date: new Date().toISOString()},
    callback
  )
}

exports.listUserProjects = function (email, callback) {
  assert.equal(typeof email, 'string')
  assert.equal(typeof callback, 'function')
  var prefix = `${userKey(email)}/projects/`
  listAllKeys(prefix, function (error, keys) {
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
  getJSONObject(publicKeyKey(publicKey), callback)
}

exports.putPublicKey = function (publicKey, data, callback) {
  assert.equal(typeof publicKey, 'string')
  assert.equal(typeof data, 'object')
  assert.equal(typeof callback, 'function')
  data.date = new Date().toISOString()
  putJSONObject(publicKeyKey(publicKey), data, callback)
}

function userKey (email) {
  assert.equal(typeof email, 'string')
  return `users/${encodeURIComponent(email)}`
}

exports.getUser = function (email, callback) {
  assert.equal(typeof email, 'string')
  assert.equal(typeof callback, 'function')
  getJSONObject(userKey(email), callback)
}

exports.putUser = function (email, data, callback) {
  assert.equal(typeof email, 'string')
  assert.equal(typeof data, 'object')
  assert.equal(typeof callback, 'function')
  data.email = email
  putJSONObject(userKey(email), data, callback)
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
  putJSONObject(capabilityKey(capability), data, callback)
}

exports.getCapability = function (capability, callback) {
  assert.equal(typeof capability, 'string')
  assert.equal(typeof callback, 'function')
  getJSONObject(capabilityKey(capability), callback)
}

exports.deleteCapability = function (capability, callback) {
  assert.equal(typeof capability, 'string')
  assert.equal(typeof callback, 'function')
  s3.deleteObject({
    Bucket: BUCKET,
    Key: capabilityKey(capability)
  }, callback)
}

exports.putWebhook = function (data, callback) {
  assert.equal(typeof data, 'object')
  assert.equal(typeof callback, 'function')
  var id = new Date().toISOString() + '-' + uuid.v4()
  putJSONObject(`webhooks/${id}`, data, function (error) {
    if (error) return callback(error)
    callback(null, id)
  })
}

function getJSONObject (key, callback) {
  assert.equal(typeof key, 'string')
  assert.equal(typeof callback, 'function')
  runWaterfall([
    function (done) {
      s3.getObject({
        Bucket: BUCKET,
        Key: key
      }, function (error, data) {
        if (error) return done(error)
        done(null, data.Body)
      })
    },
    parse
  ], function (error, result) {
    if (error) {
      if (error.code === 'NoSuchKey') return callback(null, null)
      return callback(error)
    }
    callback(null, result)
  })
}

var ServerSideEncryption = 'AES256'

function putJSONObject (key, value, callback) {
  assert.equal(typeof key, 'string')
  assert(value)
  assert.equal(typeof callback, 'function')
  s3.putObject({
    Bucket: BUCKET,
    Key: key,
    Body: Buffer.from(JSON.stringify(value)),
    ContentType: 'application/json',
    ServerSideEncryption
  }, function (error) {
    if (error) return callback(error)
    callback()
  })
}

function listAllKeys (prefix, callback) {
  assert.equal(typeof prefix, 'string')
  assert.equal(typeof callback, 'function')
  recurse(false, callback)
  function recurse (marker, done) {
    var options = {
      Bucket: BUCKET,
      Delimiter: DELIMITER,
      Prefix: prefix
    }
    if (marker) options.Marker = marker
    s3.listObjects(options, function (error, data) {
      if (error) {
        if (error.code === 'NoSuchKey') return callback(null, [])
        return callback(error)
      }
      var contents = data.Contents.map(function (element) {
        return element.Key
      })
      if (data.IsTruncated) {
        return recurse(data.NextMarker, function (error, after) {
          if (error) return done(error)
          done(null, contents.concat(after))
        })
      }
      done(null, contents)
    })
  }
}
