# 每时热搜

一个适合 iPhone Safari 添加到主屏幕的热搜 PWA，按小时展示热搜标题和简要概括。

## 当前结构

- `index.html`: 页面结构与 iOS / PWA meta
- `styles.css`: 移动端优先样式
- `app.js`: 数据加载、时间轴切换、刷新与回退逻辑
- `data/hourly-trends.json`: 当前热搜数据源
- `scripts/update-hourly-trends.mjs`: 抓取真实热搜并生成摘要
- `.github/workflows/update-hourly-trends.yml`: 每小时自动更新数据
- `.github/workflows/deploy-pages.yml`: 自动部署到 GitHub Pages
- `manifest.webmanifest`: PWA 配置
- `sw.js`: 离线缓存

## 真实数据链路

默认方案是：

1. GitHub Actions 每小时优先抓取知乎热榜 JSON，失败时回退到微博热搜页面
2. 用 OpenAI Responses API 生成整体概括和每条简要概括
3. 写入 `data/hourly-trends.json`
4. GitHub Pages 自动发布静态站点

如果没有配置 `OPENAI_API_KEY`，脚本仍可运行，但会退回到规则生成的保守摘要。

## 本地运行数据脚本

```bash
OPENAI_API_KEY=your_key_here node ./scripts/update-hourly-trends.mjs
```

可选环境变量：

- `OPENAI_MODEL`: 默认 `gpt-5-mini`
- `MAX_HOURS`: 默认保留最近 `24` 个整点
- `MAX_ITEMS`: 默认抓取每小时前 `20` 条

## GitHub 需要配置

仓库 `Settings -> Secrets and variables -> Actions`：

- Secret: `OPENAI_API_KEY`
- Variable: `OPENAI_MODEL`，建议填 `gpt-5-mini`

仓库 `Settings -> Pages`：

- Build and deployment: `GitHub Actions`

## 数据格式

把 `data/hourly-trends.json` 按下面格式更新即可：

```json
{
  "source": "知乎热榜 + OpenAI摘要",
  "updatedAt": "2026-03-22T23:40:00+08:00",
  "hours": [
    {
      "slot": "2026-03-22T20:00:00+08:00",
      "label": "03-22 20:00",
      "shortLabel": "20:00",
      "summary": "这一小时的总体概括。",
      "items": [
        {
          "title": "热搜标题",
          "desc": "简要概括",
          "category": "分类",
          "heat": "149k",
          "url": "https://example.com/topic"
        }
      ]
    }
  ]
}
```

## 说明

- 当前抓取源默认优先使用知乎热榜 JSON，失败时回退到微博页面解析。
- 摘要是基于热搜标题生成的保守概括，不应当当作完整新闻事实摘要。
