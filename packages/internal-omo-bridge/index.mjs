/**
 * @deprecated Since v1.11.1 this package is retired from the Shipping release gates
 * (see ../../dev-wiki/decisions/2026-09-13-shipping-harness-private-OMO-브리지-은퇴.md).
 * The pinned private OMO runtime repository was archived, so `executePrivateOmoRuntime`
 * and `verifyPrivateOmoPromotion` can no longer reach a live runtime. The package is
 * retained only for the stable `omoWorkOrder`/`omoReceipt` schemas and to read historical
 * receipts; reactivating it requires a new ADR and a new Shipping contract. See
 * ./DEPRECATED.md.
 */
export { executeShippingPrivateOmo, privateOmoFallbackDecision } from './bridge.mjs';
export { executePrivateOmoRuntime, privateOmoDoctor, privateOmoStatus, cancelPrivateOmo } from './client.mjs';
export { loadPrivateOmoConfig, verifyPrivateOmoPromotion } from './config.mjs';
export { loadOrCreateBridgeKey } from './key.mjs';
export { validatePrivateOmoReceipt } from './receipt.mjs';
export { createPrivateOmoWorkOrder } from './work-order.mjs';
