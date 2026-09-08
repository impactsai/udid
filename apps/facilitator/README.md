# x402 payment facilitator reference

A TypeScript application that independent operators can deploy to their own Cloudflare account. It verifies payment authorizations, optionally requires UCAN authority and/or a UDID decision, and submits payments through an operator-configured EVM RPC or Stripe account.

This application implements the [repository's draft UDID profile](../../SPECIFICATION.md). Operators choose their issuers, policy bytes, verification keys, payment limits and providers. No IXO service, shared signing key, hosted facilitator, or model is required.

| Boundary | Implemented behavior |
| --- | --- |
| Payment protocol | x402 v2 `paymentRequirements`, `paymentPayload`, `isValid`, `success`, `transaction`, `/supported` |
| Crypto | `exact` EIP-3009, EIP-712 signatures, 65-byte EOA signatures, configured EVM networks and token contracts |
| Fiat | Custom `stripe-manual-capture` scheme on `stripe:test` or `stripe:live`; retrieve and capture an already authorized PaymentIntent |
| Authority | Optional UCAN **0.8.1** with Ed25519 `did:key`, a linear inline proof chain and exact offer capability |
| Decision | Optional EdDSA `vc+jwt` securing a VC 2.0 DecisionToPayCredential, using the draft's `jwt_vc_json` format label |
| Holder | Explicit bearer mode or negotiated signed `vp+jwt` with pinned authentication keys |
| Persistence | SQLite-backed Durable Object: offers, atomic consumption, budget reservations, signed transactions and receipts |

The three artifacts have separate meanings: UCAN delegates an action; UDID asserts an evaluator's decision; the rail authorization permits value movement. Successful verification is read-only and does not guarantee that later settlement will succeed.

## Run and validate

Use Node 22 or newer. From this directory:

```sh
npm ci
npm run check
```

`check` typechecks, runs cryptographic and adapter tests, builds the Worker, and tests the bundle in Miniflare/workerd with SQLite persistence. Payment providers in tests are mocked; signatures, transaction serialization, HTTP routing and Durable Object storage are real. Tests do not transfer funds.

```sh
npm run demo:setup
npm run dev
```

Setup generates fresh local keys and prints the Base Sepolia payer, payee and facilitator addresses. It writes `.demo.json` and `.dev.vars` with owner-only permissions. Existing files are preserved. Fund the **payer with test USDC** and the **facilitator with test ETH**, then, in another terminal:

```sh
npm run demo
```

The demo obtains an offer, signs an EIP-3009 authorization, delegates a UCAN through an agent, signs a demo decision credential, verifies, settles, and prints the separate receipt. It transfers **0.10 test USDC**. The demo evaluator automatically approves its sample policy; it is not a real evaluator or production trust source. Its `did:web` key is explicitly pinned locally, without pretending the example hostname resolves.

For an ambiguous or pending submission, preserve `.demo-payment.json` and run:

```sh
npm run demo -- --resume
```

This retries the identical payment. Do not create another payment while the original might still settle. `DEMO_RPC_URL` selects an RPC during setup; `FACILITATOR_URL` selects the gateway during the demo. The demo's payer/resource-server roles share one process for illustration; deployed services must keep them separate.

## Deploy your own operator

1. Copy this repository and choose a unique Worker `name` in `wrangler.jsonc`. Keep its Durable Object class and migration stable across deployments.
2. Copy `operator.example.json` to `operator.local.json`. Replace the merchant recipient, key hash, rules and RPC configuration. The example key hash is deliberately unusable. Generate a random resource-server secret of at least 32 characters and set `apiKeyHash` to `sha256:` followed by its lowercase SHA-256 hex digest. Give the raw secret only to that server.
3. Deploy the disabled Worker, then provision its secrets:

```sh
npx wrangler login
npm run deploy
npx wrangler secret put OPERATOR_CONFIG_JSON < operator.local.json
npx wrangler secret put EVM_PRIVATE_KEY
# Only when enabling Stripe:
npx wrangler secret put STRIPE_SECRET_KEY
```

`OPERATOR_CONFIG_JSON` contains the entire validated operator configuration; it is a secret binding so merchant trust details are not public configuration. Without it, there are no authorized tenants. `/health` reports `configured: false` until at least one tenant and rail are enabled; this is a configuration check, not a provider connectivity or balance probe. `/supported` advertises only rails with their required secret present. Local `.dev.vars` values are never deployed automatically.

Use a dedicated, minimally funded **gas wallet**, exclusively through this coordinator. The payer signs transfers directly to the merchant; the facilitator does not hold payer funds. The reference uses a Worker secret for its gas key. An operator can replace the signing adapter with an HSM or remote signer while preserving the prepare-before-broadcast journal.

For additional EVM networks, add an `evm` entry with the CAIP-2 network, correct RPC and approved EIP-3009 token contracts plus their EIP-712 name/version. Add corresponding tenant rules. Confirm the token's actual ABI and domain on that network before enabling it. RPC chain-ID mismatches, unapproved assets, contract wallets, Permit2, ERC-6492 deployments, Solana, `upto` and escrow flows are rejected or not registered. They require separate adapters and tests.

Cloudflare must support Workers and SQLite Durable Objects for the deployment. Account provisioning, domains, provider credentials and live transfers are operator steps; the repository supplies the deployable artifact and migration.

## Resource-server integration

See [openapi.json](openapi.json) and the small [TypeScript client](src/client.ts). Every endpoint except `/`, `/health`, `/supported` and `/networks` requires `Authorization: Bearer <resource-server-secret>`. Browser clients and payer agents must not receive this secret. There is intentionally no permissive CORS policy.

First register the authoritative offer:

```ts
import { FacilitatorClient, encodeHeader } from './src/client';

const facilitator = new FacilitatorClient(env.FACILITATOR_URL, env.FACILITATOR_KEY);
const offer = await facilitator.createOffer({
  resource: { url: 'https://api.your-service.example/weather', mimeType: 'application/json' },
  paymentRequirements: {
    scheme: 'exact', network: 'eip155:84532', amount: '100000',
    asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    payTo: env.MERCHANT_ADDRESS,
    maxTimeoutSeconds: 120, extra: { name: 'USDC', version: '2' },
  },
});
// Persist offer against the resource server's order/request ID.
return new Response(JSON.stringify(offer.paymentRequired), {
  status: 402,
  headers: { 'PAYMENT-REQUIRED': encodeHeader(offer.paymentRequired) },
});
```

The payer selects `accepts[0]` and sends a base64-encoded x402 `PaymentPayload` in `PAYMENT-SIGNATURE`. The resource server retrieves its saved offer and sends:

```json
{
  "x402Version": 2,
  "offerId": "the-server-saved-offer-uuid",
  "paymentRequirements": { "...": "exactly the registered accepts[0]" },
  "paymentPayload": { "...": "decoded PAYMENT-SIGNATURE" }
}
```

Use that same body for `POST /verify` and `POST /settle`. `paymentPayload` may also be a base64 JSON string. The facilitator endpoints return JSON; HTTP payment headers belong on the resource server's response. Standard resource-server middleware needs a small adapter to retain and pass the **additional `offerId`**; this gateway is not a drop-in URL replacement for middleware that cannot pass it.

The server must use the offer it saved for this request, not an offer ID supplied unchecked by the payer. Tenant-required proofs cannot be disabled by a request; `requireUcan` / `requireUdid` on `/offers` can only add requirements. Client extensions carry evidence and cannot alter the registered policy.

Use the authorization flow: **verify → compute result → settle → return result**. Persist an atomic resource-server order/fulfillment record around that flow. Do not perform an irreversible service action based on `/verify` alone. Computation before settlement must be safe to discard. In particular, facilitator idempotency prevents duplicate payment submission; it does **not** make your own service delivery exactly once.

`/verify` returns `{ "isValid": true, "payer": "..." }`, with proof outcomes in `EXTENSION-RESPONSES`. `/settle` returns the x402 settlement shape and a separate `extensions["org.udid.receipt@1"]` containing `settlementId`, `offerId`, `replayed`, and the consumed decision identifier where applicable. Return `PAYMENT-RESPONSE` only with the actual settlement result. A cached success has `replayed: true`; serve the already recorded order result instead of performing the action again.

`success: false, errorReason: "settlement_pending"` always includes the transaction reference. The included client retries once. Further reconciliation uses the identical `/settle` body. `GET /settlements/{settlementId}` reads status without broadcasting or polling the provider. It never returns raw signed transaction bytes. HTTP 503 means unavailable or uncertain infrastructure, not proof of nonpayment. HTTP 401/413/429 cover access, size and rate limits; well-formed payment rejections use the normal x402 false-result body.

## Choose UCAN, UDID, both, or neither

Each tenant has independent `requireUcan` and `requireUdid` booleans. An optional artifact that is supplied is still checked. Unknown extensions are rejected to avoid implying that an unsupported condition was enforced.

For UCAN, configure:

```json
{
  "authority": {
    "audience": "did:key:YOUR_FACILITATOR_PUBLIC_IDENTITY",
    "roots": [{ "payer": "CHECKSUMMED_EVM_ADDRESS_OR_STRIPE_CUSTOMER_ID", "issuer": "did:key:TRUSTED_SPEND_AUTHORITY" }],
    "revokedTokenDigests": []
  }
}
```

`roots` is the operator's explicit mapping from a payment account to its authority root. Neither a DID nor a valid signature establishes that mapping automatically. `org.ucan.authorization@1` is a **provisional application extension**, advertising the exact capability and audience. The payer supplies `{ "token": "compact-UCAN" }` under the same payment extension. The resource component is a hash of offer ID, resource URL and payment-requirements digest, so an authorization for one offer cannot be reused for another.

This profile is deliberately bounded: UCAN 0.8.1 JWT, Ed25519 `did:key`, one exact capability per token, one inline parent per delegation, at most eight delegation links. It verifies every signature, root, audience link, expiration, `nbf` containment and revocation digest. Wildcards, ownership amplification, CID-only proofs and newer UCAN invocation/container formats are not supported. The core UCAN package supplies token cryptographic validation through a native Web Crypto plugin; the app implements the narrow chain and time-attenuation rules explicitly. Revocation digests are `sha256:<hex>` of the exact compact token; update operator configuration to revoke any link.

For UDID, configure `decision` with:

- `trustedIssuers`: issuers accepted to make decisions for this tenant.
- `keys`: `{ kid, controller, purpose, jwk }` entries. `jwk` is a public Ed25519 `{ kty: "OKP", crv: "Ed25519", x }`; purposes are `assertionMethod` or `authentication`. Verify controller and DID-document relationships before provisioning these pins. Key rotation is an explicit operator configuration update; the app does not fetch arbitrary DID URLs from credentials.
- `policies`: exact `{ id, version, bytes }` artifacts. A credential must match the ID/version and SHA-256 of these UTF-8 bytes. This is a trust allowlist, not a policy-evaluation engine.
- `holderBinding`: `none` explicitly accepts a bearer VC. `did-authentication` additionally needs `holders: [{ payer, did }]` and pinned authentication keys.
- `requireStatus` and `revokedDecisionIds`: status requirements and explicit `{ issuer, id }` revocations.

The full VC is the signed JWT payload, with protected `typ: "vc+jwt"`, `alg: "EdDSA"`, and pinned `kid`. A legacy JWT containing only a nested `vc` claim is not this profile. A presentation in holder mode uses `typ: "vp+jwt"` and a signed object with VC 2.0 context, `type: ["VerifiablePresentation"]`, `holder`, `aud` equal to the resource URL, `nonce` equal to the offer ID, `exp` at or before the offer deadline, and exactly one compact VC in `verifiableCredential`. This negotiated carrier is documented rather than advertised as general-purpose VP interoperability.

UDID verification checks the VC signature and types, authorized issuer key, validity, status, immutable policy bytes, approved outcome, every economic and resource binding, optional authority digest and holder proof. The draft extension key remains `org.udid.decision@1`. Formats outside this negotiated profile, multihash policies, Data Integrity and COSE are not accepted. No universal UDID conformance or independent security audit is claimed.

If a credential includes status, exceeds a 24-hour lifetime, or the tenant requires status, the app requires an operator-owned **`STATUS_CHECKER` Worker service binding**. Without it, verification fails closed. The service receives:

```json
{ "issuer": "...", "credentialId": "...", "credentialStatus": { "id": "...", "type": "..." } }
```

It must independently verify the declared status mechanism and respond:

```json
{ "active": true, "checkedAt": 1788839000000, "issuer": "...", "credentialId": "...", "statusId": "..." }
```

`checkedAt` is epoch milliseconds and must be fresh within 30 seconds. The binding is trusted operator infrastructure; arbitrary credential-supplied status URLs are never fetched by this gateway. Add `"services": [{ "binding": "STATUS_CHECKER", "service": "your-status-verifier" }]` to Wrangler when using it. The repository supplies the contract and failure behavior; the operator supplies the status mechanism implementation. By default, short-lived credentials without status may be accepted, with expiry plus the configured revocation list as their revocation posture.

For a service that already performs payment locally, reuse `verifyAuthority` and `verifyDecision` with an authoritative offer and your own atomic consumption store. These functions do not grant a generic service capability or consume decisions; define a separate capability/profile for actions unrelated to a payment offer.

## Stripe configuration and consent

Add `stripe: { "network": "stripe:test", "account": "acct_YOUR_CONNECTED_ACCOUNT" }` and a corresponding tenant rule with `scheme: "stripe-manual-capture"`, `asset: "usd"`, the connected account as `payTo`, and integer **minor currency units**. Set `STRIPE_SECRET_KEY` to a key authorized for that account. The adapter sends the configured `Stripe-Account` header on all calls.

The resource server registers an offer, then creates a PaymentIntent on that account using `capture_method: "manual"`, the exact amount/currency, and a Stripe customer. Set trusted server-side metadata:

```text
x402_offer_id       = registered offerId
x402_binding_digest = SHA-256 of canonical accepted requirements
x402_resource       = registered resource URL
```

Obtain customer consent and complete Stripe confirmation/SCA through the merchant's normal checkout. Only `requires_capture` with the exact capturable amount passes `/verify`. The payload is `{ "paymentIntentId": "pi_...", "customerId": "cus_..." }`; customer references can be mapped to UCAN roots and holder keys. The adapter verifies the actual customer's match; the reference does not treat Stripe customer IDs as verified human identities.

Settlement captures exactly the authorized amount, using a stable provider idempotency key. A retry first retrieves the same PaymentIntent, returning success only for `succeeded` with the full amount received. Processing, timeout and ambiguous capture remain pending. The transaction reference is the real `pi_...` identifier, never a fabricated blockchain hash.

This custom scheme is **not Stripe's native x402 preview**, does not create or confirm PaymentIntents, does not bypass checkout consent, and does not accept Checkout Sessions, deposit addresses or automatic captures. “Succeeded” means processor capture, not bank payout finality or freedom from later refunds/disputes. Implement those subsequent lifecycle events in the merchant system.

## Recovery, operation and limits

A single coordinator per deployment serializes settlement, including across tenants. It atomically reserves the payment identity, offer, `(issuer, decision.id, offerId)` replay key and per-rule daily budget before an external mutation. EVM transaction bytes/hash and the next gas-wallet nonce are persisted together **before** broadcast. Recovery reconciles and may rebroadcast those exact bytes; it never creates a replacement transfer. Stripe recovery uses the persisted PaymentIntent and stable capture key.

Once prepared, a settlement is an accepted execution commitment. Recovery can continue after proof expiry; it does not re-authorize a different payment or undo an already accepted action. A reserved-but-unprepared retry rechecks proofs and current tenant policy. EVM authorization expiry still applies on chain. There are no automatic fee replacements, nonce cancellations or operator unconsume endpoints. A dropped/underpriced EVM transaction can therefore remain pending, and a nonce gap can delay subsequent transactions. Inspect the stored transaction and RPC state before repairing a dedicated gas wallet; never blindly reuse or reset its nonce. Do not share this wallet with another application or another deployment.

For conservative accounting, daily budgets count reservations, including failed or pending attempts, and reset by UTC date. Limits are per tenant and exact scheme/network/asset/recipient rule; they do not implement market-value conversion, project aggregation, KYT, sanctions screening or credit underwriting. Request-rate limits are persisted per tenant. The single settlement lane is intended for modest-volume reference deployments; scale by partitioning wallets and transactional ownership boundaries, not by adding unsynchronized replicas.

Worker logs contain request ID, tenant, endpoint, HTTP status, stable outcome code and duration. They omit keys, proof tokens, private evidence and provider error bodies. Saved settlement records contain identifiers, proof outcomes, the necessary signed transaction and the separate receipt; full UCANs/VCs are not retained. Offers and replay/settlement records are retained indefinitely in this reference to preserve retry correctness. Define an operator retention/export policy before long-term use, and keep replay tombstones for every period in which the corresponding authorization can still be used. Do not delete the Durable Object namespace or roll its storage back while payments may still be live.

The local suite covers real proof signatures, invalid/expired/revoked credentials, changed payment bindings, UCAN delegation and negative cases, holder mismatch, policy and budget rejection, concurrent replay, persisted recovery, actual EIP-712 verification and transaction serialization against a mocked RPC, Stripe capture against a mocked API, and a complete signed flow in workerd across restart. It does not establish live-chain confirmation, live Stripe operation, public DID resolution, external status-service conformance, hosted Cloudflare deployment or production security review.

## Source contracts

- [x402 facilitator responsibilities and pending settlement](https://docs.x402.org/core-concepts/facilitator)
- [x402 v2 specification](https://github.com/x402-foundation/x402/blob/main/specs/x402-specification-v2.md)
- [x402 TypeScript implementation](https://github.com/x402-foundation/x402/tree/main/typescript)
- [UCAN TypeScript 0.8.1 implementation](https://github.com/ucan-wg/ts-ucan)
- [W3C VC JOSE and COSE](https://www.w3.org/TR/vc-jose-cose/)
- [Stripe PaymentIntent capture](https://docs.stripe.com/api/payment_intents/capture)
- [Cloudflare SQLite Durable Object storage](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)

The root MIT license applies to this application. Dependencies retain their own licenses.
