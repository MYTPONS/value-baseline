# 定价基线

## 目标

用同一套公式回答三个问题：

1. 每卖一份的最低价格是多少？
2. 在当前流量和转化假设下，卖多少才能保本？
3. 薄利多销和高价少卖，哪个净利润更高？

## 输入和输出

输入是 `costs / demand / products` 三组 JSON 数据。输出包括单位贡献、边际底线、保本销量、价格扫描、收入最大价、利润最大价和回本周期。

## 解释边界

模型只对输入假设做算术，不验证市场价格、需求弹性和竞品锚点是否真实。结论必须回到真实客户、真实成本和真实成交数据校对。

## 使用方式

```bash
node cli.js price data/targets/example-web-service.json
node cli.js sweep data/targets/example-web-service.json
node cli.js verify data/targets/example-web-service.json
```

修改 target JSON 后重新运行即可，不需要改代码。
