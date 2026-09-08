# UDID conformance

This matrix complements the normative requirements in [SPECIFICATION.md](SPECIFICATION.md). A conforming production implementation needs cryptographic, DID-resolution, status, UCAN, and x402-facilitator integration tests in addition to the structural tests included here.

| ID | Requirement | Verifier result |
| --- | --- | --- |
| UDID-01 | VC has both required types | reject if absent |
| UDID-02 | Issuer signature and verification method are valid and trusted | reject before payment |
| UDID-03 | Credential is within validity window and status is acceptable | reject before payment |
| UDID-04 | Policy bytes match `policy.digest` | reject |
| UDID-05 | Outcome is `approved` | reject |
| UDID-06 | Offer ID and binding digest equal the advertised extension | reject |
| UDID-07 | Resource, network, asset, recipient, and amount equal the chosen x402 requirement | reject |
| UDID-08 | Required holder proof is valid for the expected audience/challenge | reject |
| UDID-09 | Separately required UCAN/capability is valid and attenuated | reject |
| UDID-10 | `(issuer, decision.id, offerId)` has not been consumed | atomically reject replay |
| UDID-11 | x402 scheme verification / settlement follows its ordering rules | do not execute resource without it |
| UDID-12 | Settlement receipt remains separate from the decision credential | retain distinct records |

## Required negative tests

Implementations MUST test invalid signatures; untrusted issuers; expired and revoked credentials; unknown policy; wrong policy digest; declined outcome; wrong offer ID; wrong binding digest; changed resource, asset, amount, or recipient; holder-proof mismatch; invalid/broadened UCAN; and concurrent replay attempts.

## Test fixture limitations

The examples use `example.test` names and intentionally contain no cryptographic proof. They prove shape and field binding only. They MUST NOT be used as signed test vectors or copied into a live payment integration.
