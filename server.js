var aws = require('aws-sdk')
var handler = require('./index')
var pino = require('pino')
var ws = require('ws')

var configuration = {
  log: pino(),
  s3: aws.S3({
    accessKeyId: process.env.S3_ACCESS_KEY,
    secretAccessKey: process.env.S3_SECRET_KEY
  })
}

/* eslint-disable no-new */
new ws.Server({
  port: process.env.PORT ? parseInt(process.env.PORT) : 8080,
  perMessageDeflate: false
}, handler(configuration))
