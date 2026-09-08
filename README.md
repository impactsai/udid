# Universal Decision and Impact Determination (UDID)

UDID is a proposed, vendor-neutral profile for expressing a signed decision and impact determination that a relying party can verify before it performs a consequential action, including an x402 payment flow.

It is deliberately not a payment rail, wallet instruction, delegated-spend token, or settlement receipt. It supplies a missing evidence boundary:

```text
authority (for example, UCAN) → evaluation and decision (UDID) → authorization / settlement (for example, x402)
```

The current proposal profiles a [W3C Verifiable Credential 2.0](https://www.w3.org/TR/vc-data-model-2.0/) as a `DecisionCredential`. `DecisionToPayCredential` is the payment-specific subtype. A positive credential does **not** by itself authorize a transfer.

## Status

**Draft 0.1.0 — proposal, not an adopted standard.** The extension identifier in this repository is provisional. Implementers MUST negotiate an extension identifier and version; no IANA, W3C, DID, or x402 namespace has been assigned.

## Repository contents

- [SPECIFICATION.md](SPECIFICATION.md) — normative core and x402 v2 profile
- [schemas/decision-credential.schema.json](schemas/decision-credential.schema.json) — JSON Schema for the credential subject
- [schemas/x402-udid-extension.schema.json](schemas/x402-udid-extension.schema.json) — JSON Schema for the x402 extension value
- [examples/](examples/) — an offer, a credential, and a submission envelope
- [CONFORMANCE.md](CONFORMANCE.md) — implementation requirements and test matrix

## Quick validation

```sh
npm test
```

The test suite validates the supplied examples and exercises critical rejection cases. It does not verify a real issuer DID, credential-status service, UCAN chain, EIP-712 signature, or facilitator; those integrations remain implementation responsibilities.

## Interoperability posture

The profile uses x402 v2's `extensions` object and leaves the base `PaymentRequired` and `PaymentPayload` shapes unchanged. Resource servers that do not require a decision credential omit the extension. Clients that do not recognize a required extension must not attempt payment under that offer.

See [SECURITY.md](SECURITY.md) before using UDID in a production payment path.

## License and contributions

The source material in this repository is offered under the [MIT License](LICENSE). Contributions are welcome under the same license; see [CONTRIBUTING.md](CONTRIBUTING.md). Upstream submission is a separate governance and licensing process.
