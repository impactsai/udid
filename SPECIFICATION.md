# UDID Decision Credential Profile

## 1. Status and conventions

This document is a Draft specification. It defines UDID version `0.1`. The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHOULD**, **SHOULD NOT**, and **MAY** are to be interpreted as described in RFC 2119 and RFC 8174 when, and only when, they appear in all capitals.

This profile is independent of any particular evaluator, ledger, payment processor, policy engine, or chain. Identifiers in examples are illustrative only.

## 2. Purpose and non-goals

A UDID is a signed assertion that a named issuer evaluated a subject under an identified decision policy and produced a determination. For payment use, it records a bounded `decision_to_pay` determination tied to an x402 offer.

UDID does not:

- delegate authority, replace account-owner consent, or prove a UCAN delegation;
- authorize a wallet, facilitator, or smart contract to transfer value;
- attest that payment settled; or
- establish that the decision was substantively correct.

Those boundaries matter: a verifier can prove who made a statement and whether the statement satisfies its acceptance policy; it cannot derive trust in the issuer or the correctness of the policy from the signature alone.

## 3. Roles

**Issuer** signs a DecisionCredential and is accountable for the decision assertion. **Holder** presents it. **Subject** is the thing evaluated. **Relying party** verifies it and may act on it. **Policy authority** publishes or controls the immutable policy/rubric. **Payment payer**, **payee**, **resource server**, and **facilitator** retain their x402 meanings.

An issuer MAY also be the policy authority, but a relying party MUST evaluate both roles according to its trust policy.

## 4. Credential model

A conforming UDID is a W3C Verifiable Credential 2.0 whose `type` contains `DecisionCredential`. A payment decision additionally contains `DecisionToPayCredential`. Its `credentialSubject` conforms to [schemas/decision-credential.schema.json](schemas/decision-credential.schema.json).

The credential MUST contain a `credentialStatus` mechanism when its `validUntil` is more than 24 hours after `validFrom`, or when the relying party's policy permits revocation before expiry. A relying party MUST check status when one is present or required by its own acceptance policy.

### 4.1 Securing

The credential MUST be secured with a W3C VC 2.0-compatible securing mechanism. This draft defines the JWT VC serialization as the interoperable baseline using the W3C VC JOSE and COSE specification. The verifier MUST validate the signature, issuer binding, verification method authorization, time validity, and credential status before inspecting the decision.

An implementation MAY support Data Integrity or COSE serializations, but MUST specify the cryptosuite, canonicalization rules where applicable, and key resolution procedure. A verifier MUST reject an unsupported serialization or algorithm; it MUST NOT downgrade from a failed verification to an unsigned JSON interpretation.

### 4.2 Credential subject

The following fields are REQUIRED in `credentialSubject`:

| Field | Meaning |
| --- | --- |
| `id` | Stable identifier of the evaluated subject. |
| `decision.id` | Issuer-unique decision identifier. |
| `decision.type` | `decision_to_pay` for this profile. |
| `decision.outcome` | `approved` or `declined`. |
| `decision.policy` | Immutable policy identifier, version, and content digest. |
| `decision.evaluatedAt` | RFC 3339 evaluation time. |
| `decision.binding` | Exact object to which the decision applies. |

`decision.reasonCodes` MAY contain stable, privacy-preserving reason codes. A credential MUST NOT require a verifier to receive sensitive evidence merely to validate the credential. Evidence locations, if used, SHOULD be access controlled and integrity protected.

`decision.policy.digest` MUST use a recognized multihash or a lowercase `sha256:` digest of the exact policy bytes. If a verifier accepts the policy, it MUST fetch or otherwise possess an artifact whose digest equals that value. A mutable URL alone is not a policy reference.

### 4.3 Decision outcome

`approved` means only that the issuer's asserted evaluation approved the binding in the credential. It does not broaden any UCAN, payment requirement, account policy, or statutory approval. `declined` credentials MAY be retained for audit but MUST NOT satisfy a requirement that demands approval.

## 5. x402 v2 extension

This document defines the provisional extension key `org.udid.decision@1`. It is carried in the x402 v2 `extensions` object. The key and this version are part of the extension contract; a server MUST NOT use the same key for incompatible semantics.

### 5.1 Payment-required advertisement

