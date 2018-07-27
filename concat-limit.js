module.exports = function (stream, limit, callback) {
  var chunks = []
  var bytesReceived = 0
  stream
    .on('data', function (chunk) {
      chunks.push(chunk)
      bytesReceived += chunk.length
      if (bytesReceived > limit) {
        stream.pause()
        var error = new Error('exceeded limit')
        error.limit = true
        callback(error)
      }
    })
    .once('error', function (error) {
      callback(error)
    })
    .once('end', function () {
      var body = Buffer.concat(chunks)
      callback(null, body)
    })
}
