'use strict';

// 通用定价 / 放量经济学内核（与具体行业无关）
// 任何产品：由「固定成本（含开发费摊销）+ 单位变动成本 + 价格 + 需求（流量×转化×弹性）」推出
//   单位贡献 → 保本销量 → 月利润 → 回本周期 → 价格扫描（薄利多销 vs 高价）

const R = (n, d = 4) => { const p = 10 ** d; return Math.round(n * p) / p; };

// ---- 成本：全成本口径 ----
function normalizeCosts(costs = {}) {
  const c = {
    developmentCost: Number(costs.developmentCost) || 0,   // 一次性：开发/设计/测试
    launchCost: Number(costs.launchCost) || 0,             // 一次性：资质/设备/首批推广
    equipmentCost: Number(costs.equipmentCost) || 0,       // 一次性：硬件/服务器预付
    amortMonths: Number(costs.amortMonths) || 24,           // 一次性投入摊销月数
    fixedMonthly: Number(costs.fixedMonthly) || 0,          // 每月：服务器/域名/代理/监控
    laborMonthly: Number(costs.laborMonthly) || 0,          // 每月：运维/客服/人工
    paymentRate: Number(costs.paymentRate) || 0,            // 支付通道费率
    refundRate: Number(costs.refundRate) || 0,              // 退款/坏账率
    taxRate: Number(costs.taxRate) || 0                     // 税/平台抽成
  };
  c.capexTotal = R(c.developmentCost + c.launchCost + c.equipmentCost, 2);
  c.capexMonthly = R(c.capexTotal / Math.max(1, c.amortMonths), 2);
  c.fixedAllInMonthly = R(c.fixedMonthly + c.laborMonthly + c.capexMonthly, 2);
  c.feeRate = R(c.paymentRate + c.refundRate + c.taxRate, 4);
  return c;
}

// 单位净价（扣掉通道费/退款/税）
const netUnitPrice = (price, c) => R(Number(price) * (1 - c.feeRate), 4);

// 单位贡献毛利 = 净价 - 单位变动成本
const contribution = (price, c, varCost) => R(netUnitPrice(price, c) - Number(varCost || 0), 4);

// ============ 需求模型：流量 × 转化(随价格变化) ============
// conversion(p) = baseConversion * (p/basePrice)^(-elasticity)，再截断到 [0, maxConversion]
function conversionAt(demand = {}, price, refPrice) {
  const ref = Number(refPrice) > 0 ? Number(refPrice) : (Number(demand.basePrice) || 1);
  const baseConv = Number(demand.baseConversion) || 0;
  const e = Number(demand.elasticity);
  const elasticity = Number.isFinite(e) && e >= 0 ? e : 1.5;
  const maxConv = Number(demand.maxConversion) || 0.15;
  if (price <= 0) return maxConv;
  const conv = baseConv * Math.pow(price / ref, -elasticity);
  return Math.min(maxConv, Math.max(0, conv));
}

function unitsAt(demand = {}, price, refPrice) {
  const traffic = Number(demand.monthlyTraffic) || 0;
  return R(traffic * conversionAt(demand, price, refPrice), 2);
}

// 单个价格点的完整账
function atPrice(product, costs, demand, price, refPrice) {
  const p = Number(price) || 0;
  const ref = refPrice != null ? refPrice : (Number(product.price) || 0);
  const units = unitsAt(demand, p, ref);
  const contrib = contribution(p, costs, product.varCost);
  const revenue = R(units * p, 2);
  const varCostTotal = R(units * (Number(product.varCost) || 0), 2);
  const fees = R(revenue * costs.feeRate, 2);
  const grossProfit = R(units * contrib, 2);
  const profit = R(grossProfit - costs.fixedAllInMonthly, 2);
  return {
    price: p, units, revenue, varCostTotal, fees, grossProfit, profit,
    marginRate: revenue > 0 ? R((revenue - varCostTotal - fees) / revenue, 4) : null,
    contribution: contrib,
    contribRate: p > 0 ? R(contrib / (p * (1 - costs.feeRate)), 4) : null
  };
}

