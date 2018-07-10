var data = require('./s3')
var stripe = require('stripe')

// TODO: Implement Stripe webhook for payment failure.
// var SECRET = process.env.STRIPE_WEBHOOK_SECRET

var PRIVATE = process.env.STRIPE_PRIVATE_KEY
var PLAN = process.env.STRIPE_PLAN
var WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET

var client = stripe(PRIVATE)

module.exports = {
  createCustomer,
  getCustomer,
  subscribe,
  unsubscribe,
  getActiveSubscription,
  validSignature
}

function createCustomer (email, token, callback) {
  client
    .customers
    .create({email, token}, callback)
}

function getCustomer (customerID, callback) {
  client
    .customers
    .retrieve(customerID, callback)
}

function subscribe (customerID, token, callback) {
  client
    .subscriptions
    .create({
      customer: customerID,
      items: [{plan: PLAN}]
    }, callback)
}

function unsubscribe (subscriptionID, callback) {
  client
    .subscriptions
    .del(subscriptionID, callback)
}

function getActiveSubscription (customerID, callback) {
  data.getCustomer(customerID, function (error, customer) {
    if (error) return callback(error)
    var subscriptions = customer.subscriptions.data
    var active = subscriptions.filter(function (subscription) {
      return subscription.active
    })
    var length = active.length
    if (length === 0) return callback(null, null)
    if (length > 1) {
      var multipleError = new Error('multiple active subscriptions')
      multipleError.multiple = true
      return callback(multipleError)
    }
    return callback(null, active[0])
  })
}

function validSignature (request) {
  try {
    client
      .webhooks
      .constructEvent(
        request.body,
        request.headers['stripe-signature'],
        WEBHOOK_SECRET
      )
  } catch (error) {
    return false
  }
  return true
}
