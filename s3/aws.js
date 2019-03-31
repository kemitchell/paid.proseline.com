var assert = require('assert')
var aws = require('aws-sdk')
var parse = require('json-parse-errback')

var DELIMITER = exports.DELIMITER = '/'
var BUCKET = process.env.S3_BUCKET

var s3 = new aws.S3({
  accessKeyId: process.env.S3_ACCESS_KEY,
  secretAccessKey: process.env.S3_SECRET_KEY
})

exports.first = function (prefix, callback) {
  s3.listObjects({
    Bucket: BUCKET,
    Delimiter: DELIMITER,
    Prefix: prefix,
    MaxKeys: 1
  }, function (error, data) {
    if (error) {
      if (error.code === 'NoSuchKey') return callback(null, 0)
      return callback(error)
    }
    var contents = data.Contents
    if (contents.length === 0) return callback(null, undefined)
    callback(null, contents[0].Key)
  })
}

exports.delete = function (key, callback) {
  s3.deleteObject({ Bucket: BUCKET, Key: key }, callback)
}

exports.get = function (key, callback) {
  s3.getObject({
    Bucket: BUCKET,
    Key: key
  }, function (error, data) {
    if (error) {
      if (error.code === 'NoSuchKey') return callback(null, undefined)
      return callback(error)
    }
    parse(data.Body, callback)
  })
}

var ServerSideEncryption = 'AES256'

exports.put = function (key, value, callback) {
  assert.strictEqual(typeof key, 'string')
  assert(value !== undefined)
  assert.strictEqual(typeof callback, 'function')
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

exports.list = function (prefix, callback) {
  assert.strictEqual(typeof prefix, 'string')
  assert.strictEqual(typeof callback, 'function')
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