// 价格扫描
function sweep(product, costs, demand, { min, max, steps = 24 } = {}) {
  const base = Number(product.price) || Number(demand.basePrice) || 100;
  const lo = min != null ? min : Math.max(0.1, base * 0.3);
  const hi = max != null ? max : base * 3;
  const out = [];
  for (let i = 0; i <= steps; i += 1) {
    const p = R(lo + (hi - lo) * (i / steps), 2);
    out.push(atPrice(product, costs, demand, p, Number(product.price) || undefined));
  }
  return out;
}

// 最优：利润最大点、收入最大点、最小保本价
function optimize(product, costs, demand, opts) {
  const rows = sweep(product, costs, demand, opts);
  // 只在「单位贡献为正」的可行价里找最优，避免把亏本冲量的价当成最优
  const viable = rows.filter(r => r.contribution > 0);
  let profitMax = (viable[0] || rows[0]), revenueMax = (viable[0] || rows[0]);
  for (const r of viable) {
    if (r.profit > profitMax.profit) profitMax = r;
    if (r.revenue > revenueMax.revenue) revenueMax = r;
  }
  const breakeven = viable.filter(r => r.profit >= 0).sort((a, b) => a.price - b.price)[0] || null;
  return { rows, profitMax, revenueMax, breakevenPrice: breakeven ? breakeven.price : null };
}

// 保本销量（每月要卖多少份覆盖固定成本）
function breakevenUnits(product, costs, price) {
  const contrib = contribution(price, costs, product.varCost);
  if (contrib <= 0) return { feasible: false, units: null, contrib };
  return { feasible: true, units: Math.ceil(costs.fixedAllInMonthly / contrib), contrib };
}

// 回本周期（一次性投入 / 月净利）
function paybackMonths(costs, monthlyProfit) {
  if (!(monthlyProfit > 0)) return { months: null, note: '月净利非正，无法回本' };
  return { months: R(costs.capexTotal / monthlyProfit, 1), note: '' };
}

// 订阅类：LTV（按月流失）
function ltv(product, costs, price, churnMonthly = 0) {
  const contrib = contribution(price, costs, product.varCost);
  const churn = Number(churnMonthly) > 0 ? Number(churnMonthly) : 0.05;
  return { arpuNet: netUnitPrice(price, costs), contribution: contrib, churnMonthly: churn, ltv: R(contrib / churn, 2) };
}

// 多产品组合：按 share 分配流量，合计利润
function portfolio(products = [], costs, demand = {}) {
  const n = products.length || 1;
  let totalUnits = 0, totalRevenue = 0, totalGross = 0;
  const rows = products.map(pr => {
    const share = pr.share != null ? Number(pr.share) : 1 / n;
    const d = pr.demand ? { ...demand, ...pr.demand } : { ...demand, monthlyTraffic: (Number(demand.monthlyTraffic) || 0) * share };
    const r = atPrice(pr, costs, d, pr.price, pr.price);
    totalUnits += r.units; totalRevenue = R(totalRevenue + r.revenue, 2);
    totalGross = R(totalGross + r.grossProfit, 2);
    return { id: pr.id, name: pr.name, share, ...r };
  });
  // 固定成本在组合层面只扣一次
  const totalProfit = R(totalGross - costs.fixedAllInMonthly, 2);
  return { rows, totalUnits: R(totalUnits, 2), totalRevenue, totalGross, totalProfit };
}

// 规模情景：不同流量下的利润
function scenarios(product, costs, demand, trafficList = [200, 1000, 5000, 20000]) {
  return trafficList.map(t => {
    const d = { ...demand, monthlyTraffic: t };
    const r = atPrice(product, costs, d, product.price, product.price);
    return { traffic: t, conv: R(conversionAt(d, product.price, product.price), 4), units: r.units, revenue: r.revenue, profit: r.profit };
  });
}

module.exports = {
  R, normalizeCosts, netUnitPrice, contribution, conversionAt, unitsAt, atPrice,
  sweep, optimize, breakevenUnits, paybackMonths, ltv, portfolio, scenarios
};
