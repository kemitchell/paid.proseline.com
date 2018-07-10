var assert = require('assert')
var indices = require('./indices')
var parse = require('json-parse-errback')
var runWaterfall = require('run-waterfall')

var DELIMITER = '/'

function projectKey (discoveryKey) {
  return `projects/${discoveryKey}`
}

exports.listProjectPublicKeys = function (s3, discoveryKey, callback) {
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

exports.getLastIndex = function (s3, discoveryKey, publicKey, callback) {
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

exports.getEnvelope = function (s3, discoveryKey, publicKey, index, callback) {
  getJSONObject(
    s3, envelopeKey(discoveryKey, publicKey, index), callback
  )
}

exports.putEnvelope = function (s3, envelope, callback) {
  putJSONObject(
    s3,
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

exports.getProjectSecretKey = function (s3, discoveryKey, callback) {
  getJSONObject(s3, projectSecretKeyKey(discoveryKey), callback)
}

exports.putProjectSecretKey = function (s3, discoveryKey, secretKey, callback) {
  putJSONObject(
    s3, projectSecretKeyKey(discoveryKey), secretKey, callback
  )
}

function projectUserKey (discoveryKey, email) {
  return `${projectKey(discoveryKey)}/users/${encodeURIComponent(email)}`
}

exports.putProjectUser = function (s3, discoveryKey, email, callback) {
  putJSONObject(
    s3,
    projectUserKey(discoveryKey, email),
    {date: new Date().toISOString()},
    callback
  )
}

function userProjectKey (s3, discoveryKey, email) {
  return `${userKey(email)}/projects/${discoveryKey}`
}

exports.putUserProject = function (s3, discoveryKey, email, callback) {
  putJSONObject(
    s3,
    userProjectKey(discoveryKey, email),
    {date: new Date().toISOString()},
    callback
  )
}

function publicKeyKey (publicKey) {
  return `/publicKeys/${publicKey}`
}

exports.getPublicKey = function (s3, publicKey, callback) {
  getJSONObject(s3, publicKeyKey(publicKey), callback)
}

function userKey (email) {
  return `users/${encodeURIComponent(email)}`
}

exports.getUser = function (s3, email, callback) {
  getJSONObject(s3, userKey(email), callback)
}

function capabilityKey (capability) {
  return `capabilities/${capability}`
}

exports.putCapability = function (s3, email, customerID, capability, callback) {
  var date = new Date().toISOString()
  var object = {date, email, customerID}
  putJSONObject(s3, capabilityKey(capability), object, callback)
}

exports.getCapability = function (s3, capability, callback) {
  getJSONObject(s3, capabilityKey(capability), callback)
}

exports.deleteCapability = function (s3, capability, callback) {
  s3.deleteObject({Key: capabilityKey(capability)}, callback)
}

function getJSONObject (s3, key, callback) {
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

function putJSONObject (s3, key, value, callback) {
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
