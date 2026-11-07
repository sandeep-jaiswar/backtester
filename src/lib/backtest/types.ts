/** One OHLCV bar. Prices are dividend/split adjusted (see market-data/yahoo.ts). */
export interface Bar {
  date: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface ParamSpec {
  key: string;
  label: string;
  default: number;
  min: number;
  max: number;
  step: number;
  integer?: boolean;
}

/**
 * A strategy turns price history into a long/flat decision for every bar.
 *
 * `signals` must return an array the same length as `bars`, where `out[i] === true`
 * means "be long at the CLOSE of bar i". The engine executes that decision at the
 * OPEN of bar i+1, so a strategy can never trade on prices it has not yet seen.
 *
 * Rule for custom strategies: when computing bar i, only read bars[0..i].
 */
export interface Strategy {
  id: string;
  name: string;
  description: string;
  params: ParamSpec[];
  signals(bars: Bar[], params: Record<string, number>): boolean[];
  /** Hash of the rule definition, for custom strategies. Built-in strategies leave it unset. */
  definitionHash?: string;
}

/**
 * Linear cost model. Fees are fractions of traded notional, plus an optional fixed fee per sell.
 * Example: 10 bps commission = { rateBuy: 0.001, rateSell: 0.001, fixedPerSell: 0 }.
 */
export interface CostModel {
  rateBuy: number;
  rateSell: number;
  fixedPerSell: number;
}

export interface BacktestConfig {
  initialCapital: number;
  /** Broker commission per side, in basis points of traded value. Used when `costModel` is absent. */
  commissionBps: number;
  /** Slippage per side, in basis points, applied against the trader. */
  slippageBps: number;
  /** Explicit fee schedule. Overrides `commissionBps` when present. */
  costModel?: CostModel;
  /** Stop-loss, in percent below the entry fill. Omit to disable. */
  stopLossPct?: number;
  /** Take-profit, in percent above the entry fill. Omit to disable. */
  takeProfitPct?: number;
  /** Share of available cash spent on each entry, in (0, 1]. Omit for all-in (1). */
  positionFraction?: number;
}

/** Why a position was closed. */
export type ExitReason = "signal" | "stop" | "target" | "end";

export interface Trade {
  entryDate: string;
  entryPrice: number;
  exitDate: string;
  exitPrice: number;
  shares: number;
  pnl: number;
  returnPct: number;
  barsHeld: number;
  /** Total fees paid on both legs of the trade, in account currency. */
  fees: number;
  /** True if the position was still open on the last bar and was marked to market. */
  openAtEnd: boolean;
  /** Absent on runs saved before exit reasons were recorded. */
  exitReason?: ExitReason;
}

export interface EngineResult {
  /** Portfolio value at each bar's close. */
  equity: number[];
  trades: Trade[];
  /** Number of bars during which the portfolio held shares. */
  barsInMarket: number;
  /** Sum of all fees across the run. */
  totalFees: number;
}

export interface Metrics {
  startValue: number;
  endValue: number;
  totalReturnPct: number;
  cagrPct: number;
  maxDrawdownPct: number;
  volatilityPct: number;
  sharpe: number;
  /** Downside-risk-adjusted return. 0 when there are no down days. */
  sortino: number;
  calmar: number;
  tradeCount: number;
  winRatePct: number;
  avgTradeReturnPct: number;
  /** Gross profit / gross loss. `null` when there are no losing trades (the ratio is unbounded). */
  profitFactor: number | null;
  totalFeesPaid: number;
  avgBarsHeld: number;
  exposurePct: number;
  /** Comparison with the buy-and-hold benchmark on the same bars. Absent when there is no benchmark. */
  benchmark?: BenchmarkStats | null;
}

export interface BenchmarkStats {
  /** Annualised CAPM alpha in percent, using the risk-free rate. Arithmetic annualisation (daily x 252). */
  alphaPct: number;
  beta: number;
  /** Mean daily active return / tracking error, annualised. */
  informationRatio: number;
  /** Annualised standard deviation of daily active returns, in percent. */
  trackingErrorPct: number;
  /** Mean strategy return on benchmark-up days relative to the benchmark's, in percent. Null if no up days. */
  upCapturePct: number | null;
  /** Same as upCapturePct, over benchmark-down days. */
  downCapturePct: number | null;
}
