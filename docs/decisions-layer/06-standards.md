# Standards and interoperability

Agentic finance needs several kinds of verifiable information. Agent identity identifies the actor. A mandate constrains delegated action. A decision records an evaluation. Payment authorization permits a transfer through a particular system. A receipt records its result.

IXO's proposed interoperability approach preserves those meanings. It connects records through explicit bindings rather than treating one credential as evidence of every step.

## Where the specifications fit

The right column describes IXO's intended relationship, not a verified integration claim.

| Specification or protocol | Published purpose and status | Intended IXO relationship |
| --- | --- | --- |
| [W3C Verifiable Credentials Data Model 2.0](https://www.w3.org/TR/vc-data-model-2.0/) | W3C Recommendation for expressing claims in an issuer, holder and verifier model. | The current UDID draft profiles a VC 2.0 decision credential. Acceptance still requires issuer trust and policy checks. |
| [UCAN](https://github.com/ucan-wg/spec) | Specification for capability-based delegation. | Verify delegated authority independently of the decision. The local reference application explicitly supports a constrained UCAN 0.8.1 profile. |
| [Agent Payments Protocol, AP2](https://ap2-protocol.org/ap2/agent_authorization/) | Published framework for verifiable agent authorization using mandates and constraints. | Evaluate the proposed action against relevant mandate constraints and bind the decision to the same transaction. No IXO adapter is established by this documentation. |
| [Verifiable Intent](https://github.com/agent-intent/verifiable-intent/) | Mastercard-maintained draft specification for cryptographic evidence of delegated authorization, using layered SD-JWT credentials. | Verify the intent presentation as a separate artifact. UDID uses a different profile and is not interchangeable with it. |
| [Visa Trusted Agent Protocol](https://developer.visa.com/capabilities/trusted-agent-protocol/trusted-agent-protocol-specifications) | Published protocol using signed HTTP messages for agent recognition and associated interactions. | Use verified agent context where available. Recognition alone does not prove that a purchase meets IXO's decision policy. |
| [Universal Commerce Protocol, UCP](https://ucp.dev/) | Open commerce protocol covering discovery, cart, checkout and order functions. | Evaluate the relevant offer before completion and bind the determination to the agreed checkout state. |
| [Agentic Commerce Protocol, ACP](https://www.agenticcommerce.dev/) | Open protocol developed by Stripe and OpenAI for agent commerce, including checkout and payment-credential exchange. | Add a decision requirement through an agreed integration without changing the merchant's payment responsibilities. |
| [x402](https://docs.x402.org/introduction) | Open protocol for payments in HTTP request flows. | Carry a required decision through the draft UDID extension and verify it before the payment operation. |

These specifications have different governance and maturity. A W3C Recommendation, an open commerce protocol, a network programme and a draft credential profile are not equivalent forms of adoption or certification. Implementations must pin the exact versions and supported proof formats they use.

## UDID is a proposed decision profile

The repository defines UDID Draft 0.1 as a vendor-neutral decision credential profile. It is independent of a particular evaluator, ledger or payment processor. The current payment subtype is `DecisionToPayCredential`, with a `decision_to_pay` type and an `approved` or `declined` outcome.

The provisional x402 extension identifier is `org.udid.decision@1`. It has no assigned standards-body namespace and is not an adopted x402 standard. The draft uses the x402 v2 `extensions` object without redefining the underlying payment offer. See the [normative specification](../../SPECIFICATION.md).

The relying party verifies the issuer, policy, proof, validity, holder binding where required and exact payment binding. It also verifies any required UCAN authority separately. A policy URL alone is insufficient; the verifier needs the policy artifact matching the recorded digest.

A signature proves the integrity and attribution of an assertion. It does not prove the correctness of the evaluation, confer spending authority or demonstrate settlement.

## Keep intent and determination separate

An AP2 mandate or Verifiable Intent presentation can provide evidence of delegated authorization. IXO's proposed decision service can evaluate whether the selected action also satisfies its substantive policy. The payment participant must still verify the authorization artifact under its own rules.

Mapping these artifacts requires explicit field, signature and constraint validation. A wrapper that stores their hashes does not establish interoperability. Unknown constraints, mismatched amounts or invalid holder proofs must not become accepted authority through translation.

## Keep the receipt separate

The UDID specification requires a separate settlement receipt that links the transaction result to the consumed decision identifier. Implementations must not modify the original decision credential to imply that funds moved.

The default x402 payment authorization also does not enforce UDID conditions on-chain. A facilitator can enforce a decision requirement in its own path. Preventing all alternative execution paths requires separately specified account or contract controls.

## What the reference implementation demonstrates

The repository includes an operator-deployable facilitator with constrained VC and UCAN verification, EVM payment support and a custom Stripe manual-capture adapter. Its documentation reports a Base Sepolia test instance. The Stripe adapter captures an already authorized PaymentIntent; it is not an implementation of every Stripe, ACP or card-network flow. [Reference application](../../apps/facilitator/README.md).

This establishes implementation material for a particular profile. It does not establish production certification, universal wallet support or a live IXO integration with Trustline, AP2, Verifiable Intent, UCP or Visa.

Next: [Product status and sources](07-status-and-sources.md).
