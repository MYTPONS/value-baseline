'use strict';

// 通用报告：把 target 定义 → 完整定价/放量分析
const E = require('./economics');
const V = require('./volatility');

const money = (n) => (n == null ? '—' : `¥${Number(n).toFixed(2)}`);
const pct = (n) => (n == null ? '—' : `${(n * 100).toFixed(1)}%`);

function buildReport(target = {}, override = {}) {
  const costs = E.normalizeCosts({ ...(target.costs || {}), ...(override.costs || {}) });
  const demand = { ...(target.demand || {}), ...(override.demand || {}) };
  const vol = V.normalizeVol(target.volatility || {});
  const riskOpts = override.risk || {};
  const products = (target.products || []).map(p => {
    const price = override.prices && override.prices[p.id] != null ? Number(override.prices[p.id]) : Number(p.price);
    return { ...p, price };
  });

  const n = products.length || 1;
  const rows = products.map(pr => {
    const share = pr.share != null ? Number(pr.share) : 1 / n;
    const d = {
      ...demand,
      ...(pr.demand || {}),
      monthlyTraffic: (Number(demand.monthlyTraffic) || 0) * share
    };
    const ref = Number(pr.price) || Number(demand.basePrice) || 1;
    const econ = E.atPrice(pr, costs, d, pr.price, ref);
    const be = E.breakevenUnits(pr, costs, pr.price);
    const opt = E.optimize(pr, costs, d, { min: pr.sweepMin, max: pr.sweepMax, steps: 24 });
    const grossMax = opt.rows.reduce((a, b) => (b.grossProfit > a.grossProfit ? b : a), opt.rows[0]);
    const pay = E.paybackMonths(costs, econ.profit);
    const marginalFloor = E.R((Number(pr.varCost) || 0) / (1 - costs.feeRate), 4);
    const sub = pr.churnMonthly != null ? E.ltv(pr, costs, pr.price, pr.churnMonthly) : null;
    return {
      id: pr.id, name: pr.name, unit: pr.unit || '份', price: pr.price, varCost: Number(pr.varCost) || 0,
      share, traffic: d.monthlyTraffic,
      econ, breakeven: be, marginalFloor, worstCost: pr._worstCost != null ? pr._worstCost : null,
      coverage: costs.fixedAllInMonthly > 0 ? E.R(econ.grossProfit / costs.fixedAllInMonthly, 2) : null,
      fullCostBreakevenPrice: opt.breakevenPrice,
      profitMax: opt.profitMax, revenueMax: opt.revenueMax, grossMax,
      sweep: opt.rows, scenarios: E.scenarios(pr, costs, d),
      payback: pay, ltv: sub,
      risk: V.riskProfile(pr, costs, d, vol, { runs: riskOpts.runs || 900, bandRuns: riskOpts.bandRuns || 300, delta: 0.2, lossTolerance: riskOpts.lossTolerance || 0.2 })
    };
  });

  const anchors = target.anchors || [];
  return {
    name: target.name || '未命名产品',
    currency: target.currency || 'CNY',
    costs, demand, anchors, volatility: vol,
    products: rows,
    portfolio: E.portfolio(products, costs, demand),
    generatedAt: new Date().toISOString()
  };
}

