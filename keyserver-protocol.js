var assert = require('assert')
var sodium = require('sodium-native')
var xor = require('./xor')

var testing = process.env.NODE_ENV === 'test'

function clientStretch (options) {
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
}

var serverStretchSaltLength = 32

function serverStretch (options) {
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
}

// Key Derivation Parameters

var authenticationTokenParameters = {
  subkey: 1,
  context: Buffer.from('authTokn')
}

var verificationHashParameters = {
  subkey: 2,
  context: Buffer.from('verifHsh')
}

var serverKeyParameters = {
  subkey: 3,
  context: Buffer.from('serverKy')
}

var clientKeyParameters = {
  subkey: 4,
  context: Buffer.from('clientKy')
}

function deriveKey (options) {
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
}

function random (size) {
  var returned = Buffer.alloc(size)
  sodium.randombytes_buf(returned)
  return returned
}

module.exports = {
  client: {
    login: clientLogin,
    request: clientRequest
  },
  server: {
    register: serverRegister,
    login: serverLogin,
    request: serverRequest
  }
}

function clientLogin (input) {
  assert(typeof input === 'object')

  var password = input.password
  assert(typeof password === 'string')
  assert(password.length > 0)
  var passwordBuffer = Buffer.from(password, 'utf8')

  var email = input.email
  assert(typeof email === 'string')
  assert(email.length > 0)
  assert(email.indexOf('@') > 1)
  var emailBuffer = Buffer.from(email, 'utf8')

  var clientStretchedPassword = clientStretch({
    password: passwordBuffer,
    salt: emailBuffer
  })
  var authenticationToken = deriveKeyHelper(
    clientStretchedPassword, authenticationTokenParameters
  )

  return {
    authenticationToken,
    clientStretchedPassword
  }
}

function clientRequest (input) {
  assert(typeof input === 'object')

  var clientStretchedPassword = input.clientStretchedPassword
  assert(Buffer.isBuffer(clientStretchedPassword))
  assert(clientStretchedPassword.byteLength > 0)

  var clientWrappedKey = input.clientStretchedPassword
  assert(Buffer.isBuffer(clientWrappedKey))
  assert(clientWrappedKey.byteLength > 0)

  var clientKey = deriveKeyHelper(
    clientStretchedPassword, clientKeyParameters
  )

  var encryptionKey = xor(clientWrappedKey, clientKey)

  return { encryptionKey }
}

function serverRegister (input) {
  assert(typeof input === 'object')

  var clientStretchedPassword = input.clientStretchedPassword
  assert(Buffer.isBuffer(clientStretchedPassword))
  assert(clientStretchedPassword.byteLength > 0)

  var authenticationToken = input.authenticationToken
  assert(Buffer.isBuffer(authenticationToken))
  assert(authenticationToken.byteLength > 0)

  var authenticationSalt = random(serverStretchSaltLength)
  var serverStretchedPassword = serverStretch({
    password: authenticationToken,
    salt: authenticationSalt
  })
  var verificationHash = deriveKeyHelper(
    serverStretchedPassword, verificationHashParameters
  )
  var serverWrappedKey = random(32)

  return {
    authenticationSalt,
    serverWrappedKey,
    verificationHash,
    serverStretchedPassword
  }
}

function serverLogin (input) {
  assert(typeof input === 'object')

  var authenticationToken = input.authenticationToken
  assert(Buffer.isBuffer(authenticationToken))
  assert(authenticationToken.byteLength > 0)

  var authenticationSalt = input.authenticationSalt
  assert(Buffer.isBuffer(authenticationSalt))
  assert(authenticationSalt.byteLength > 0)

  var storedVerificationHash = input.verificationHash
  assert(Buffer.isBuffer(storedVerificationHash))
  assert(storedVerificationHash.byteLength > 0)

  var serverStretchedPassword = serverStretch({
    password: authenticationToken,
    salt: authenticationSalt
  })

  var computedVerificationHash = deriveKeyHelper(
    serverStretchedPassword, verificationHashParameters
  )

  return storedVerificationHash.equals(computedVerificationHash)
}

function serverRequest (input) {
  assert(typeof input === 'object')

  var serverStretchedPassword = input.serverStretchedPassword
  assert(Buffer.isBuffer(serverStretchedPassword))
  assert(serverStretchedPassword.byteLength > 0)

  var serverWrappedKey = input.serverWrappedKey
  assert(Buffer.isBuffer(serverWrappedKey))
  assert(serverWrappedKey.byteLength > 0)

  var parameters = { key: serverStretchedPassword }
  Object.assign(parameters, serverKeyParameters)
  var serverKey = deriveKeyHelper(
    serverStretchedPassword, serverKeyParameters
  )
  var clientWrappedKey = xor(serverKey, serverWrappedKey)
  return { clientWrappedKey }
}

function deriveKeyHelper (key, parameters) {
  assert(Buffer.isBuffer(key))
  assert(typeof parameters === 'object')
  return deriveKey(Object.assign({ key }, parameters))
}
