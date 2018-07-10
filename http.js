var AJV = require('ajv')
var Busboy = require('busboy')
var assert = require('assert')
var fs = require('fs')
var parse = require('json-parse-errback')
var pinoHTTP = require('pino-http')
var pump = require('pump')
var runSeries = require('run-series')
var runWaterfall = require('run-waterfall')
var s3 = require('./data')
var sodium = require('sodium-native')
var stringify = require('fast-json-stable-stringify')
var stripe = require('./stripe')
var url = require('url')
var uuid = require('uuid')

var STYLESHEET = '/styles.css'
var STYLES = fs.readFileSync('styles.css')

var ajv = new AJV()

// TODO Read env vars directly.

module.exports = function (serverLog) {
  var log = pinoHTTP({logger: serverLog, genReqId: uuid.v4})
  return function (request, response) {
    log(request, response)
    var parsed = url.parse(request.url, true)
    var pathname = parsed.pathname
    request.query = parsed.query
    // TODO: Move query and method routing logic up here.
    if (pathname === '/') return homepage(request, response)
    if (pathname === '/register') return register(request, response)
    if (pathname === '/subscribe') return confirm(request, response)
    if (pathname === '/cancel') return cancel(request, response)
    if (pathname === STYLESHEET) {
      response.setHeader('Content-Type', 'text/css')
      return response.end(STYLES)
    }
    notFound(request, response)
  }
}

function homepage (request, response) {
  response.setHeader('Content-Type', 'text/html')
  response.end(messagePage(
    null,
    'Visit <a href=/cancel>the cancel page</a> ' +
    'to cancel your subscription.'
  ))
}

var validOrder = ajv.compile(require('./order.json'))

var POST_BODY_LIMIT = 512

function register (request, response) {
  var log = request.log
  var chunks = []
  var bytesReceived = 0
  request
    .on('data', function (chunk) {
      chunks.push(chunk)
      bytesReceived += chunk.length
      if (bytesReceived > POST_BODY_LIMIT) {
        response.statusCode = 413
        response.end()
        request.abort()
      }
    })
    .once('error', function (error) {
      log.error(error)
    })
    .once('end', function () {
      parse(Buffer.concat(chunks), function (error, order) {
        if (error) return invalidRequest(response)
        if (!validOrder(order)) {
          return invalidRequest(response, 'invalid order')
        }
        log.info('invalid order')
        if (!validSignature(order)) {
          return invalidRequest(response, 'invalid signature')
        }
        log.info('valid signature')
        if (!unexpired(order)) {
          return invalidRequest(response, 'order expired')
        }
        log.info('unexpired')
        var email = order.message.email
        var token = order.message.token
        s3.getUser(email, function (error, user) {
          if (error) return serverError(error, response)

          // There is no Stripe customer for the e-mail address.
          if (!user) {
            return runWaterfall([
              function (done) {
                stripe.createCustomer(email, token, done)
              },
              function (customerID, done) {
                s3.putUser({active: false, customerID}, done)
              }
            ], function (error) {
              if (error) return serverError(error)
              sendEMail(customerID)
            })
          }

          // There is already a Stripe customer for the e-mail address.
          var customerID = user.customerID
          stripe.getActiveSubscription(
            customerID,
            function (error, subscription) {
              if (error) return serverError(error, response)
              if (subscription) {
                return invalidRequest(response, 'already subscribed')
              }
              sendEMail(customerID)
            }
          )

          function sendEMail (customerID) {
            var capability = randomCapability()
            runSeries([
              function (done) {
                s3.putCapability(email, customerID, capability, done)
              },
              function (done) {
                email.confirmation(request.log, email, capability, done)
              }
            ], function (error) {
              if (error) return serverError(error)
              response.end({message: 'e-mail sent'})
            })
          }
        })
      })
    })

  function invalidRequest (response, message) {
    response.end(JSON.stringify({error: message}))
  }

  function serverError (error, response) {
    log.error(error)
    response.end(JSON.stringify({error: 'server error'}))
  }
}

function randomCapability () {
  var returned = Buffer.alloc(32)
  sodium.randombytes_buf(returned)
  return returned.toString('hex')
}

function validCapability (string) {
  return /^[a-f0-9]{64}$/.test(string)
}

var ORDER_EXPIRATION_PERIOD = 7 * 24 * 60 * 60 * 1000

function unexpired (order) {
  var now = new Date()
  var date = new Date(order.message.date)
  var difference = now - date
  return difference < ORDER_EXPIRATION_PERIOD
}

function validSignature (order) {
  return sodium.crypto_sign_verify_detached(
    Buffer.from(order.signature, 'hex'),
    Buffer.from(stringify(order.message)),
    Buffer.from(order.publicKey, 'hex')
  )
}

function notFound (request, response) {
  response.statusCode = 404
  response.setHeader('Content-Type', 'text/html')
  response.end(messagePage(
    'Not Found',
    ['The page you requested does not exist.']
  ))
}

