# Decision services

IXO's product design applies the same evidence-and-policy process to several financial questions. The service determines whether the relevant conditions are met. The responsible parties retain authority over the resulting action.

## Decision to Pay

A Decision to Pay asks whether evidence establishes that a payment is due under an agreed policy. It can support programme disbursements, milestone payments or release requests against verified work.

Consider a programme that pays for completed training. The operator defines completion requirements and acceptable evidence. A participant submits a claim. IXO evaluates it and routes exceptions to a reviewer. The programme's authorized payment process uses the accepted determination, applies its remaining controls and instructs its payout provider. The provider's receipt records what happened to the payment.

The determination can be positive while payment remains blocked by a funding shortfall, a recipient-account issue or a required approval. The operator needs to see those states separately.

The PIM source material reports the Yoma Decision to Pay workflow as in pilot. The training example above is illustrative, not a report of a particular participant's transaction. See [source and status details](07-status-and-sources.md).

## Decision to Buy

A Decision to Buy asks whether a specific purchase satisfies the principal's intent, budget and policy.

Suppose a person permits an agent to buy a mobile-data bundle up to a fixed amount. A proposed purchase may satisfy the amount limit but fail because it is a recurring subscription, covers the wrong country or comes from an excluded merchant. The evaluation needs the actual offer and the relevant evidence, not only the agent's statement that the purchase is suitable.

In the proposed workflow, IXO assesses that offer. A risk provider assesses the transaction where the operator requires it. The payment system verifies authorization and proceeds only when all required conditions pass. A changed price or cart invalidates reliance on a determination bound to the old offer.

Decision to Buy is a proposed service in the reviewed company material. Its product name does not imply that a distinct Buy credential is defined in the current UDID draft. The repository currently specifies `decision_to_pay` for its payment profile. A purchase-specific profile needs explicit semantics and validation rules.

## Decision to Treat

A Decision to Treat determines whether an entity should have a particular standing under a named standard. Examples include programme eligibility, acceptance of a supplier or professional verification of a claim.

"Treat" means treating the subject as having that standing. It is not limited to medical treatment. A standing can inform several later Pay or Buy decisions, subject to its scope, expiry and continuing validity. Eligibility does not grant an unlimited right to funds.

IXO's proposed Professional Service PODs organize the evidence process, agent assistance and accountable professional around these determinations. The reviewed PIM material describes the design programme as in development at alpha stage. It does not establish an operating marketplace of contracted professional providers.

## How customers would use the services

| Customer | Intended use |
| --- | --- |
| Programme manager or funder | Establish whether an outcome or milestone satisfies payment conditions. |
| Merchant or marketplace | Require a determination bound to the order before completing a consequential transaction. |
| Agent platform or wallet | Check a proposed purchase against the principal's constraints. |
| Payment processor or facilitator | Verify a required decision alongside its other transaction controls. |
| Professional service provider | Record a determination under its own standards and accountable authority. |

The planned Decisions Gateway provides common access through an HTTP API, SDK and narrowly scoped MCP tools. The planned Decision Console supports evidence inspection, review and reconciliation. These are product intentions, not a published endpoint list. The public packaging remains distinct from IXO's internal interfaces.

Next: [The payments ecosystem](04-payments-ecosystem.md).
