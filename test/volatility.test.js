'use strict';

const test = require('node:test');
const assert = require('node:assert');
const V = require('../lib/volatility');
const E = require('../lib/economics');

const costs = E.normalizeCosts({ developmentCost: 12000, amortMonths: 24, fixedMonthly: 60, laborMonthly: 150, paymentRate: 0.03, refundRate: 0.02 });
const demand = { monthlyTraffic: 5000, baseConversion: 0.02, basePrice: 100, elasticity: 1.5, maxConversion: 0.4 };
const product = { id: 'p', name: 'P', price: 100, varCost: 10 };

test('波动默认参数齐备且合理', () => {
  const v = V.normalizeVol({});
  assert.ok(v.traffic.cv > 0 && v.conversion.cv > 0 && v.varCost.cv > 0);
  assert.ok(v.elasticity.min < v.elasticity.max);
  assert.ok(v.anchor.prob > 0 && v.anchor.prob <= 1);
  assert.ok(v.runs >= 200);
});

test('蒙特卡洛：同种子结果可复现', () => {
  const v = V.normalizeVol({ seed: 123, runs: 1500 });
  const a = V.monteCarlo(product, costs, demand, v, 100, 1500);
  const b = V.monteCarlo(product, costs, demand, v, 100, 1500);
  assert.strictEqual(a.profit.p50, b.profit.p50);
  assert.strictEqual(a.lossProb, b.lossProb);
});

test('蒙特卡洛：分布分位有序，亏损概率在 0~1', () => {
  const v = V.normalizeVol({ runs: 2000 });
  const mc = V.monteCarlo(product, costs, demand, v, 100, 2000);
  assert.ok(mc.profit.p5 <= mc.profit.p50 && mc.profit.p50 <= mc.profit.p95);
  assert.ok(mc.lossProb >= 0 && mc.lossProb <= 1);
});

test('亏损概率：低价（低于成本）应显著升高', () => {
  const v = V.normalizeVol({ runs: 2000 });
  const cheap = V.monteCarlo(product, costs, demand, v, 5, 2000).lossProb;
  const fine = V.monteCarlo(product, costs, demand, v, 100, 2000).lossProb;
  assert.ok(cheap > fine, `低价亏损概率(${cheap}) 应高于合理价(${fine})`);
});

test('敏感度：按摆幅降序，且包含竞品价格波动', () => {
  const v = V.normalizeVol({});
  const s = V.sensitivity(product, costs, demand, v, 100, 0.2);
  for (let i = 1; i < s.rows.length; i += 1) assert.ok(s.rows[i - 1].swing >= s.rows[i].swing);
  assert.ok(s.rows.some(r => r.name.includes('竞品')));
  assert.ok(s.rows.every(r => r.swing >= 0));
});

test('情景：悲观 < 基准 < 乐观', () => {
  const sc = V.scenarios(product, costs, demand, 100);
  assert.strictEqual(sc.length, 3);
  assert.ok(sc[0].profit < sc[1].profit && sc[1].profit < sc[2].profit);
});

test('价格带：风险调整价来自网格，亏损概率有界', () => {
  const v = V.normalizeVol({ runs: 400 });
  const band = V.priceBand(product, costs, demand, v, { runs: 300, lossTolerance: 0.2 });
  assert.ok(band.rows.length > 3);
  assert.ok(band.rows.every(r => r.lossProb >= 0 && r.lossProb <= 1));
  assert.ok(band.rows.some(r => r.price === band.riskAdjustedPrice));
});

test('风险画像：四个块齐全', () => {
  const v = V.normalizeVol({ runs: 600 });
  const prof = V.riskProfile(product, costs, demand, v, { runs: 600, bandRuns: 200 });
  assert.ok(prof.mc && prof.sensitivity && prof.scenarios && prof.band);
});
