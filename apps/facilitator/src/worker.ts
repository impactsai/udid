import { DurableObject } from 'cloudflare:workers';
import { authenticate, loadConfig, type RuntimeEnv } from './config';
import { FacilitatorEngine } from './engine';
import { UCAN, UDID, offerInputSchema, requestSchema, type Store } from './model';
import { advertise, createOffer } from './offers';
import { supported, resolveRail } from './rails';
import { AppError, decodeHeader, encodeHeader, errorCode, errorResponse, json, readJson, requireThat } from './util';

export interface Env extends RuntimeEnv { COORDINATOR: DurableObjectNamespace<FacilitatorCoordinator> }

function storageAdapter(storage: DurableObjectStorage | DurableObjectTransaction): Store {
  return {
    get: key => storage.get(key), put: (key, value) => storage.put(key, value),
    transaction: fn => 'transaction' in storage
      ? storage.transaction(tx => fn(storageAdapter(tx)))
      : fn(storageAdapter(storage)),
  };
}

export class FacilitatorCoordinator extends DurableObject<Env> {
  private engine;
  private store;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.store = storageAdapter(ctx.storage);
    this.engine = new FacilitatorEngine(this.store, env);
  }
  async fetch(request: Request): Promise<Response> {
    const started = Date.now(), requestId = crypto.randomUUID();
    let tenantId: string | undefined;
    let outcomeCode = 'ok';
    let response: Response;
    try {
      const config = loadConfig(this.env);
      const tenant = await authenticate(request, config);
      tenantId = tenant.id;
      const path = new URL(request.url).pathname;
      const rateKey = `rate:${tenant.id}`;
      await this.store.transaction(async tx => {
        const minute = Math.floor(Date.now() / 60_000);
        const current = await tx.get<{ minute: number; count: number }>(rateKey);
        const count = current?.minute === minute ? current.count + 1 : 1;
        requireThat(count <= tenant.requestsPerMinute, 'rate_limited', 429);
        await tx.put(rateKey, { minute, count });
      });
      if (request.method === 'GET' && /^\/settlements\/[a-f0-9]{64}$/.test(path)) {
        response = json(await this.engine.status(path.slice('/settlements/'.length), tenant.id));
      } else {
        requireThat(request.method === 'POST', 'method_not_allowed', 405);
        const body = await readJson(request);
        if (path === '/offers') {
          const offer = await createOffer(offerInputSchema.parse(body), tenant, Date.now());
          resolveRail(config, this.env, offer.requirements);
          await this.store.put(`offer:${offer.id}`, offer);
          response = json(advertise(offer, tenant), 201);
        } else {
          requireThat(path === '/verify' || path === '/settle', 'not_found', 404);
          if (body && typeof body === 'object' && 'paymentPayload' in body && typeof body.paymentPayload === 'string') body.paymentPayload = decodeHeader(body.paymentPayload);
          const payment = requestSchema.parse(body);
          try {
            if (path === '/verify') {
              const checked = await this.engine.verify(payment, tenant, config);
              response = json(checked.verification, 200, { 'EXTENSION-RESPONSES': encodeHeader({ [UCAN]: { status: checked.proof.ucan }, [UDID]: { status: checked.proof.udid } }) });
            } else {
              const settled = await this.engine.settle(payment, tenant, config);
              outcomeCode = settled.success ? 'settled' : settled.errorReason ?? 'settlement_failed';
              response = json(settled);
            }
          } catch (error) {
            // Invalid payment/proofs use x402 response shapes. Infrastructure failures remain retryable 503s.
            outcomeCode = errorCode(error);
            const status = (error instanceof AppError && error.status < 500) || outcomeCode === 'invalid_request' ? 200 : 503;
            response = path === '/verify'
              ? json({ isValid: false, invalidReason: errorCode(error) }, status)
              : json({ success: false, transaction: '', network: payment.paymentRequirements.network, errorReason: errorCode(error) }, status);
          }
        }
      }
    } catch (error) { outcomeCode = errorCode(error); response = errorResponse(error); }
    response.headers.set('x-request-id', requestId);
    console.log(JSON.stringify({ event: 'facilitator_request', requestId, tenantId, path: new URL(request.url).pathname,
      method: request.method, status: response.status, outcomeCode, durationMs: Date.now() - started }));
    return response;
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname;
    try {
      if (request.method === 'GET' && path === '/') return json({ name: 'UDID x402 facilitator reference', version: '0.1.0', endpoints: ['/health', '/supported', '/offers', '/verify', '/settle', '/settlements/:id'] });
      if (request.method === 'GET' && ['/health', '/supported', '/networks'].includes(path)) {
        const config = loadConfig(env), support = supported(config, env);
        return path === '/health'
          ? json({ status: 'ok', configured: config.tenants.length > 0 && support.kinds.length > 0 })
          : json(support);
      }
      requireThat(['/offers', '/verify', '/settle'].includes(path) || /^\/settlements\/[a-f0-9]{64}$/.test(path), 'not_found', 404);
      // Authenticate before a request can allocate work on the shared coordinator.
      await authenticate(request, loadConfig(env));
      return env.COORDINATOR.get(env.COORDINATOR.idFromName('operator-v1')).fetch(request);
    } catch (error) { return errorResponse(error); }
  },
} satisfies ExportedHandler<Env>;
