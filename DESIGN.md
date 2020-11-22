# Design

## WebSockets

The WebSocket server replicates project data using the same protocol as the client-side proseline.com web application.

## HTTP

- `GET /`: View an HTML page with a link to `/cancel`.

- `POST /subscribe`:  Request an e-mail with a link to subscribe.  The link takes the form `/subscribe?capability={capability}`.

- `GET /subscribe`: Confirm a new subscription.

- `POST /add`:  Request an e-mail with a link to confirm adding a client public key to a subscription.  The link takes the form `/add?capability={capability}`.

- `GET /add`: Confirm addition of a new client public key to a subscription.

- `POST /encryptionkey`:  Request the server's encrypted copy of the customer's secret encryption key.

- `GET /publickey`:  Fetch the server's public signing key.

- `POST /invitations`:  Request copies of all stored invitations.

- `POST /invitation`:  Store an invitation.

- `POST /webhook`:  Receive Stripe event messages.

- `POST /cancel`:  Request an e-mail with a link to cancel a subscription.  The links takes the form `/cancel?capability={capability}`.

- `GET /cancel`:  Confirm cancellation of a subscription.

## Data Layout

The server persists data to an S3-compatible API.

The server relies heavily on `listObjects` calls with `Delimiter`, `Prefix`, and `MaxKeys` arguments, in effect "indexing" multiple unique keys by path-like prefixes.  When order is important, as for the envelopes in a log, their key suffixes maintain lexical order.  Index `1` becomes suffix `000000000000001`.

For example, `listObjects(Delimiter="/", Prefix="projects/{discovery key}/logPublicKeys/")` yields a list of logs for a project, and `listObjects(Delimiter="/", Prefix="projects/{discovery key}/envelopes/{log public key}/")` yields a list of envelopes in a log.

```
projects/{discovery key}/
  keys
    -> project discovery key
    -> replicaton key
    -> read key ciphertext
    -> read key nonce
  users/{e-mail address}
    -> date
  logPublicKeys/{log public key}
  envelopes/{log public key}/{15-digit, zero-padded index}
    -> envelope

users/{e-mail address}
  -> Object
  projects/{discovery key}

clientPublicKeys/{client public key}
  -> date

capabilities/{capability}
  -> Object
  -> date
  -> e-mail address
  -> customer ID

webhooks/{id}
  -> message
```
