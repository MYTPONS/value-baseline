'use strict';

// 价值基线 CLI（通用）
//   node cli.js price  <target.json>            通用定价/放量分析
//   node cli.js sweep  <target.json> [--product id]  价格扫描表
//   node cli.js audit  [--target <项目根>]       体检 dh-reader 同构项目（章/墨块）
//   node cli.js verify <target.json | --target>  CI 护栏：有售价低于边际底线的产品则非零退出
const fs = require('node:fs');
const { buildReport, renderText, money, pct } = require('./lib/report');
const E = require('./lib/economics');

const argv = process.argv.slice(3);
const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const optVal = opt;
// 第一个非 --xxx 的非选项值
const positional = (() => { for (let i = 0; i < argv.length; i += 1) { if (argv[i].startsWith('--')) { i += 1; continue; } return argv[i]; } return undefined; })();

const loadTarget = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

function cmdPrice() {
  const file = positional || opt('--target');
  if (!file) { console.error('用法: node cli.js price <target.json>'); process.exit(2); }
  const r = buildReport(loadTarget(file));
  renderText(r);
  return r;
}

function cmdSweep() {
  const file = positional;
  if (!file) { console.error('用法: node cli.js sweep <target.json> [--product id]'); process.exit(2); }
  const t = loadTarget(file);
  const r = buildReport(t);
  const only = opt('--product');
  console.log('\n价格扫描（价格 | 转化 | 月销 | 收入 | 毛利 | 净利）');
  for (const p of r.products) {
    if (only && p.id !== only) continue;
    console.log(`\n▸ ${p.name}`);
    for (const row of p.sweep) {
      const mark = row.price === p.profitMax.price ? ' ←利润最大' : (row.price === p.revenueMax.price ? ' ←收入最大' : '');
      console.log(`  ¥${String(row.price).padEnd(8)} ${(E.conversionAt(p.id ? r.demand : r.demand, row.price) * 100).toFixed(2).padStart(6)}%  ${String(row.units).padStart(8)}  ${money(row.revenue).padStart(10)}  ${money(row.grossProfit).padStart(10)}  ${money(row.profit).padStart(11)}${mark}`);
    }
  }
  console.log('');
}

function cmdRisk() {
  const file = positional;
  if (!file) { console.error('用法: node cli.js risk <target.json> [--runs N]'); process.exit(2); }
  const runs = Number(opt('--runs')) || 4000;
  const only = opt('--product');
  const r = buildReport(loadTarget(file), { risk: { runs, bandRuns: 900, lossTolerance: 0.2 } });
  console.log(`\n═══ 市场波动与风险 · ${r.name} ═══`);
  console.log(`波动假设：流量 CV ${r.volatility.traffic.cv}｜转化 CV ${r.volatility.conversion.cv}｜弹性 ${r.volatility.elasticity.min}~${r.volatility.elasticity.max}｜成本 CV ${r.volatility.varCost.cv}(漂移+${r.volatility.varCost.drift})｜竞品降价 ${pct(r.volatility.anchor.prob)}概率×${pct(r.volatility.anchor.drop)}`);
  for (const p of r.products) {
    if (only && p.id !== only) continue;
    const rk = p.risk;
    console.log(`\n▸ ${p.name}  ¥${p.price}｜${runs} 次模拟`);
    console.log(`  净利分布：均值 ${money(rk.mc.profit.mean)}｜P5 ${money(rk.mc.profit.p5)}｜P50 ${money(rk.mc.profit.p50)}｜P95 ${money(rk.mc.profit.p95)}｜亏损概率 ${pct(rk.mc.lossProb)}`);
    console.log(`  收入分布：P5 ${money(rk.mc.revenue.p5)}｜P50 ${money(rk.mc.revenue.p50)}｜P95 ${money(rk.mc.revenue.p95)}`);
    console.log(`  敏感度（摆幅排序）：` + rk.sensitivity.rows.map(x => `${x.name} ${money(x.swing)}`).join('，'));
    console.log(`  情景：悲观 ${money(rk.scenarios[0].profit)} / 基准 ${money(rk.scenarios[1].profit)} / 乐观 ${money(rk.scenarios[2].profit)}`);
    console.log(`  风险调整最优价 ${money(rk.band.riskAdjustedPrice)}｜最稳价 ${money(rk.band.safestPrice)}（容忍亏损概率 ${pct(rk.band.lossTolerance)}）`);
    console.log('  价格带：价 | 中位净利 | P5 | 亏损概率');
    for (const b of rk.band.rows) console.log(`    ¥${String(b.price).padEnd(8)} ${money(b.median).padStart(11)} ${money(b.p5).padStart(11)} ${pct(b.lossProb).padStart(8)}`);
  }
  console.log('');
  return r;
}

function cmdVerify() {
  const file = positional || opt('--target');
  if (!file) { console.error('用法: node cli.js verify <target.json>'); process.exit(2); }
  const r = buildReport(loadTarget(file));
  let bad = 0;
  for (const p of r.products) {
    if (p.price < p.marginalFloor) { bad += 1; console.log(`  ✗ ${p.name}: 售价 ¥${p.price} < 边际底线 ¥${p.marginalFloor}（每卖一份亏）`); }
  }
  const profitOk = r.portfolio.totalProfit >= 0;
  if (!profitOk) console.log(`  ! 组合在当前流量/转化假设下净利 ${money(r.portfolio.totalProfit)}（需加流量或提价）`);
  console.log(`产品 ${r.products.length} 个｜组合净利 ${money(r.portfolio.totalProfit)}｜定价低于边际底线 ${bad} 个`);
  process.exit(bad ? 1 : 0);
}

const cmd = process.argv[2] || 'help';
if (cmd === 'price' || cmd === 'quote') cmdPrice();
else if (cmd === 'sweep') cmdSweep();
else if (cmd === 'verify') cmdVerify();
else if (cmd === 'risk') cmdRisk();
else console.log('用法: node cli.js [price|sweep|verify|risk] <target.json>');
