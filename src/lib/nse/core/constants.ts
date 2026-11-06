/** Column lists from nselib/constants.py. Names and order are kept exactly. */

export const price_volume_and_deliverable_position_data_columns = [
  "Symbol", "Series", "Date", "PrevClose", "OpenPrice", "HighPrice", "LowPrice", "LastPrice", "ClosePrice",
  "AveragePrice", "TotalTradedQuantity", "TurnoverInRs", "No.ofTrades", "DeliverableQty", "%DlyQttoTradedQty",
];

export const price_volume_data_columns = [
  "Symbol", "Series", "Date", "PrevClose", "OpenPrice", "HighPrice", "LowPrice", "LastPrice", "ClosePrice",
  "AveragePrice", "TotalTradedQuantity", "Turnover", "No.ofTrades",
];

export const deliverable_data_columns = [
  "Symbol", "Series", "Date", "TradedQty", "DeliverableQty", "%DlyQttoTradedQty",
];

export const bulk_deal_data_columns = [
  "Date", "Symbol", "SecurityName", "ClientName", "Buy/Sell", "QuantityTraded", "TradePrice/Wght.Avg.Price", "Remarks",
];

export const block_deals_data_columns = [
  "Date", "Symbol", "SecurityName", "ClientName", "Buy/Sell", "QuantityTraded", "TradePrice/Wght.Avg.Price", "Remarks",
];

export const short_selling_data_columns = ["Date", "Symbol", "SecurityName", "Quantity"];

export const future_price_volume_data_column = [
  "TIMESTAMP", "INSTRUMENT", "SYMBOL", "EXPIRY_DT", "STRIKE_PRICE", "OPTION_TYPE", "MARKET_TYPE", "OPENING_PRICE",
  "TRADE_HIGH_PRICE", "TRADE_LOW_PRICE", "CLOSING_PRICE", "LAST_TRADED_PRICE", "PREV_CLS", "SETTLE_PRICE",
  "TOT_TRADED_QTY", "TOT_TRADED_VAL", "OPEN_INT", "CHANGE_IN_OI", "MARKET_LOT", "UNDERLYING_VALUE",
];

export const india_vix_data_column = [
  "TIMESTAMP", "INDEX_NAME", "OPEN_INDEX_VAL", "CLOSE_INDEX_VAL", "HIGH_INDEX_VAL", "LOW_INDEX_VAL", "PREV_CLOSE",
  "VIX_PTS_CHG", "VIX_PERC_CHG",
];

export const index_data_columns = [
  "INDEX_NAME", "OPEN_INDEX_VAL", "HIGH_INDEX_VAL", "CLOSE_INDEX_VAL", "LOW_INDEX_VAL", "TURN_OVER", "TRADED_QTY",
  "TIMESTAMP",
];

export const var_columns = [
  "RecordType", "Symbol", "Series", "Isin", "SecurityVaR", "IndexVaR", "VaRMargin", "ExtremeLossRate", "AdhocMargin",
  "ApplicableMarginRate",
];

/** nselib `indices_list` used to detect index option chains. */
export const OPTION_INDICES = ["NIFTY", "FINNIFTY", "BANKNIFTY"] as const;

/** Mirrors libutil.cleaning_column_name: strips NSE's FH_, EOD_ and HIT_ prefixes. */
export function cleaningColumnName(col: string): string {
  let out = col;
  for (const prefix of ["FH_", "EOD_", "HIT_"]) out = out.split(prefix).join("");
  return out;
}

/** Mirrors libutil.cleaning_nse_symbol: '&' becomes %26 for URLs, then upper-cases. */
export function cleaningNseSymbol(symbol: string): string {
  return symbol.replace(/&/g, "%26").toUpperCase();
}
