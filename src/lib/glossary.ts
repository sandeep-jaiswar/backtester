/** Plain-English definitions for the metrics shown in the app. Keep them short and accurate. */
export const GLOSSARY = {
  cagr: {
    label: "CAGR",
    definition: "Compound annual growth rate: the steady yearly return that takes the start value to the end value.",
  },
  volatility: { label: "Volatility", definition: "Annualised standard deviation of daily returns. Higher means a bumpier ride." },
  sharpe: {
    label: "Sharpe",
    definition: "Average daily return above the risk-free rate, divided by its standard deviation, annualised. Higher is better.",
  },
  sortino: {
    label: "Sortino",
    definition: "Like Sharpe, but it only penalises downside volatility. Higher is better.",
  },
  calmar: { label: "Calmar", definition: "CAGR divided by the largest drawdown. Higher is better." },
  maxDrawdown: { label: "Max drawdown", definition: "The largest fall from a peak to a later low, in percent." },
  winRate: { label: "Win rate", definition: "The share of closed trades that made a profit." },
  profitFactor: {
    label: "Profit factor",
    definition: "Total profit from winning trades divided by total loss from losing trades. Above 1 means a net profit.",
  },
  exposure: { label: "Time in market", definition: "The share of bars on which the strategy held a position." },
  alpha: {
    label: "Alpha",
    definition: "Return beyond what the strategy's beta to buy & hold would explain, annualised with the risk-free rate.",
  },
  beta: { label: "Beta", definition: "How closely the strategy moved with buy & hold. 1 means it moved one-for-one." },
  informationRatio: {
    label: "Information ratio",
    definition: "Average daily return above buy & hold, divided by the tracking error, annualised. Higher is better.",
  },
  trackingError: {
    label: "Tracking error",
    definition: "How far the strategy's daily returns strayed from buy & hold's, annualised.",
  },
  upCapture: {
    label: "Up capture",
    definition: "The strategy's return on days buy & hold rose, as a share of buy & hold's return on those days.",
  },
  downCapture: {
    label: "Down capture",
    definition: "The strategy's return on days buy & hold fell, as a share of buy & hold's return on those days. Lower is better.",
  },
} as const;

export type GlossaryKey = keyof typeof GLOSSARY;
