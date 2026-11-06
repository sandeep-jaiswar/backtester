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
}

export interface BacktestConfig {
  initialCapital: number;
  /** Broker commission per side, in basis points of traded value. */
  commissionBps: number;
  /** Slippage per side, in basis points, applied against the trader. */
  slippageBps: number;
}

export interface Trade {
  entryDate: string;
  entryPrice: number;
  exitDate: string;
  exitPrice: number;
  shares: number;
  pnl: number;
  returnPct: number;
  barsHeld: number;
  /** True if the position was still open on the last bar and was marked to market. */
  openAtEnd: boolean;
}

export interface EngineResult {
  /** Portfolio value at each bar's close. */
  equity: number[];
  trades: Trade[];
  /** Number of bars during which the portfolio held shares. */
  barsInMarket: number;
}

export interface Metrics {
  startValue: number;
  endValue: number;
  totalReturnPct: number;
  cagrPct: number;
  maxDrawdownPct: number;
  volatilityPct: number;
  sharpe: number;
  calmar: number;
  tradeCount: number;
  winRatePct: number;
  avgTradeReturnPct: number;
  profitFactor: number;
  avgBarsHeld: number;
  exposurePct: number;
}