When a resource server requires a UDID, its x402 `PaymentRequired.extensions["org.udid.decision@1"]` value MUST conform to [schemas/x402-udid-extension.schema.json](schemas/x402-udid-extension.schema.json), with `required: true`. The base x402 `accepts` element remains the payment offer and MUST NOT be redefined by this extension.

The extension's `offerId` MUST uniquely identify the advertised offer for at least the maximum payment timeout. `bindingDigest` MUST be the SHA-256 digest of the RFC 8785 canonical JSON serialization of the selected `PaymentRequirements` object, encoded as `sha256:<lowercase-hex>`. This prevents ambiguity between a decision made for one offer and a payment made under another.

### 5.2 Client submission

The client MUST include the chosen base x402 `accepted` requirement and scheme `payload` as x402 requires. It MUST place its verifiable presentation or credential under `PaymentPayload.extensions["org.udid.decision@1"].presentation`.

The presentation MUST disclose exactly one usable DecisionToPayCredential unless the server explicitly permits a bundle. The presentation format and holder proof, where required, are negotiated by the extension's `presentationFormats`. A bare credential MAY be accepted only when `holderBinding` is `none`; a server MUST NOT infer holder possession from receipt of a bearer credential.

### 5.3 Required payment binding

For `decision_to_pay`, `credentialSubject.decision.binding` MUST contain:

| Field | Required equality |
| --- | --- |
| `offerId` | extension `offerId` |
| `bindingDigest` | extension `bindingDigest` |
| `resource` | x402 `resource.url` |
| `network` | selected `accepted.network` |
| `asset` | selected `accepted.asset` |
| `payTo` | selected `accepted.payTo` |
| `amount` | selected `accepted.amount` |

The credential's `validUntil` MUST be no later than the deadline advertised by the offer, if the offer supplies one, and MUST be in the future at verification. The relying party MUST use an issuer-unique decision identifier plus the offer identifier as a replay key and atomically record consumption before it returns the protected resource or initiates settlement.

### 5.4 Verification order

Before the resource executes, the relying party MUST:

1. parse and validate the x402 base message and select the accepted requirement;
2. validate the UDID extension and its offer digest;
3. validate the VC signature, issuer trust, key authorization, time validity, and status;
4. validate `DecisionToPayCredential`, approved outcome, and every binding equality in section 5.3;
5. validate the required holder binding, if any;
6. validate any separately required authority artifact, such as a UCAN, without treating UDID as a substitute;
7. reject a replay atomically; and
8. invoke the x402 scheme's required verify and/or settle operation.

Failure prior to payment acceptance MUST NOT cause settlement. A resource server MAY return `402` for an absent, expired, or retryable credential and `403` for a supplied credential that violates trust or policy. Error bodies SHOULD expose stable codes, not sensitive decision evidence.

## 6. UCAN profile (optional)

UDID does not require UCAN. When an offer requires both artifacts, the extension MAY declare `authority.required: true` and a capability descriptor. The server MUST independently verify the UCAN chain, audience, expiration, proof links, and attenuation. The decision's `authorityReference` MAY bind the decision to the UCAN's content identifier or digest, but a reference alone is not proof of authority.

## 7. Settlement and receipts

The decision credential records a pre-settlement determination. A settlement receipt MUST be a separate object containing the x402 transaction reference, network, outcome, and the consumed decision identifier. An implementation MUST NOT overwrite the decision credential to imply settlement.

Ordinary x402 EIP-3009 authorization and settlement do not make UDID conditions enforceable on-chain. On-chain enforcement requires a separately specified contract or account policy that verifies the relevant conditions.

## 8. Privacy and retention

Issuers SHOULD minimize personal data and use opaque subject identifiers when a stable public identifier is unnecessary. Relying parties MUST NOT use a decision credential for a purpose outside the bound offer without a separate legal and policy basis. Implementers SHOULD document credential retention, revocation, disclosure, and audit-access practices.

## 9. Conformance

An implementation claims **UDID verifier** conformance only if it implements all MUST requirements in sections 4 and 5 and passes the cases in [CONFORMANCE.md](CONFORMANCE.md). An **issuer** MUST generate credentials that meet section 4 and bind every payment decision according to section 5.3. An **x402 extension implementation** MUST preserve x402 v2 base-message semantics.

## 10. Security considerations

See [SECURITY.md](SECURITY.md). Particularly: verify the credential before payment; treat issuer trust and policy governance as explicit configuration; bind every economic field; prevent replay atomically; check revocation; and keep decision, authority, execution, and settlement records distinct.
