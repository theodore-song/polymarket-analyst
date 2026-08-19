import { auditLiquidity } from "../lib/liquidity-audit.js";

const report = await auditLiquidity({
  marketLimit: Number(process.env.LIQUIDITY_MARKETS || 100),
  minHoursToEnd: Number(process.env.LIQUIDITY_MIN_HOURS || 48),
});

console.log(JSON.stringify(report, null, 2));
