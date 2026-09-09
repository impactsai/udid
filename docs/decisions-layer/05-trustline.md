# IXO and Trustline

IXO and Trustline address related questions about agent-mediated financial actions. IXO's proposed emphasis is whether evidence satisfies the substantive conditions for the action. T54 describes Trustline as its risk and underwriting engine. A combined workflow could require both determinations.

This page proposes an architectural relationship. It does not claim a partnership, deployed integration or mutual acceptance of credentials.

## The overlap is real

Trustline's documented risk engine evaluates transaction context, agent and principal context, evidence, external signals and outcomes. It applies policy to those inputs. Its scope therefore overlaps with IXO's proposed evaluation of intent and policy; the distinction is not that only IXO makes decisions or handles evidence. [T54 risk engine](https://docs.t54.ai/docs/trustline/risk-engine).

IXO's product emphasis follows its work with claims, verified outcomes and accountable determinations. For a programme payment, the question is whether the claimed work meets the programme's standard. For a purchase, it is whether the actual offer satisfies the principal's requirements. This positioning is IXO's interpretation of how the products could complement each other.

T54 places X402 Secure between agent-payment protocols and Trustline's underwriting process. Its documentation describes support for x402, AP2 and Verifiable Intent. In that arrangement, an IXO determination would be a proposed additional input to the existing risk and payment path. It would require an agreed connector; these pages do not assume a second gateway is necessary. [T54 compatible protocols](https://docs.t54.ai/docs/reference/compatible-protocols).

## Assign the checks explicitly

The following is a proposed division of responsibility, not a claim that either product is restricted to these tasks.

| Check | Proposed owner in a combined workflow |
| --- | --- |
| Whether submitted work meets a programme's evidence requirements | IXO evaluator under the programme's policy. |
| Whether a purchase satisfies declared purpose and product conditions | IXO evaluator, with mandate verification assigned explicitly. |
| Whether the transaction meets the operator's risk appetite | Trustline under the operator's agreed risk policy. |
| Whether the principal authorized the action | The designated mandate verifier and account controller. |
| Whether funds may move through the selected provider | The payment provider under its own controls. |
| Whether funds moved and the obligation was fulfilled | Settlement and fulfillment records, reconciled by the operator. |

An integration agreement must resolve duplicate checks, conflicting results and responsibility for stale evidence. A positive result from one engine cannot override a required decline from another.

## A proposed integration

A programme operator could send IXO a claim and its supporting evidence. After evaluation, IXO would produce a decision bound to the proposed payout. The integration could submit the transaction and permitted decision references to Trustline for assessment. A gateway would allow payment submission only after it verified all required results and authorizations.

The reverse direction is also possible. An IXO policy could require a current Trustline assessment as an external input before completing its determination. Each deployment should choose one dependency order. It should not allow the two services to wait indefinitely for each other's final result.

Both approaches require a shared transaction binding. At minimum, the parties must agree how they identify the payee, amount, currency or asset, offer, expiry and relevant policy versions. They also need an authenticated method of retrieving and verifying each result. A copied assessment identifier or hash is not proof that the assessment is authentic or applicable.

T54 documents external signals as inputs to Trustline, but that is not evidence that it accepts UDID credentials. Schema mapping, issuer trust, disclosure permissions and result authentication remain integration work. [T54 external signals](https://docs.t54.ai/docs/trustline/external-signals).

## Respect the actual API states

T54's documented developer flow submits an asynchronous assessment and polls for completion. Only `completed` contains a final decision. The API's decision values are `APPROVE` and `DECLINE`; manual-review outcomes use `DECLINE` with explanatory context. A request for more information pauses assessment. Failure, expiry and cancellation are not approval. T54 currently documents polling as the completion signal, with challenge notifications available by webhook. [T54 asynchronous underwriting API](https://docs.t54.ai/docs/trustline/async-underwriting).

A connector should preserve the original response and separately map it to the operator's workflow state. It must not invent a third Trustline API decision or mistake a successfully submitted assessment for an approved transaction.

## Example of a disagreement

Suppose the programme's evidence shows that a worker earned a payout, but the required risk assessment declines the proposed transaction. The operator records that payment is due while holding execution for resolution. It does not rewrite the work as uncompleted merely because the payment could not proceed.

Conversely, an acceptable risk assessment cannot establish that the worker completed the task. If the evidence does not meet the programme's policy, the workflow cannot release an outcome-dependent payment on that basis.

This separation lets operators explain whether an exception concerns the underlying entitlement, transaction risk or payment execution.

Next: [Standards and interoperability](06-standards.md).
