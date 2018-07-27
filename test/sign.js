var sodium = require('sodium-native')
var stringify = require('fast-json-stable-stringify')

module.exports = function (data, secretKey) {
  var signature = Buffer.alloc(sodium.crypto_sign_BYTES)
  sodium.crypto_sign_detached(signature, Buffer.from(stringify(data)), secretKey)
  return signature
}
