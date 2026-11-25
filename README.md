# Value Baseline

通用定价与放量测算引擎。输入成本结构、需求假设和产品价格，输出边际底线、全成本保本价、价格扫描、利润、回本周期和风险区间。

它不绑定任何行业。示例 target 是一个内容订阅产品，换成任意产品只需要替换 JSON。

## 快速开始

```bash
node cli.js price data/targets/example-web-service.json
node cli.js sweep data/targets/example-web-service.json
node cli.js risk data/targets/example-web-service.json --runs 2000
node cli.js verify data/targets/example-web-service.json
```

## 输入

复制 `data/targets/example-web-service.json`，修改：

- `costs`：开发费、上线费、固定月成本、人工、支付费率、退款率、税率
- `demand`：月流量、基准转化、基准价格、价格弹性
- `products`：每个产品的售价、单位变动成本、流失率
- `anchors`：可选竞品锚点

## 核心公式

```text
净单价       = 售价 × (1 - 费率)
单位贡献     = 净单价 - 单位变动成本
边际底线     = 单位变动成本 / (1 - 费率)
保本销量     = 全成本 / 月单位贡献
销量(p)      = 月流量 × 基准转化 × (p / 基准价)^(-弹性)
净利(p)      = 单位贡献(p) × 销量(p) - 全成本
回本周期     = 一次性投入 / 月净利
```

## 目录

```text
lib/            经济内核、报告、风险和成本工具
test/           单元测试与报告示例
data/targets/   示例输入
```

## 说明

仓库只带通用示例，不带任何真实项目的价格、数据库、成本记录或经营数据。请把实际经营参数放在本机，不要提交到公开仓库。
