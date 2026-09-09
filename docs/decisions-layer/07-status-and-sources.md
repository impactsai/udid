# Product status and sources

Research date: 9 September 2026. This documentation combines IXO's company material, the local UDID specification and official external documentation. It does not report production testing or partner confirmation performed for this writing task.

## Capability status

| Capability | Evidence-based description |
| --- | --- |
| IXO claims, evaluation, human review and disputes | Reported in production in the PIM messaging source. Deployment evidence was not independently audited here. |
| Agentic Oracles with scoped authority | Reported in production in the same source. |
| Yoma Decision to Pay and Verification Portal | Reported in pilot in the company material. This is not a general public-service launch. |
| Decision Console and public Decisions API/MCP packaging | In development according to the company material, with December 2026 targets. The public SDK proposition remains proposed. Targets are not delivery commitments. |
| Decision to Buy | Proposed in the company material. No production deployment established here. |
| Professional Service POD design programme | In development at alpha stage according to the company material. No contracted professional-service marketplace established here. |
| Portable UDID profile | Draft 0.1 specification and schemas exist in this repository. It remains a proposal, not an adopted standard. |
| Reference facilitator | Source, tests and deployment instructions exist. Its README reports a hosted Base Sepolia test instance. This task did not rerun tests or verify that instance. |
| Trustline integration | Proposed architecture in these pages. No partnership or working connector established. |
| AP2, Verifiable Intent, UCP, ACP and Visa integrations | Architectural mappings only. No IXO interoperability or programme access established here. |

## IXO source material

The [IXO website messaging spine v0.1](/Users/shaunconway/PIM/IXO_Website_Messaging_Spine_v0.1.md), dated 6 September 2026, supplied the Decisions terminology, service descriptions and capability status. Relevant sections are 4.3, Decisions, and 4.5, Payments.

The [Private Investment Memorandum v7.4](/Users/shaunconway/PIM/IXO_Private_Investment_Memorandum_v7.4.md), dated 5 September 2026, supplied the company vision and the connection between evidence, financial decisions and human agency. Relevant passages include sections 1 and 2 and the IXO Decisions and Professional Service POD descriptions. Internal claim references include C-Q.2 to C-Q.3, C-Q.10 and C-S.1 to C-S.13. These references are provenance within the memorandum, not independent verification.

The PIM folder also contains a v7.5 investor edition in document and PDF form. This documentation uses the identified v7.4 Markdown and messaging source for traceable product wording; it does not claim to reconcile every revision of the investment materials.

The [UDID specification](../../SPECIFICATION.md), [repository overview](../../README.md), [security guidance](../../SECURITY.md) and [facilitator documentation](../../apps/facilitator/README.md) supplied the current protocol boundaries and reference-implementation scope.

## Decisions made when reconciling the sources

Some older company wording describes a UDID as authorizing payment or becoming a settled token. These pages use the current normative specification instead. UDID asserts a determination. Payment authorization is separate, and settlement produces a separate receipt.

The older company material places the portable profile and facilitator among planned capabilities. The current repository contains a draft and a reference application. These pages acknowledge that implementation progress without upgrading it to a production-service claim.

The company uses Pay, Buy and Treat as product concepts. The current repository defines only the payment credential profile. These pages do not invent credential types or API routes for the wider product roadmap.

## External references

[T54's vision](https://docs.t54.ai/docs/company/vision) provided the structural reference: explain the company's problem, core engine, services and institutional responsibilities. The IXO prose is original and grounded in IXO's own material.

[T54's risk engine](https://docs.t54.ai/docs/trustline/risk-engine), [asynchronous underwriting API](https://docs.t54.ai/docs/trustline/async-underwriting), [external signals](https://docs.t54.ai/docs/trustline/external-signals) and [compatible protocols](https://docs.t54.ai/docs/reference/compatible-protocols) supplied the Trustline comparison. These are T54's published descriptions, not independent validation of its service.

The [standards page](06-standards.md) links each external protocol to its official documentation. All compatibility statements about IXO are limited to what the local specification and reference application establish, or explicitly labelled as intended relationships.

## What remains to establish

A Trustline connector needs an agreed exchange format, authenticated result verification, accepted issuers and policies, data-access rules and a tested dependency order. It also needs failure and conflict handling that cannot release a payment on an unresolved assessment.

A production payment integration needs the relevant provider access, versioned contracts, end-to-end evidence and operating ownership. Neither accelerator participation nor protocol documentation establishes that access.

No legal liability transfer, regulatory compliance certification, provider endorsement or guaranteed accuracy is claimed in these pages. Payment participants retain their own responsibilities. Product performance, pricing and launch dates need current evidence before publication as achieved facts.
