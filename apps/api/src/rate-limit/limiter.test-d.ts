import type { RateLimiter } from "./index";

type Group = Parameters<RateLimiter["consumeRateLimits"]>[0];
type Assert<Condition extends true> = Condition;

export type GroupRequiresWindow = Assert<
  Group extends { windowMs: number } ? true : false
>;
export type LimitsRejectWindow = Assert<
  "windowMs" extends keyof Group["limits"][number] ? false : true
>;
