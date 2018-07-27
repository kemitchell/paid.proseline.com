var constants = require('../test/constants')

var customers

exports.clear = function () {
  customers = new Map()
}

exports.clear()

exports.createCustomer = function (email, source, callback) {
  setImmediate(function () {
    if (source !== constants.VALID_STRIPE_SOURCE) {
      return callback(new Error('invalid source'))
    }
    var customerID = nextCustomerID()
    customers.set(customerID, {email, customerID})
    callback(null, customerID)
  })
}

var customerCounter = 0

function nextCustomerID () {
  var suffix = String(++customerCounter).padStart(14, '0')
  return 'cus_' + suffix
}

exports.getCustomer = function (customerID, callback) {
  setImmediate(function () {
    callback(null, customers.get(customerID))
  })
}

exports.subscribe = function (customerID, callback) {
  setImmediate(function () {
    if (!customers.has(customerID)) {
      return callback(new Error('no such customer'))
    }
    var customer = customers.get(customerID)
    var subscriptionID = nextSubscriptionID()
    customer.subscriptionID = subscriptionID
    customers.set(customerID, customer)
    callback(null, subscriptionID)
  })
}

exports.unsubscribe = function (subscriptionID, callback) {
  setImmediate(function () {
    var customer = Array.from(customers.values()).find(function (customer) {
      return customer.subscriptionID === subscriptionID
    })
    if (!customer) return callback(new Error('no such subscription'))
    delete customer.subscriptionID
    customers.set(customer.customerID, customer)
    callback()
  })
}

var subscriptionCounter = 0

function nextSubscriptionID () {
  var suffix = String(++subscriptionCounter).padStart(14, '0')
  return 'sub_' + suffix
}

exports.getActiveSubscription = function (customerID, callback) {
  setImmediate(function () {
    if (!customers.has(customerID)) {
      return callback(new Error('no such customer'))
    }
    var customer = customers.get(customerID)
    callback(null, customer.subscriptionID ? {id: customer.subscriptionID} : null)
  })
}

exports.validSignature = function (request, body) {
  return request.headers['stripe-signature'] === constants.VALID_STRIPE_SIGNATURE
}
