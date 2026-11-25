'use strict';

const test = require('node:test');
const assert = require('node:assert');
const E = require('../lib/economics');

const baseCosts = {
  developmentCost: 12000, launchCost: 0, equipmentCost: 0, amortMonths: 24,
  fixedMonthly: 60, laborMonthly: 150, paymentRate: 0.03, refundRate: 0.02, taxRate: 0
};
const costs = E.normalizeCosts(baseCosts);
const demand = { monthlyTraffic: 4000, baseConversion: 0.02, basePrice: 100, elasticity: 1.5, maxConversion: 0.3 };
const product = { id: 'p', name: 'P', price: 100, varCost: 10 };

test('全成本：一次性投入按月摊销进固定成本', () => {
  assert.strictEqual(costs.capexTotal, 12000);
  assert.strictEqual(costs.capexMonthly, 500);
  assert.strictEqual(costs.fixedAllInMonthly, 60 + 150 + 500);
  assert.strictEqual(costs.feeRate, 0.05);
});

test('单位贡献 = 净价 - 变动成本', () => {
  assert.strictEqual(E.netUnitPrice(100, costs), 95);
  assert.strictEqual(E.contribution(100, costs, 10), 85);
});

test('弹性：超过基准价销量下降，低于基准价销量上升（封顶）', () => {
  const atRef = E.conversionAt(demand, 100, 100);
  const high = E.conversionAt(demand, 200, 100);
  const low = E.conversionAt(demand, 50, 100);
  assert.strictEqual(Math.round(atRef * 1e6) / 1e6, 0.02);
  assert.ok(high < atRef, '涨价转化应下降');
  assert.ok(low > atRef, '降价转化应上升');
  assert.ok(low <= demand.maxConversion + 1e-9, '不应超过转化上限');
});

test('保本销量 = 固定成本 / 单位贡献', () => {
  const be = E.breakevenUnits(product, costs, 100);
  assert.ok(be.feasible);
  assert.strictEqual(be.units, Math.ceil(costs.fixedAllInMonthly / 85));
});

test('开发费（一次性投入）越大，回本越慢、利润越低', () => {
  const low = E.normalizeCosts({ ...baseCosts, developmentCost: 12000 });
  const high = E.normalizeCosts({ ...baseCosts, developmentCost: 60000 });
  const pLow = E.atPrice(product, low, demand, 100, 100).profit;
  const pHigh = E.atPrice(product, high, demand, 100, 100).profit;
  assert.ok(pHigh < pLow, '开发费高应压低净利');
  assert.ok(E.paybackMonths(high, 5000).months > E.paybackMonths(low, 5000).months, '开发费高应回本更慢');
});

test('做量：流量翻倍，销量与毛利近似翻倍（未触转化上限时）', () => {
  const d1 = { ...demand, monthlyTraffic: 1000, maxConversion: 1 };
  const d2 = { ...demand, monthlyTraffic: 2000, maxConversion: 1 };
  const r1 = E.atPrice(product, costs, d1, 100, 100);
  const r2 = E.atPrice(product, costs, d2, 100, 100);
  assert.ok(Math.abs(r2.units - r1.units * 2) < 0.01, '销量应随流量线性放大');
  assert.ok(r2.grossProfit > r1.grossProfit);
});

test('薄利多销 vs 高价：低毛利+大流量也能盈利', () => {
  const thin = { id: 'thin', price: 12, varCost: 10 }; // 贡献 ~1.4
  const dBig = { monthlyTraffic: 100000, baseConversion: 0.03, basePrice: 12, elasticity: 1.2, maxConversion: 0.3 };
  const rThin = E.atPrice(thin, costs, dBig, 12, 12);
  assert.ok(rThin.grossProfit > costs.fixedAllInMonthly, '薄利多销应在足够流量下覆盖固定成本');
});

test('组合：固定成本只扣一次，不是每个产品各扣一次', () => {
  const products = [
    { id: 'a', name: 'A', price: 100, varCost: 10, share: 0.5 },
    { id: 'b', name: 'B', price: 200, varCost: 20, share: 0.5 }
  ];
  const pf = E.portfolio(products, costs, demand);
  const sumGross = pf.rows.reduce((s, r) => s + r.grossProfit, 0);
  assert.ok(Math.abs(pf.totalProfit - (sumGross - costs.fixedAllInMonthly)) < 0.02, '组合净利 = 总毛利 - 一次固定成本');
});

test('最优价：毛利最大点不差于扫描内任一点', () => {
  const opt = E.optimize(product, costs, demand, { min: 30, max: 300, steps: 30 });
  for (const r of opt.rows) assert.ok(opt.profitMax.profit >= r.profit - 1e-6);
});

test('LTV = 单位贡献 / 月流失', () => {
  const l = E.ltv(product, costs, 100, 0.05);
  assert.strictEqual(l.ltv, 85 / 0.05);
});

test('回本周期：亏损时明确标注不回本', () => {
  const p = E.paybackMonths(costs, -10);
  assert.strictEqual(p.months, null);
});
