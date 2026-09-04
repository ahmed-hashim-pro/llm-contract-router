export { createRouter, costOf } from "./core/router.js";
export type { Router, RouterConfig, CompleteOptions } from "./core/router.js";

export { defineContract, fromSafeParser } from "./core/contract.js";
export type { SafeParser } from "./core/contract.js";

export { defaultCalibration, buildSystemPrompt, buildRepairPrompt, exampleFromSchema } from "./core/calibration.js";
export type { TierCalibration } from "./core/calibration.js";

export { extractJson } from "./core/extract.js";

export { ProviderError } from "./core/types.js";
export type {
  Tier, ModelSpec, Provider, ProviderRequest, ProviderResponse,
  TokenUsage, FailureKind, Contract, ContractResult,
} from "./core/types.js";

export type { Attempt, RouteMeta, RouteResult, RouterError, RouterErrorKind } from "./core/result.js";

export { models, withPricing, defineModel } from "./core/models.js";
export type { ModelIdentity, Pricing } from "./core/models.js";
