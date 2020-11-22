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
