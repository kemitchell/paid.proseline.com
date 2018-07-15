var AJV = require('ajv')
var Busboy = require('busboy')
var assert = require('assert')
var concatLimit = require('./concat-limit')
var fs = require('fs')
var parse = require('json-parse-errback')
var pinoHTTP = require('pino-http')
var pump = require('pump')
var runSeries = require('run-series')
var runWaterfall = require('run-waterfall')
var s3 = require('./s3')
var simpleConcat = require('simple-concat')
var sodium = require('sodium-native')
var stringify = require('fast-json-stable-stringify')
var stripe = require('./stripe')
var url = require('url')
var uuid = require('uuid')

var STYLESHEET = '/styles.css'
var STYLES = fs.readFileSync('styles.css')

var ajv = new AJV()

module.exports = function (serverLog) {
  var log = pinoHTTP({logger: serverLog, genReqId: uuid.v4})
  return function (request, response) {
    log(request, response)
    var method = request.method
    var parsed = url.parse(request.url, true)
    var pathname = parsed.pathname
    request.query = parsed.query
    if (pathname === '/') return homepage(request, response)
    if (pathname === '/subscribe') {
      if (method === 'POST') return postSubscribe(request, response)
      if (method === 'GET') return getSubscribe(request, response)
      return respond405()
    }
    if (pathname === '/add') {
      if (method === 'POST') return postAdd(request, response)
      if (method === 'GET') return getAdd(request, response)
      return respond405()
    }
    if (pathname === '/cancel') {
      if (method === 'POST') return postCancel(request, response)
      if (method === 'GET') {
        var capability = request.query.capability
        if (capability) return finishCancel(request, response)
        return startCancel(request, response)
      }
      return respond405()
    }
    if (pathname === '/publickey') {
      return response.end(process.env.PUBLIC_KEY)
    }
    if (pathname === STYLESHEET) return styles(request, response)
    if (pathname === '/webhook') return webhook(request, response)
    return notFound(request, response)
  }
}

function respond405 (request, response) {
  response.statusCode = 405
  response.end()
}

function homepage (request, response) {
  response.setHeader('Content-Type', 'text/html')
  response.end(messagePage(
    null,
    [
      'Visit <a href=/cancel>the cancel page</a> ' +
      'to cancel your subscription.'
    ]
  ))
}

var validOrder = ajv.compile(require('./schemas/order'))

function postSubscribe (request, response) {
  var log = request.log
  runWaterfall([
    function (done) {
      concatLimit(request, 512, done)
    },
    parse
  ], function (error, order) {
    if (error) {
      if (error.limit) {
        // TODO: Double check stream calls for 413.
        response.statusCode = 413
        response.end()
      } else return serverError(error)
    }
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
    var publicKey = order.publicKey
    s3.getUser(email, function (error, user) {
      if (error) return serverError(error, response)

      // There is no Stripe customer for the e-mail address.
      if (!user) {
        return runWaterfall([
          function (done) {
            stripe.createCustomer(email, token, done)
          },
          function (customerID, done) {
            s3.putUser(email, {active: false, customerID}, done)
          },
          function (_, done) {
            s3.putPublicKey(publicKey, {email, first: true}, done)
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
            var data = {type: 'subscribe'}
            s3.putCapability(email, customerID, capability, data, done)
          },
          function (done) {
            email.subscribe(request.log, email, capability, done)
          }
        ], function (error) {
          if (error) return serverError(error)
          response.end({message: 'e-mail sent'})
        })
      }
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

function getSubscribe (request, response) {
  var log = request.log
  var capability = request.query.capability
  if (!capability || !validCapability(capability)) {
    response.statusCode = 400
    return response.end()
  }
  s3.getCapability(capability, function (error, data) {
    if (error) return serverError(error)
    if (data.type !== 'subscribe') {
      response.statusCode = 400
      return response.end()
    }
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

function startCancel (request, response) {
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

function finishCancel (request, response) {
  var capability = request.query.capability
  if (!capability || !validCapability(capability)) {
    response.statusCode = 400
    return response.end()
  }
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
  message.forEach(function (element) {
    assert.equal(typeof element, 'string')
  })
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

function styles (request, response) {
  response.setHeader('Content-Type', 'text/css')
  return response.end(STYLES)
}

function webhook (request, response) {
  if (!stripe.validSignature(request)) {
    response.statusCode = 400
    response.end()
  }
  var log = request.log
  log.info('valid signature')
  runWaterfall([
    function (done) {
      simpleConcat(request, done)
    },
    parse,
    function (body, done) {
      stripe.putWebhook(body, done)
    }
  ], function (error, objectID) {
    if (error) {
      response.statusCode = 400
      return response.end()
    }
    log.info({objectID}, 'logged')
  })
}

var validAdd = ajv.compile(require('./schemas/add'))

function postAdd (request, response) {
  var log = request.log
  runWaterfall([
    function (done) {
      concatLimit(request, 512, done)
    },
    parse
  ], function (error, request) {
    if (error) {
      if (error.limit) {
        // TODO: Double check stream calls for 413.
        response.statusCode = 413
        response.end()
      } else return serverError(error)
    }
    if (!validAdd(request)) {
      return invalidRequest('invalid request')
    }
    log.info('invalid request')
    if (!validSignature(request)) {
      return invalidRequest('invalid signature')
    }
    log.info('valid signature')
    if (!unexpired(request)) {
      return invalidRequest('request expired')
    }
    log.info('unexpired')
    var email = request.message.email
    var name = request.message.name
    var publicKey = request.publicKey
    s3.getUser(email, function (error, user) {
      if (error) return serverError(error, response)
      if (!user) return response.end()
      var customerID = user.customerID
      stripe.getActiveSubscription(
        customerID,
        function (error, subscription) {
          if (error) return serverError(error, response)
          if (!subscription) return response.end()
          var capability = randomCapability()
          runSeries([
            function (done) {
              var data = {name, publicKey}
              s3.putCapability(email, customerID, capability, data, done)
            },
            function (done) {
              email.add(request.log, email, name, capability, done)
            }
          ], function (error) {
            if (error) return serverError(error)
            response.end()
          })
        }
      )
    })
  })

  function invalidRequest (message) {
    response.end(JSON.stringify({error: message}))
  }

  function serverError (error, response) {
    log.error(error)
    response.end(JSON.stringify({error: 'server error'}))
  }
}

function getAdd (request, response) {
  var log = request.log
  var capability = request.query.capability
  if (!capability || !validCapability(capability)) {
    return invalidRequest('invalid capability')
  }
  s3.getCapability(capability, function (error, data) {
    if (error) return serverError(error)
    if (data.type !== 'add') {
      return invalidRequest('invalid capability')
    }
    var email = data.email
    var name = data.name
    var publicKey = data.publicKey
    log.info(data, 'capability')
    runSeries([
      logSuccess(function (done) {
        s3.deleteCapability(capability, done)
      }, 'deleted capability'),
      logSuccess(function (done) {
        s3.putPublicKey(publicKey, {email, name}, done)
      }, 'added key')
    ], function (error) {
      if (error) return serverError(error)
      response.setHeader('Content-Type', 'text/html')
      response.end(messagePage(
        'Added Device',
        [
          `You have successfully added "${name}" to your account.`,
          'Close and reopen proseline.com on that device ' +
          'to begin sharing.'
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

  function invalidRequest (message) {
    response.end(JSON.stringify({error: message}))
  }

  function serverError (error) {
    request.log.error(error)
    response.statusCode = 500
    response.setHeader('Content-Type', 'text/html')
    response.end(serverErrorPage())
  }
}
