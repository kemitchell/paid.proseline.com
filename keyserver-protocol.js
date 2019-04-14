var assert = require('assert')
var sodium = require('sodium-native')

var testing = process.env.NODE_ENV === 'test'

module.exports = require('keyserver-protocol')({
  clientStretch: function (options) {
    var password = options.password
    var salt = options.salt
    var returned = Buffer.alloc(32)
    sodium.crypto_pwhash(
      returned, password, salt,
      sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE,
      sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE,
      sodium.crypto_pwhash_ALG_DEFAULT
    )
    return returned
  },

  serverStretchSaltLength: 32,

  serverStretch: function (options) {
    var password = options.password
    var salt = options.salt
    var returned = Buffer.alloc(32)
    sodium.crypto_pwhash(
      returned, password, salt,
      testing
        ? sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE
        : /* istanbul ignore next */ sodium.crypto_pwhash_OPSLIMIT_MODERATE,
      testing
        ? sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE
        : /* istanbul ignore next */ sodium.crypto_pwhash_MEMLIMIT_MODERATE,
      sodium.crypto_pwhash_ALG_DEFAULT
    )
    return returned
  },

  authenticationToken: {
    subkey: 1,
    context: Buffer.from('authTokn')
  },

  verificationHash: {
    subkey: 2,
    context: Buffer.from('verifHsh')
  },

  serverKey: {
    subkey: 3,
    context: Buffer.from('serverKy')
  },

  clientKey: {
    subkey: 4,
    context: Buffer.from('clientKy')
  },

  requestAuthenticationKey: {
    subkey: 5,
    context: Buffer.from('reqAthKy')
  },

  responseAuthenticationKey: {
    subkey: 6,
    context: Buffer.from('resAthKy')
  },

  responseEncryptionKey: {
    subkey: 7,
    context: Buffer.from('resEncKy')
  },

  keyRequestToken: {
    subkey: 8,
    context: Buffer.from('kyReqTkn')
  },

  tokenID: {
    subkey: 9,
    context: Buffer.from('token-ID')
  },

  deriveKey: function (options) {
    var key = options.key
    var subkey = options.subkey
    var context = options.context
    var returned = Buffer.alloc(options.length || 32)
    assert(returned.length >= sodium.crypto_kdf_BYTES_MIN)
    assert(returned.length <= sodium.crypto_kdf_BYTES_MAX)
    assert(context.length === sodium.crypto_kdf_CONTEXTBYTES)
    assert(key.length === sodium.crypto_kdf_KEYBYTES)
    sodium.crypto_kdf_derive_from_key(
      returned, subkey, context, key
    )
    return returned
  },

  authenticate: function (options) {
    var key = options.key
    var input = options.input
    var returned = Buffer.alloc(sodium.crypto_auth_BYTES)
    sodium.crypto_auth(returned, input, key)
    return returned
  },

  random: random,

  generateUserID: function () { return random(32) },

  generateToken: function () { return random(32) }
})

function random (size) {
  var returned = Buffer.alloc(size)
  sodium.randombytes_buf(returned)
  return returned
}
