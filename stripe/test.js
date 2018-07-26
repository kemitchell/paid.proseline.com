var customers

exports.clear = function () {
  customers = new Map()
}

exports.clear()

exports.VALID_TEST_SOURCE = 'valid'

exports.createCustomer = function (email, source, callback) {
  setImmediate(function () {
    if (source !== exports.VALID_TEST_SOURCE) {
      return callback(new Error('invalid source'))
    }
    var customerID = nextCustomerID()
    customers.set(customerID, {email})
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

exports.unsubscribe = function (customerID, callback) {
  setImmediate(function () {
    if (!customers.has(customerID)) {
      return callback(new Error('no such customer'))
    }
    var customer = customers.get(customerID)
    delete customer.subscriptionID
    customers.set(customerID, customer)
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
    callback(null, customer.subscriptionID || null)
  })
}

exports.VALID_TEST_SIGNATURE = 'valid'

exports.validSignature = function (request, body) {
  return body.toString() === exports.VALID_TEST_SIGNATURE
}
