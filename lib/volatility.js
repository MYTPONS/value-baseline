'use strict';

// 市场波动层：把「点估计」升级为「分布 + 风险」
//   - 需求波动：流量、转化率（对数正态）
//   - 价格弹性不确定：区间均匀
//   - 成本波动：单位变动成本漂移+方差、费率波动、固定成本波动
//   - 竞品/市场波动：竞品降价概率 × 幅度 → 按弹性折算成我方转化下滑
// 输出：利润分布(P5/P50/P95)、亏损概率、敏感度龙卷风、悲观/基准/乐观情景、风险调整最优价。

const E = require('./economics');

function rngFactory(seed = 20261124) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function randn(rng) {
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
function lognormal(rng, median, cv) {
  const s2 = Math.log(1 + cv * cv);
  const mu = Math.log(Math.max(1e-9, median)) - s2 / 2;
  return Math.exp(mu + Math.sqrt(s2) * randn(rng));
}
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

function normalizeVol(v = {}) {
  return {
    runs: Math.max(200, Number(v.runs) || 2000),
    seed: v.seed != null ? Number(v.seed) : 20261124,
    traffic: { cv: Number(v.traffic && v.traffic.cv != null ? v.traffic.cv : 0.35) },
    conversion: { cv: Number(v.conversion && v.conversion.cv != null ? v.conversion.cv : 0.30) },
    elasticity: {
      min: Number(v.elasticity && v.elasticity.min != null ? v.elasticity.min : 0.8),
      max: Number(v.elasticity && v.elasticity.max != null ? v.elasticity.max : 2.6)
    },
    varCost: {
      cv: Number(v.varCost && v.varCost.cv != null ? v.varCost.cv : 0.12),
      drift: Number(v.varCost && v.varCost.drift != null ? v.varCost.drift : 0.03)
    },
    fee: { sd: Number(v.fee && v.fee.sd != null ? v.fee.sd : 0.005) },
    anchor: {
      prob: Number(v.anchor && v.anchor.prob != null ? v.anchor.prob : 0.25),
      drop: Number(v.anchor && v.anchor.drop != null ? v.anchor.drop : 0.15)
    },
    fixed: { cv: Number(v.fixed && v.fixed.cv != null ? v.fixed.cv : 0.05) }
  };
}

// 单次抽样
function oneRun(product, costs, demand, vol, price, rng, refPrice) {
  const ref = refPrice != null ? refPrice : product.price;
  const traffic = Math.max(0, (Number(demand.monthlyTraffic) || 0) * lognormal(rng, 1, vol.traffic.cv));
  const convBase = Number(demand.baseConversion) || 0;
  const elasticity = vol.elasticity.min + (vol.elasticity.max - vol.elasticity.min) * rng();
  const relConv = price > 0 ? Math.pow(price / (ref > 0 ? ref : 1), -elasticity) : 1;
  let conv = convBase * lognormal(rng, 1, vol.conversion.cv) * relConv;
  // 竞品降价冲击：相对变贵 → 转化按弹性下滑
  const anchorHit = rng() < vol.anchor.prob;
  if (anchorHit) conv *= Math.pow(1 - vol.anchor.drop, elasticity);
  conv = clamp(conv, 0, Number(demand.maxConversion) || 0.4);

  const varCost = Math.max(0, (Number(product.varCost) || 0) * lognormal(rng, 1 + vol.varCost.drift, vol.varCost.cv));
  const feeRate = clamp(costs.feeRate + randn(rng) * vol.fee.sd, 0, 0.5);
  const fixed = Math.max(0, costs.fixedAllInMonthly * lognormal(rng, 1, vol.fixed.cv));

  const units = traffic * conv;
  const contribution = price * (1 - feeRate) - varCost;
  const revenue = units * price;
  const grossProfit = units * contribution;
  const profit = grossProfit - fixed;
  return { traffic, conv, elasticity, varCost, feeRate, fixed, units, revenue, contribution, grossProfit, profit, anchorHit };
}

function summarize(arr) {
  const s = arr.slice().sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1))))];
  const mean = s.reduce((a, b) => a + b, 0) / s.length;
  return { n: s.length, mean: E.R(mean, 2), p5: E.R(q(0.05), 2), p25: E.R(q(0.25), 2), p50: E.R(q(0.5), 2), p75: E.R(q(0.75), 2), p95: E.R(q(0.95), 2), min: E.R(s[0], 2), max: E.R(s[s.length - 1], 2) };
}

// 蒙特卡洛：价格 price 下的利润/收入分布
function monteCarlo(product, costs, demand, vol, price, runs) {
  const rng = rngFactory(vol.seed);
  const N = runs || vol.runs;
  const profits = []; const revenues = []; const unitsArr = []; const convs = []; let anchorHits = 0;
  for (let i = 0; i < N; i += 1) {
    const r = oneRun(product, costs, demand, vol, price, rng, product.price);
    profits.push(r.profit); revenues.push(r.revenue); unitsArr.push(r.units); convs.push(r.conv);
    if (r.anchorHit) anchorHits += 1;
  }
  const lossProb = profits.filter(x => x < 0).length / N;
  return {
    price,
    profit: summarize(profits), revenue: summarize(revenues), units: summarize(unitsArr), conv: summarize(convs),
    lossProb: E.R(lossProb, 4),
    anchorHitRate: E.R(anchorHits / N, 4)
  };
}

