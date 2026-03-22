# 每时热搜

一个适合 iPhone Safari 添加到主屏幕的热搜 PWA，按小时展示热搜标题和简要概括。

## 当前结构

- `index.html`: 页面结构与 iOS / PWA meta
- `styles.css`: 移动端优先样式
- `app.js`: 数据加载、时间轴切换、刷新与回退逻辑
- `data/hourly-trends.json`: 当前热搜数据源
- `manifest.webmanifest`: PWA 配置
- `sw.js`: 离线缓存

## 如何替换成真实数据

把 `data/hourly-trends.json` 按下面格式更新即可：

```json
{
  "source": "微博热搜",
  "updatedAt": "2026-03-22T23:40:00+08:00",
  "hours": [
    {
      "hour": "20:00",
      "summary": "这一小时的总体概括。",
      "items": [
        {
          "title": "热搜标题",
          "desc": "简要概括",
          "category": "分类",
          "heat": "149k"
        }
      ]
    }
  ]
}
```

## 下一步建议

如果要真正自动化，建议再加一个后端或定时脚本：

1. 从真实热搜源抓取每小时榜单
2. 用大模型为每条标题生成简要概括
3. 定时写入 `data/hourly-trends.json`
4. 前端继续直接读取这个 JSON
