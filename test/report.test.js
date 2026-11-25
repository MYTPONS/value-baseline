const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildReport } = require('../lib/report');

const target = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'targets', 'example-web-service.json'), 'utf8'));

test('example target produces a complete report', () => {
  const report = buildReport(target);
  assert.equal(report.products.length, 3);
  assert.ok(report.portfolio.totalProfit > 0);
  for (const product of report.products) {
    assert.ok(product.marginalFloor > 0);
    assert.ok(product.sweep.length > 0);
    assert.ok(product.ltv.ltv > 0);
  }
});
