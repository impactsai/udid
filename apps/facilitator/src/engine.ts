import type { OperatorConfig, RuntimeEnv, Tenant } from './config';
import { type Offer, type PaymentRequest, type RailAdapter, type SettlementRecord, type SettlementResult, type Store } from './model';
import { paymentRule } from './offers';
import { verifyProofs } from './proofs';
import { resolveRail } from './rails';
import { canonical, hashObject, requireThat } from './util';

type RailFactory = (config: OperatorConfig, env: RuntimeEnv, offer: Offer) => RailAdapter;
export class FacilitatorEngine {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private store: Store, private env: RuntimeEnv,
    private railFactory: RailFactory = (config, env, offer) => resolveRail(config, env, offer.requirements),
    private now = () => Date.now()) {}

  /** Serializes this deployment's settlement lane, including its EVM gas-wallet nonce. */
  settle(request: PaymentRequest, tenant: Tenant, config: OperatorConfig): Promise<SettlementResult> {
    const next = this.tail.then(() => this.settleSerial(request, tenant, config));
    this.tail = next.catch(() => undefined);
    return next;
  }
  private async context(request: PaymentRequest, tenant: Tenant, config: OperatorConfig) {
    const offer = await this.store.get<Offer>(`offer:${request.offerId}`);
    requireThat(offer && offer.tenantId === tenant.id, 'offer_not_found', 404);
    requireThat(canonical(request.paymentRequirements) === canonical(offer.requirements)
      && canonical(request.paymentPayload.accepted) === canonical(offer.requirements), 'offer_mismatch', 403);
    if (request.paymentPayload.resource) requireThat(request.paymentPayload.resource.url === offer.resource.url, 'resource_mismatch', 403);
    const rail = this.railFactory(config, this.env, offer);
    const paymentKey = await rail.paymentKey(request.paymentPayload);
    const id = paymentKey.slice(7);
    const fingerprint = await hashObject({ tenant: tenant.id, request });
    const record = await this.store.get<SettlementRecord>(`payment:${id}`);
    if (record) requireThat(record.fingerprint === fingerprint && record.tenantId === tenant.id, 'payment_replay', 409);
    return { offer, rail, id, fingerprint, record };
  }
  private async validate(request: PaymentRequest, offer: Offer, tenant: Tenant, rail: RailAdapter) {
    paymentRule(tenant, offer.requirements);
    requireThat(this.now() < offer.expiresAt, 'offer_expired', 403);
    const effective = { ...offer, requireUcan: offer.requireUcan || tenant.requireUcan, requireUdid: offer.requireUdid || tenant.requireUdid };
    requireThat(!effective.requireUdid || offer.holderBinding === (tenant.decision?.holderBinding ?? 'none'), 'offer_policy_changed', 403);
    const payer = rail.payer(request.paymentPayload);
    const proof = await verifyProofs(request.paymentPayload, effective, tenant, payer, this.env, this.now());
    const verification = await rail.verify(request.paymentPayload, offer.requirements, offer);
    requireThat(verification.isValid, verification.invalidReason ?? 'invalid_payment', 403);
    requireThat(verification.payer === payer, 'payer_mismatch', 403);
    requireThat(this.now() < offer.expiresAt, 'offer_expired', 403);
    return { payer, proof, verification };
  }
  async verify(request: PaymentRequest, tenant: Tenant, config: OperatorConfig) {
    const { offer, rail, id, record } = await this.context(request, tenant, config);
    requireThat(!record, 'payment_already_consumed', 409);
    const checked = await this.validate(request, offer, tenant, rail);
    if (checked.proof.decision) {
      const consumed = await this.store.get<string>(`decision:${checked.proof.decision.replayKey}`);
      requireThat(!consumed, 'decision_replay', 409);
    }
    const offerConsumption = await this.store.get<string>(`consumed-offer:${offer.id}`);
    requireThat(!offerConsumption || offerConsumption === id, 'offer_already_consumed', 409);
    return checked;
  }
  private receipt(record: SettlementRecord, result: SettlementResult, replayed: boolean): SettlementResult {
    return { ...result, extensions: {
      'org.udid.receipt@1': { settlementId: record.id, offerId: record.offerId, replayed,
        ...(record.proof.decision ? { decision: { issuer: record.proof.decision.issuer, id: record.proof.decision.id } } : {}) },
    } };
  }
  private async settleSerial(request: PaymentRequest, tenant: Tenant, config: OperatorConfig): Promise<SettlementResult> {
    const { offer, rail, id, fingerprint, record: existing } = await this.context(request, tenant, config);
    if (existing?.result && existing.state !== 'prepared') return this.receipt(existing, existing.result, true);
    let record = existing;
    if (!record?.prepared) {
      const { payer, proof } = await this.validate(request, offer, tenant, rail);
      const rule = paymentRule(tenant, offer.requirements);
      const candidate: SettlementRecord = { id, fingerprint, tenantId: tenant.id, offerId: offer.id, payer,
        network: offer.requirements.network, createdAt: this.now(), proof, state: 'reserved' };
      // Reserve the offer, decision, payment and budget together, before any external mutation.
      await this.store.transaction(async tx => {
        const current = await tx.get<SettlementRecord>(`payment:${id}`);
        if (current) {
          requireThat(current.fingerprint === fingerprint, 'payment_replay', 409);
          return;
        }
        requireThat(!await tx.get(`consumed-offer:${offer.id}`), 'offer_already_consumed', 409);
        if (proof.decision) requireThat(!await tx.get(`decision:${proof.decision.replayKey}`), 'decision_replay', 409);
        const day = new Date(this.now()).toISOString().slice(0, 10);
        const budgetKey = `budget:${await hashObject([tenant.id, rule.scheme, rule.network, rule.asset, rule.payTo, day])}`;
        const used = BigInt(await tx.get<string>(budgetKey) ?? '0');
        requireThat(used + BigInt(offer.requirements.amount) <= BigInt(rule.dailyBudget), 'daily_budget_exceeded', 403);
        await tx.put(budgetKey, (used + BigInt(offer.requirements.amount)).toString());
        await tx.put(`consumed-offer:${offer.id}`, id);
        if (proof.decision) await tx.put(`decision:${proof.decision.replayKey}`, id);
        await tx.put(`payment:${id}`, candidate);
      });
      record = existing ?? candidate;
      const nonceKey = `nonce:${offer.requirements.network}`;
      const prepared = await rail.prepare(request.paymentPayload, offer.requirements, await this.store.get<number>(nonceKey));
      record = { ...record, prepared, state: 'prepared' };
      await this.store.transaction(async tx => {
        await tx.put(`payment:${id}`, record!);
        if (prepared.nonce !== undefined) await tx.put(nonceKey, prepared.nonce + 1);
      });
    }
    requireThat(record?.prepared, 'settlement_state_invalid', 503);
    let result: SettlementResult;
    try { result = await rail.submit(record.prepared, offer.requirements, record.payer); }
    catch { result = { success: false, transaction: record.prepared.transaction, network: record.network, payer: record.payer, errorReason: 'settlement_pending' }; }
    requireThat(result.transaction === record.prepared.transaction && result.network === record.network, 'rail_response_mismatch', 503);
    record.result = result;
    record.state = result.success ? 'settled' : result.errorReason === 'settlement_pending' ? 'prepared' : 'failed';
    await this.store.put(`payment:${id}`, record);
    return this.receipt(record, result, Boolean(existing));
  }
  async status(id: string, tenantId: string) {
    const record = await this.store.get<SettlementRecord>(`payment:${id}`);
    requireThat(record?.tenantId === tenantId, 'settlement_not_found', 404);
    return { settlementId: id, offerId: record.offerId, state: record.state,
      ...(record.result ? { result: this.receipt(record, record.result, true) } : {}) };
  }
}
