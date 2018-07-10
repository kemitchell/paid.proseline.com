var assert = require('assert')
var aws = require('aws-sdk')
var indices = require('./indices')
var parse = require('json-parse-errback')
var runWaterfall = require('run-waterfall')
var uuid = require('uuid')

var DELIMITER = '/'

var s3 = new aws.S3({
  accessKeyId: process.env.S3_ACCESS_KEY,
  secretAccessKey: process.env.S3_SECRET_KEY
})

function projectKey (discoveryKey) {
  return `projects/${discoveryKey}`
}

exports.listProjectPublicKeys = function (discoveryKey, callback) {
  var prefix = `${projectKey(discoveryKey)}/publicKeys/`
  recurse(false, callback)
  function recurse (marker, done) {
    var options = {Delimiter: DELIMITER, Prefix: prefix}
    if (marker) options.Marker = marker
    s3.listObjects(options, function (error, data) {
      if (error) return callback(error)
      var contents = data.Contents.map(function (element) {
        return element.Key.split(DELIMITER)[3]
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

function envelopeKey (discoveryKey, publicKey, index) {
  return (
    `${projectKey(discoveryKey)}` +
    `/envelopes/${publicKey}/${indices.stringify(index)}`
  )
}

exports.getLastIndex = function (discoveryKey, publicKey, callback) {
  s3.listObjects({
    Delimiter: DELIMITER,
    Prefix: `${projectKey(discoveryKey)}/envelopes/${publicKey}/`,
    MaxKeys: 1
  }, function (error, data) {
    if (error) return callback(error)
    var contents = data.Contents
    if (contents.length === 0) return callback(null, undefined)
    var key = contents[0].split(DELIMITER)[4]
    callback(null, indices.parse(key))
  })
}

exports.getEnvelope = function (discoveryKey, publicKey, index, callback) {
  getJSONObject(
    envelopeKey(discoveryKey, publicKey, index), callback
  )
}

exports.putEnvelope = function (envelope, callback) {
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

function projectSecretKeyKey (discoveryKey) {
  return `${projectKey(discoveryKey)}/secretKey`
}

exports.getProjectSecretKey = function (discoveryKey, callback) {
  getJSONObject(projectSecretKeyKey(discoveryKey), callback)
}

exports.putProjectSecretKey = function (discoveryKey, secretKey, callback) {
  putJSONObject(
    projectSecretKeyKey(discoveryKey), secretKey, callback
  )
}

function projectUserKey (discoveryKey, email) {
  return `${projectKey(discoveryKey)}/users/${encodeURIComponent(email)}`
}

exports.putProjectUser = function (discoveryKey, email, callback) {
  putJSONObject(
    projectUserKey(discoveryKey, email),
    {date: new Date().toISOString()},
    callback
  )
}

function userProjectKey (discoveryKey, email) {
  return `${userKey(email)}/projects/${discoveryKey}`
}

exports.putUserProject = function (discoveryKey, email, callback) {
  putJSONObject(
    userProjectKey(discoveryKey, email),
    {date: new Date().toISOString()},
    callback
  )
}

function publicKeyKey (publicKey) {
  return `/publicKeys/${publicKey}`
}

exports.getPublicKey = function (publicKey, callback) {
  getJSONObject(publicKeyKey(publicKey), callback)
}

function userKey (email) {
  return `users/${encodeURIComponent(email)}`
}

exports.getUser = function (email, callback) {
  getJSONObject(userKey(email), callback)
}

function capabilityKey (capability) {
  return `capabilities/${capability}`
}

exports.putCapability = function (email, customerID, capability, callback) {
  var date = new Date().toISOString()
  var object = {date, email, customerID}
  putJSONObject(capabilityKey(capability), object, callback)
}

exports.getCapability = function (capability, callback) {
  getJSONObject(capabilityKey(capability), callback)
}

exports.deleteCapability = function (capability, callback) {
  s3.deleteObject({Key: capabilityKey(capability)}, callback)
}

exports.putWebhook = function (data, callback) {
  var id = new Date().toISOString() + '-' + uuid.v4()
  putJSONObject(`webhooks/${id}`, data, function (error) {
    if (error) return callback(error)
    callback(null, id)
  })
}

function getJSONObject (key, callback) {
  assert(s3)
  assert.equal(typeof key, 'string')
  assert.equal(typeof callback, 'function')
  runWaterfall([
    function (done) {
      s3.getObject({Key: key}, function (error, data) {
        if (error) return done(error)
        done(null, data.Body)
      })
    },
    parse
  ], callback)
}

var ServerSideEncryption = 'AES256'

function putJSONObject (key, value, callback) {
  assert(s3)
  assert.equal(typeof key, 'string')
  assert(value)
  assert.equal(typeof callback, 'function')
  s3.putObject({
    Key: key,
    Body: Buffer.from(JSON.stringify(value)),
    ContentType: 'application/json',
    ServerSideEncryption
  }, function (error) {
    if (error) return callback(error)
    callback()
  })
}
