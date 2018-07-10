var data = require('./data')
var stripe = require('stripe')

// TODO source for customer creation

module.exports = {
  createCustomer,
  getCustomer,
  subscribe,
  unsubscribe,
  getActiveSubscription
}

function createCustomer (configuration, email, token, callback) {
  stripe(configuration.stripe.private)
    .customers
    .create({email, token}, callback)
}

function getCustomer (configuration, customerID, callback) {
  stripe(configuration.stripe.private)
    .customers
    .retrieve(customerID, callback)
}

function subscribe (configuration, customerID, token, callback) {
  stripe(configuration.stripe.private)
    .subscriptions
    .create({
      customer: customerID,
      items: [{plan: configuration.stripe.plan}]
    }, callback)
}

function unsubscribe (configuration, subscriptionID, callback) {
  stripe(configuration.stripe.private)
    .subscriptions
    .del(subscriptionID, callback)
}

function getActiveSubscription (configuration, customerID, callback) {
  data.getCustomer(configuration, customerID, function (error, customer) {
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
