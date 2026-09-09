# The Decisions engine

The Decisions engine evaluates a claim or proposed action against an identified policy. It produces a determination with enough context for an authorized party to review and rely on it.

This page describes the product design. It is not a statement that every step is available through a public service today. See [product status](07-status-and-sources.md).

## Start with the question and the authority

A request needs a specific subject and a decision question. "Pay this invoice" is an action request. "Does the evidence show that this invoice meets the contract's payment conditions?" is a decision question.

The service must identify the policy owner, permitted evaluator and any required approver. An agent's request does not establish any of those roles. The workflow verifies its authority to submit evidence or request evaluation separately from authority to release money.

## Evaluate evidence against a versioned policy

The policy defines admissible evidence, acceptance criteria, applicable limits and review requirements. Each determination refers to the version used. Changing the policy creates a new evaluation context rather than rewriting the basis of an earlier decision.

Deterministic checks can compare an amount with a limit, verify a signature or detect a repeated claim. Agentic Oracles can assist with evidence interpretation where the policy permits it. A model-generated explanation is an evaluation input or output, not independent proof of the underlying claim.

Conflicting evidence, insufficient evidence and questions outside the evaluator's authority must have an explicit route to review. The workflow should distinguish a pending review from a final decline. The current UDID payment profile encodes only final `approved` and `declined` determinations. It does not define a review workflow status.

## Preserve the basis of the determination

The intended decision record and its protected supporting records answer these questions:

| Question | Record needed |
| --- | --- |
| What was evaluated? | The claim, invoice, cart or other bound subject. |
| Which rules applied? | An immutable policy reference, version and digest. |
| What supported the result? | Evidence references, provenance and evaluation results. |
| Who made the assertion? | The issuer and its verified signing authority. |
| Why did the evaluation reach this result? | Reasons, failed conditions and relevant uncertainty. |
| How long may a party rely on it? | Validity limits and status or revocation requirements. |
| What happened afterward? | Separate approval, execution, settlement and dispute records. |

Not every record belongs inside the credential. Sensitive evidence remains behind access controls. The payment recipient may need to verify an accepted determination without receiving a participant's identity documents or private programme records.

The [UDID specification](../../SPECIFICATION.md) defines the credential's required fields. This table also describes supporting service records and must not be treated as a wire schema.

## Verify before relying

A relying party checks the signature, trusted issuer, accepted policy, validity and exact transaction binding. It also checks separately required delegation and payment authorization. Verification must reject an unsupported proof format rather than silently accept unsigned data.

The same approved decision cannot be reused to satisfy a different amount, recipient or offer. Changes require the relevant re-evaluation and authorization. Replay protection must account for concurrent requests as well as ordinary retries.

A credential can be cryptographically verifiable offline when the necessary keys and policy material are available. Current revocation, budget and consumption state may require an online check. Offline signature verification alone does not establish present permission to pay.

## Review, challenge and learn

A review should preserve the original evidence and decision. A correction creates a linked record and, where applicable, changes the original credential's status. It does not erase the first determination or imply that a completed transfer was reversed.

Replay means reconstructing what evidence, policy and evaluation configuration produced the record. Deterministic steps can be rerun against preserved inputs. Model-based steps may not reproduce identical outputs, so the service needs the original outputs and configuration to support review.

Outcome feedback can identify weak criteria and recurring errors. Policy owners approve revised rules before those rules govern new financial actions.

Next: [Decision services](03-decision-services.md).
