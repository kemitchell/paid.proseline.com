var stripe = require('../stripe/test')
var tape = require('tape')

tape.skip('stripe mock', function (suite) {
  stripe.clear()

  suite.test('create and get customer', function (test) {
    stripe.clear()
    var email = 'test@example.com'
    var source = stripe.VALID_TEST_SOURCE
    stripe.createCustomer(email, source, function (error, customerID) {
      test.ifError(error, 'no error creating')
      test.equal(typeof customerID, 'string', 'customer id is string')
      stripe.getCustomer(customerID, function (error, customer) {
        test.ifError(error, 'no error getting')
        test.equal(customer.email, email, 'email matches')
        test.end()
      })
    })
  })

  suite.test('subscriptions', function (test) {
    stripe.clear()
    var email = 'test@example.com'
    var source = stripe.VALID_TEST_SOURCE
    stripe.createCustomer(email, source, function (error, customerID) {
      test.ifError(error, 'no error creating')
      test.equal(typeof customerID, 'string', 'customer id is string')
      stripe.subscribe(customerID, function (error, subscriptionID) {
        test.ifError(error, 'no error subscribing')
        test.equal(typeof subscriptionID, 'string', 'subscription id is string')
        stripe.getActiveSubscription(customerID, function (error, otherID) {
          test.ifError(error, 'no error getting active')
          test.equal(subscriptionID, otherID, 'same subscription id')
          stripe.unsubscribe(customerID, function (error) {
            test.ifError(error, 'no error unsubscribing')
            stripe.getActiveSubscription(customerID, function (error, subscriptionID) {
              test.ifError(error, 'no error getting active')
              test.equal(subscriptionID, null, 'null subscription id')
              test.end()
            })
          })
        })
      })
    })
  })
})