function confirm (request, response) {
  var log = request.log
  var capability = request.query.capability
  if (!capability || !validCapability(capability)) {
    response.statusCode = 400
    return response.end()
  }
  s3.getCapability(capability, function (error, data) {
    if (error) return serverError(error)
    var customerID = data.customerID
    log.info(data, 'capability')
    runSeries([
      logSuccess(function (done) {
        s3.deleteCapability(capability, done)
      }, 'deleted capability'),
      logSuccess(function (done) {
        stripe.subscribe(customerID, done)
      }, 'created subscription')
    ], function (error) {
      if (error) return serverError(error)
      response.setHeader('Content-Type', 'text/html')
      response.end(messagePage(
        'Subscribed',
        [
          'You have successfully subscribed.',
          'Close and reopen proseline.com to begin sharing.'
        ]
      ))
    })
  })

  function logSuccess (action, success) {
    return function (done) {
      action(function (error) {
        if (error) return done(error)
        log.info(success)
        done()
      })
    }
  }

  function serverError (error) {
    request.log.error(error)
    response.statusCode = 500
    response.setHeader('Content-Type', 'text/html')
    response.end(serverErrorPage())
  }
}

function cancel (request, response) {
  var method = request.method
  if (method === 'POST') return route(postCancel)
  if (method === 'GET') return route(getCancel)
  response.statusCode = 405
  response.end()

  function route (handler) {
    handler(request, response)
  }
}

function postCancel (request, response) {
  var log = request.log
  parseBody(function (error, email) {
    if (error) return serverError(error)
    log.info({email}, 'email')
    s3.getUser(email, function (error, user) {
      if (error) return serverError(error)
      if (!user) return showSuccessPage()
      var capability = randomCapability()
      email.cancel(
        log, email, capability,
        function (error) {
          if (error) return serverError(error)
          showSuccessPage()
        }
      )
    })
  })

  function parseBody (done) {
    var email
    var parser = new Busboy({
      headers: request.headers,
      limits: {
        fileNameSize: 6,
        fieldSize: 300,
        fields: 1,
        files: 0
      }
    })
      .on('field', function (name, value) {
        if (name === 'email') email = value.trim()
      })
      .once('finish', function () {
        done(null, email)
      })
    pump(request, parser, function (error) {
      if (error) return done(error)
    })
  }

  function showSuccessPage () {
    response.setHeader('Content-Type', 'text/html')
    response.end(messagePage(
      'E-Mail Sent',
      [
        'Proseline will check for a subscription under ' +
        'the e-mail address you provided, and send a link ' +
        'to cancel any subscription under it.'
      ]
    ))
  }

  function serverError (error) {
    log.error(error)
    response.statusCode = 500
    response.end(serverErrorPage())
  }
}

function getCancel (request, response) {
  var capability = request.query.capability
  if (capability) return finalizeCancellation.apply(null, arguments)
  response.setHeader('Content-Type', 'text/html')
  response.end(`
<!doctype html>
<html lang=en>
  ${headHTML()}
  <body>
    ${headerHTML()}
    <main>
      <form action=/cancel method=POST>
        <label>
          Your E-Mail Address:
          <input name=email type=email required>
        </label>
        <button type=submit>Cancel Your Subscription</button>
      </form>
      <p>
        Proseline will send an e-mail to your address with a link
        that you can use finish canceling your subscription.
      </p>
    </main>
  </body>
</html>
  `)
}

function finalizeCancellation (request, response) {
  var capability = request.query.capability
  var log = request.log
  runWaterfall([
    function getCapability (done) {
      s3.getCapability(capability, done)
    },
    function getSubscription (capability, done) {
      log.info(capability, 'capability')
      stripe.getActiveSubscription(
        capability.customerID, done
      )
    },
    function unsubscribe (subscription, done) {
      log.info(subscription, 'subscription')
      if (!subscription) {
        return done(new Error('no active subscription'))
      }
      stripe.unsubscribe(subscription.id, done)
    }
  ], function (error) {
    if (error) {
      log.error(error)
      response.statusCode = 500
      return response.end(serverErrorPage())
    }
    log.info('unsubscribed')
    response.setHeader('Content-Type', 'text/html')
    response.end(messagePage(
      'Canceled',
      ['Your subscription has been canceled.']
    ))
  })
}

function messagePage (subtitle, message) {
  assert(Array.isArray(message))
  assert(message.every(function (element) {
    assert.equal(typeof element, 'string')
  }))
  var content = message
    .map(function (string) { return `<p>${string}</p>` })
    .join('')
  return `
<!doctype html>
<html lang=en>
  ${headHTML(subtitle)}
  <body class=message>
    ${headerHTML()}
    <main>${content}</main>
  </body>
</html>
  `.trim()
}

function headHTML (subtitle) {
  return `
<head>
  <meta charset=UTF-8>
  <title>Proseline${subtitle ? ': ' + subtitle : ''}</title>
  <link rel=stylesheet href=${STYLESHEET}>
</head>
  `.trim()
}

function headerHTML () {
  return '<header><h1>Proseline</h1></header>'
}

function serverErrorPage () {
  return messagePage(
    'Server Error',
    [
      'A technical error stopped the site from ' +
      'responding to your request.'
    ]
  )
}
