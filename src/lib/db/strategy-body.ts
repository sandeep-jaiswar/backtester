import { z } from "zod";
import { ruleDefinitionSchema } from "../backtest/rules";

export const strategyBodySchema = z.object({
  name: z.string().trim().min(1, "Give the strategy a name").max(60),
  description: z.string().trim().max(300).default(""),
  definition: ruleDefinitionSchema,
});

export type StrategyBody = z.output<typeof strategyBodySchema>;