// 确定性敏感度（单变量冲击），按对净利的摆幅排序 = 龙卷风图
function sensitivity(product, costs, demand, vol, price, delta = 0.2) {
  const baseProfit = E.atPrice(product, costs, { ...demand }, price, product.price).profit;
  const shock = ({ demandPatch = {}, productPatch = {}, feeRate, priceOverride, convMul = 1 }) => {
    const p2 = { ...product, ...productPatch };
    const c2 = { ...costs };
    if (feeRate != null) { c2.feeRate = feeRate; c2.paymentRate = Math.max(0, feeRate - (costs.refundRate || 0) - (costs.taxRate || 0)); }
    const d2 = { ...demand, ...demandPatch };
    if (convMul !== 1) d2.baseConversion = (demand.baseConversion || 0) * convMul;
    return E.atPrice(p2, c2, d2, priceOverride != null ? priceOverride : price, product.price).profit;
  };
  const e = Number(demand.elasticity) || 1.5;
  const drivers = [
    { name: '月流量 ±20%', low: shock({ demandPatch: { monthlyTraffic: (demand.monthlyTraffic || 0) * (1 - delta) } }), high: shock({ demandPatch: { monthlyTraffic: (demand.monthlyTraffic || 0) * (1 + delta) } }) },
    { name: '基准转化率 ±20%', low: shock({ demandPatch: { baseConversion: (demand.baseConversion || 0) * (1 - delta) } }), high: shock({ demandPatch: { baseConversion: (demand.baseConversion || 0) * (1 + delta) } }) },
    { name: '单位变动成本 ±20%', low: shock({ productPatch: { varCost: (product.varCost || 0) * (1 + delta) } }), high: shock({ productPatch: { varCost: (product.varCost || 0) * (1 - delta) } }) },
    { name: '竞品价格 ±15%', low: shock({ convMul: Math.pow(1 - 0.15, e) }), high: shock({ convMul: Math.pow(1 + 0.15, e) }) },
    { name: '支付/退款费率 ±1pt', low: shock({ feeRate: Math.min(0.5, costs.feeRate + 0.01) }), high: shock({ feeRate: Math.max(0, costs.feeRate - 0.01) }) },
    { name: '价格弹性（+10%价时）', low: shock({ priceOverride: price * 1.1, demandPatch: { elasticity: e * (1 + delta) } }), high: shock({ priceOverride: price * 1.1, demandPatch: { elasticity: e * (1 - delta) } }) }
  ];
  const rows = drivers.map(d => ({ name: d.name, low: E.R(d.low, 2), high: E.R(d.high, 2), swing: E.R(Math.abs(d.high - d.low), 2) }))
    .sort((a, b) => b.swing - a.swing);
  return { baseProfit: E.R(baseProfit, 2), delta, rows };
}

// 悲观 / 基准 / 乐观（参数组合）
function scenarios(product, costs, demand, price) {
  const calc = (dm, pm, cm) => {
    const d = { ...demand, ...dm }; const p = { ...product, ...pm }; const c = { ...costs, ...cm };
    return E.atPrice(p, c, d, price, product.price);
  };
  const base = calc({}, {}, {});
  const pess = calc(
    { monthlyTraffic: (demand.monthlyTraffic || 0) * 0.6, baseConversion: (demand.baseConversion || 0) * 0.7, elasticity: (Number(demand.elasticity) || 1.5) * 1.3 },
    { varCost: (product.varCost || 0) * 1.15 },
    { paymentRate: (costs.paymentRate || 0) + 0.01 }
  );
  const opt = calc(
    { monthlyTraffic: (demand.monthlyTraffic || 0) * 1.5, baseConversion: (demand.baseConversion || 0) * 1.25 },
    { varCost: (product.varCost || 0) * 0.95 },
    {}
  );
  return [
    { label: '悲观', profit: pess.profit, revenue: pess.revenue, units: pess.units },
    { label: '基准', profit: base.profit, revenue: base.revenue, units: base.units },
    { label: '乐观', profit: opt.profit, revenue: opt.revenue, units: opt.units }
  ];
}

// 价格带 + 风险调整最优价：每个价位算亏损概率与中位净利
function priceBand(product, costs, demand, vol, { min, max, steps = 14, runs = 800, lossTolerance = 0.2 } = {}) {
  const base = Number(product.price) || 1;
  const lo = min != null ? min : base * 0.6;
  const hi = max != null ? max : base * 2.2;
  const rows = [];
  for (let i = 0; i <= steps; i += 1) {
    const p = E.R(lo + (hi - lo) * (i / steps), 2);
    const mc = monteCarlo(product, costs, demand, vol, p, runs);
    rows.push({ price: p, median: mc.profit.p50, p5: mc.profit.p5, p95: mc.profit.p95, lossProb: mc.lossProb, expProfit: mc.profit.mean });
  }
  const underTol = rows.filter(r => r.lossProb <= lossTolerance);
  const pool = underTol.length ? underTol : rows;
  const best = pool.slice().sort((a, b) => b.median - a.median)[0];
  const safe = rows.slice().sort((a, b) => (a.lossProb - b.lossProb) || (b.median - a.median))[0];
  return { rows, riskAdjustedPrice: best ? best.price : null, safestPrice: safe ? safe.price : null, lossTolerance };
}

// 汇总一个产品在现价下的风险画像
function riskProfile(product, costs, demand, vol, opts = {}) {
  const mc = monteCarlo(product, costs, demand, vol, product.price, opts.runs);
  return {
    vol,
    mc,
    sensitivity: sensitivity(product, costs, demand, vol, product.price, opts.delta || 0.2),
    scenarios: scenarios(product, costs, demand, product.price),
    band: priceBand(product, costs, demand, vol, { runs: opts.bandRuns || 500, lossTolerance: opts.lossTolerance || 0.2 })
  };
}

module.exports = { normalizeVol, monteCarlo, sensitivity, scenarios, priceBand, riskProfile, rngFactory, oneRun };
