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

1. GitHub Actions 每小时优先抓取微博热搜 JSON 接口，失败时回退到微博页面解析，再失败才回退到知乎热榜 JSON
2. 用 OpenAI Responses API 生成整体概括和每条简要概括
3. 在工作流运行目录内生成最新 `data/hourly-trends.json`
4. 把最新 JSON 持久化到 `data-cache` 分支
5. 自动更新会先读取 `data-cache` 分支里的最新 JSON，再追加当前小时
6. 自动和手动部署都会优先读取 `data-cache` 分支里的最新 JSON 再发布

如果没有配置 `OPENAI_API_KEY`，脚本仍可运行，但会退回到规则生成的保守摘要。

## 本地运行数据脚本

```bash
OPENAI_API_KEY=your_key_here node ./scripts/update-hourly-trends.mjs
```

可选环境变量：

- `OPENAI_BASE_URL`: 默认 `https://api.openai.com/v1`
- `OPENAI_MODEL`: 默认 `gpt-5-mini`
- `OPENAI_RETRY_ATTEMPTS`: 默认 `3`
- `MAX_HOURS`: 默认保留最近 `24` 个整点
- `MAX_ITEMS`: 默认抓取每小时前 `20` 条

## GitHub 需要配置

仓库 `Settings -> Secrets and variables -> Actions`：

- Secret: `OPENAI_API_KEY`
- Variable: `OPENAI_BASE_URL`，默认可留空；如果你用兼容 OpenAI 协议的第三方服务，就填它提供的 API 基础地址，例如 `https://your-provider.example/v1`
- Variable: `OPENAI_MODEL`，建议填 `gpt-5-mini`
- Variable: `OPENAI_RETRY_ATTEMPTS`，可选，默认 `3`

仓库 `Settings -> Pages`：

- Build and deployment: `GitHub Actions`

## 数据格式

把 `data/hourly-trends.json` 按下面格式更新即可：

```json
{
  "source": "微博热搜 + OpenAI摘要",
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

- 当前抓取源默认优先使用微博 JSON 接口 `https://weibo.com/ajax/side/hotSearch`，失败时回退到微博页面解析，再失败才回退到知乎热榜 JSON。
- 摘要是基于热搜标题生成的保守概括，不应当当作完整新闻事实摘要。
- 定时更新不会再往 `master` 产生新提交；最新数据会写到 `data-cache` 分支，代码和数据分支分离。
- 当 AI 摘要不可用时，系统会优先使用抓取源自带的摘要内容；只有源数据没有摘要时，才退回规则生成。
- AI 摘要请求当前使用的是兼容模式：基于 `responses` 接口发送纯文本输入，并解析纯文本输出，避免依赖部分第三方服务不支持的 `json_schema` 或高级参数。
