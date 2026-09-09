# Company vision

## IXO is the decisions layer for agentic finance

IXO is building the infrastructure to determine whether a financial action satisfies the conditions set by the people and institutions responsible for it.

An agent may request payment for completed work, select a purchase or propose the release of funds. Each action raises a question that requires evidence. Was the work completed to the agreed standard? Does the purchase meet the buyer's purpose? Is the recipient eligible? Who has authority to make that determination?

IXO Decisions brings those questions into a governed process. The engine evaluates evidence against declared rules, refers unresolved questions to the responsible reviewer and records the result. The intended output is a decision that a funder, merchant or payment provider can verify before acting.

## Intelligence should serve human needs

IXO's company vision is that intelligence should help people achieve the outcomes they value while preserving control over their data and decisions. Its work began with the difficulty of directing development finance against reliable evidence of results. That problem remains relevant when software agents participate in financial workflows. The actor changes, but the need to establish what happened and who may act on it remains. This framing comes from the company's [investment memorandum](07-status-and-sources.md#ixo-source-material).

A programme should be able to pay a participant because accepted evidence shows that they earned the payment. A person should be able to ask an agent to buy something within a defined budget and purpose. An institution should be able to examine the decision afterward, challenge its basis and correct errors.

This is the connection between IXO's work in verified outcomes and its role in agentic finance. Evidence informs a decision. An authorized party acts on that decision. The system records the result so the parties can assess whether the action achieved its purpose.

## What IXO is building

The Decisions engine provides a common process for evaluating claims and proposed actions under versioned policies. Decision services apply that process to outcome payments, agent purchases and determinations of eligibility or standing.

The portable decision record is called a Universal Decision and Impact Determination, or UDID. The current draft expresses it as a signed credential. It identifies the decision and its policy and binds the determination to the object evaluated. A payment provider can require an acceptable credential as one condition of proceeding. A positive credential does not grant spending authority. See [the engine](02-decisions-engine.md) and [UDID's role](06-standards.md#udid-is-a-proposed-decision-profile).

IXO's intended place is alongside agent platforms, risk engines and payment providers. Those participants can use IXO's determination without giving IXO control of every part of their transaction.

## Control remains with accountable parties

The policy owner determines the evidence requirements and review rules. The principal defines the agent's authority. The evaluator is accountable for its assertion. The payment provider applies its own acceptance and authorization controls.

Our design principle is that access to an AI model does not confer institutional authority. Operators should retain control of their policies, evidence access and permitted model providers. When a decision requires professional judgment, the record should identify the professional and the authority under which they acted.

The record also needs limits. A valid signature establishes who signed an assertion. It does not establish that a sensor was accurate, that an outcome occurred or that the chosen policy was sound.

## Adoption starts with a bounded decision

IXO's starting point is a specific decision with known consequences and an accountable owner. For a funder, this may be whether a completed activity qualifies for payment. For an agent platform, it may be whether a proposed purchase satisfies a user's instruction.

The aim is to reduce repeated evidence review and make financial actions easier to explain and contest. Those benefits need measurement in each deployment. IXO's [product status](07-status-and-sources.md) separates existing infrastructure from the public services and integrations still being developed.

Next: [The Decisions engine](02-decisions-engine.md).
