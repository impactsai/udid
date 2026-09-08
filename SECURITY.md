# Security considerations

## Treat the credential as a decision, not a spending credential

UDID carries a signed evaluator statement. It MUST NOT be accepted as a wallet authorization, facilitator instruction, or replacement for a capability/delegation check. A positive decision should be insufficient unless all independently required authority and x402 checks pass.

## Bind every economic input

The decision must bind to a canonical digest of the selected x402 `PaymentRequirements`, then repeat the resource, network, asset, recipient, and atomic amount. Comparing only a human-readable payment description permits substitution attacks.

## Verify in the safe order

Validate inputs, credential signature, issuer trust, verification method authorization, time, status, policy, binding, holder proof, and authority before calling payment verification or settlement. Any failure must stop the resource and payment flow. Do not call a facilitator speculatively with a credential that has not passed local checks.

## Prevent replay atomically

Store an atomic consumption key based on issuer, decision identifier, and offer identifier. The key must cover the period in which the payment authorization can settle. A cache-only or eventual-consistency approach can permit double fulfillment.

## Make trust policy explicit

A signature proves control of a key, not that its holder may make payment decisions. Resource servers need an allowlist or other auditable trust policy for issuers, policy authorities, proof formats, algorithms, DID methods, and credential-status mechanisms. Fail closed when resolution is unavailable unless an explicitly documented risk policy permits otherwise.

## Avoid privacy leaks

Do not put raw evidence, personal data, account balances, or full policy inputs in an indiscriminately disclosed credential. Use opaque subject IDs, reason codes, encrypted evidence references, and audience-bound presentations where appropriate. Log decision and payment identifiers carefully; logs often become a correlation channel.

## Separate settlement

The final decision and the settlement result have different truth conditions. A settlement failure does not invalidate the original decision, and an approved decision does not prove settlement. Record a separate receipt with an idempotent correlation key.
