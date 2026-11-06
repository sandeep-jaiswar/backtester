import type { CostModel } from "./types";

/**
 * Named fee schedules. Shared by server and client, so keep this file free of server-only imports.
 * - `flat`: one commission rate in basis points on both sides (the original behaviour).
 * - `india-delivery`: NSE/BSE equity delivery (CNC) charges, applied per side.
 */
export const COST_PROFILES = ["flat", "india-delivery"] as const;
export type CostProfile = (typeof COST_PROFILES)[number];

export function flatCostModel(commissionBps: number): CostModel {
  const rate = commissionBps / 10_000;
  return { rateBuy: rate, rateSell: rate, fixedPerSell: 0 };
}

/**
 * Indian equity delivery charges, as fractions of traded value unless noted.
 *
 * These are the component rates as configured for this build. Statutory and exchange rates
 * change over time, and brokerage depends on the broker, so review this table against current
 * exchange and government notifications before relying on it. The DP charge is a fixed INR amount
 * per scrip per sell day, so it is left out of this currency-agnostic model.
 */
export const INDIA_DELIVERY_RATES = {
  /** Brokerage on delivery trades. Zero at many discount brokers; set a broker-specific value here if needed. */
  brokerage: 0,
  /** Securities Transaction Tax, 0.1% on both buy and sell for delivery. */
  stt: 0.001,
  /** NSE equity transaction charge, 0.00297% of turnover. */
  exchangeTxn: 0.0000297,
  /** SEBI turnover fee, INR 10 per crore = 0.0001%. */
  sebiFee: 0.000001,
  /** Stamp duty, 0.015% on the buy side only. */
  stampDutyBuy: 0.00015,
  /** GST, 18%, levied on brokerage, exchange charges and SEBI fee (not on STT or stamp duty). */
  gst: 0.18,
} as const;

export function indiaDeliveryCostModel(rates = INDIA_DELIVERY_RATES): CostModel {
  const gstBase = rates.brokerage + rates.exchangeTxn + rates.sebiFee;
  const gst = rates.gst * gstBase;
  const sellSide = rates.stt + gstBase + gst;
  return {
    rateBuy: sellSide + rates.stampDutyBuy,
    rateSell: sellSide,
    fixedPerSell: 0,
  };
}

/** Picks a default profile: Indian exchange suffixes get delivery charges, everything else gets flat bps. */
export function defaultCostProfileFor(symbol: string): CostProfile {
  return /\.(NS|BO)$/.test(symbol) ? "india-delivery" : "flat";
}

export function costModelFor(profile: CostProfile, commissionBps: number): CostModel {
  return profile === "india-delivery" ? indiaDeliveryCostModel() : flatCostModel(commissionBps);
}
