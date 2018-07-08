var pinoHTTP = require('pino-http')
var uuid = require('uuid')

module.exports = function (configuration) {
  var log = pinoHTTP({logger: configuration.log, genReqId: uuid.v4})
  return function (request, response) {
    log(request, response)
    response.end()
  }
}