function renderText(r) {
  const L = (s = '') => console.log(s);
  L(`\n═══ 定价与放量分析 · ${r.name} ═══`);
  L(`全成本/月：固定 ${money(r.costs.fixedMonthly)} + 人工 ${money(r.costs.laborMonthly)} + 开发摊销 ${money(r.costs.capexMonthly)} = ${money(r.costs.fixedAllInMonthly)}`);
  L(`一次性投入 ${money(r.costs.capexTotal)}（开发 ${money(r.costs.developmentCost)} + 上线 ${money(r.costs.launchCost)} + 设备 ${money(r.costs.equipmentCost)}，摊 ${r.costs.amortMonths} 个月）`);
  L(`费率：支付 ${pct(r.costs.paymentRate)} + 退款 ${pct(r.costs.refundRate)} + 税/抽成 ${pct(r.costs.taxRate)} = ${pct(r.costs.feeRate)}`);
  L(`需求假设：月触达 ${r.demand.monthlyTraffic || 0} 人，基准转化 ${pct(r.demand.baseConversion)} @ ¥${r.demand.basePrice}，价格弹性 ${r.demand.elasticity}`);

  for (const p of r.products) {
    L(`\n▸ ${p.name}  ¥${p.price}/${p.unit}`);
    L(`  单位：净价 ${money(p.econ.price * (1 - r.costs.feeRate))} - 变动成本 ${money(p.varCost)} = 贡献毛利 ${money(p.econ.contribution)}（${pct(p.econ.contribRate)}）`);
    L(`  边际底线 ${money(p.marginalFloor)}（低于这个每卖一份就亏）｜全成本保本价 ${money(p.fullCostBreakevenPrice)}（当前流量/转化下）`);
    L(`  当前月销 ${p.econ.units} ${p.unit}｜收入 ${money(p.econ.revenue)}｜贡献毛利 ${money(p.econ.grossProfit)}｜覆盖固定成本 ${p.coverage == null ? '—' : p.coverage + '×'}`);
    L(`  保本销量 ${p.breakeven.units == null ? '不可达（贡献≤0）' : p.breakeven.units + ' 份/月'}｜达保本需当前销量的 ${p.breakeven.units && p.econ.units > 0 ? (p.breakeven.units / p.econ.units).toFixed(1) + '×' : '—'}`);
    if (p.worstCost != null) L(`  额度打满成本（最坏）${money(p.worstCost)} → 打满毛利 ${pct((p.econ.price * (1 - r.costs.feeRate) - p.worstCost) / (p.econ.price * (1 - r.costs.feeRate)))}（这是定时炸弹，定价要能覆盖它或砍额度）`);
    if (p.ltv) L(`  LTV：月流失 ${pct(p.ltv.churnMonthly)} → 单客 LTV ${money(p.ltv.ltv)}`);
    L(`  毛利最大价 ${money(p.grossMax.price)}（毛利 ${money(p.grossMax.grossProfit)}）｜收入最大价 ${money(p.revenueMax.price)}（收入 ${money(p.revenueMax.revenue)}）`);
    L(`  放量情景：` + p.scenarios.map(s => `${s.traffic}流量→${s.units}份/净利${money(s.profit)}`).join('  '));
    const rk = p.risk;
    if (rk) {
      L(`  【市场波动】亏损概率 ${pct(rk.mc.lossProb)}｜净利 P5 ${money(rk.mc.profit.p5)} / P50 ${money(rk.mc.profit.p50)} / P95 ${money(rk.mc.profit.p95)}｜竞品降价命中 ${pct(rk.mc.anchorHitRate)}`);
      L(`  敏感度（±20% 对净利的摆幅）：` + rk.sensitivity.rows.map(x => `${x.name} ${money(x.swing)}`).join('，'));
      L(`  情景：悲观 ${money(rk.scenarios[0].profit)} / 基准 ${money(rk.scenarios[1].profit)} / 乐观 ${money(rk.scenarios[2].profit)}`);
      L(`  风险调整最优价 ${money(rk.band.riskAdjustedPrice)}（亏损概率≤${pct(rk.band.lossTolerance)} 下中位净利最高）｜最稳价 ${money(rk.band.safestPrice)}（亏损概率最低）`);
    }
  }

  const pf = r.portfolio;
  L(`\n▸ 组合合计：月销 ${pf.totalUnits}｜收入 ${money(pf.totalRevenue)}｜毛利 ${money(pf.totalGross)}｜净利 ${money(pf.totalProfit)}`);
  if (r.anchors.length) L(`竞品锚点：` + r.anchors.map(a => `${a.name} ${a.unit === 'year' ? '年' : a.unit === 'month' ? '月' : '次'} ¥${a.price}`).join('，'));
  L('');
  return r;
}

module.exports = { buildReport, renderText, money, pct };
