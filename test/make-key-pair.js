var sodium = require('sodium-native')

module.exports = function makeKeyPair () {
  var secretKey = Buffer.alloc(sodium.crypto_sign_SECRETKEYBYTES)
  var publicKey = Buffer.alloc(sodium.crypto_sign_PUBLICKEYBYTES)
  sodium.crypto_sign_keypair(publicKey, secretKey)
  return { publicKey, secretKey }
}
