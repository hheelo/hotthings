import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const ROOT_DIR = process.cwd();
const DATA_PATH = path.join(ROOT_DIR, "data", "hourly-trends.json");
const SOURCE_URL = "https://s.weibo.com/top/summary?cate=realtimehot";
const TIMEZONE = "Asia/Shanghai";
const MAX_HOURS = Number.parseInt(process.env.MAX_HOURS || "24", 10);
const MAX_ITEMS = Number.parseInt(process.env.MAX_ITEMS || "10", 10);
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5-mini";

const now = new Date();

const slotTime = new Date(now);
slotTime.setMinutes(0, 0, 0);

const formatInTimezone = (date, options) =>
  new Intl.DateTimeFormat("zh-CN", {
    timeZone: TIMEZONE,
    ...options
  }).format(date);

const getOffsetSuffix = () => {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    timeZoneName: "longOffset",
    year: "numeric"
  });
  const offsetPart = formatter.formatToParts(now).find((part) => part.type === "timeZoneName");
  return offsetPart?.value.replace("GMT", "") || "+08:00";
};

const toSlotString = (date) => {
  const datePart = formatInTimezone(date, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).replaceAll("/", "-");
  const timePart = formatInTimezone(date, {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  });
  return `${datePart}T${timePart}:00${getOffsetSuffix()}`;
};

const getLabel = (date) =>
  formatInTimezone(date, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).replace(" ", " ");

const getShortLabel = (date) =>
  formatInTimezone(date, {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  });

const stripTags = (value) =>
  value
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();

const decodeUrl = (value) => value.replace(/&amp;/g, "&");

const inferCategory = (title) => {
  const rules = [
    ["天气", "天气"],
    ["电影", "影视"],
    ["综艺", "综艺"],
    ["明星", "娱乐"],
    ["演唱会", "娱乐"],
    ["地铁", "城市"],
    ["高铁", "交通"],
    ["学校", "教育"],
    ["高校", "教育"],
    ["车", "汽车"],
    ["手机", "数码"],
    ["发布会", "数码"],
    ["金价", "财经"],
    ["股", "财经"],
    ["AI", "科技"],
    ["机器人", "科技"],
    ["旅游", "文旅"],
    ["景区", "文旅"],
    ["外卖", "生活"],
    ["夜宵", "美食"]
  ];

  const match = rules.find(([keyword]) => title.includes(keyword));
  return match?.[1] || "热议";
};

const fallbackSummaryForTitle = (title) =>
  `围绕“${title}”的讨论升温，用户主要关注事件背景、最新进展以及对现实生活的直接影响。`;

const fallbackHourSummary = (items) => {
  const categories = [...new Set(items.map((item) => item.category))].slice(0, 3);
  const joined = categories.join("、") || "综合";
  return `这一小时热搜主要集中在${joined}话题，用户更关注最新进展、事件影响和可快速理解的背景信息。`;
};

const fetchWeiboHotSearch = async () => {
  const response = await fetch(SOURCE_URL, {
    headers: {
      "user-agent": "Mozilla/5.0",
      accept: "text/html,application/xhtml+xml"
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch Weibo hot search: HTTP ${response.status}`);
  }

  const html = await response.text();
  const rows = [...html.matchAll(/<td class="td-02">([\s\S]*?)<\/td>/g)];
  const items = [];

  for (const rowMatch of rows) {
    const rowHtml = rowMatch[1];
    const titleMatch = rowHtml.match(/<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!titleMatch) continue;

    const title = stripTags(titleMatch[2]);
    if (!title || title.includes("查看更多")) continue;

    const heatMatch = rowHtml.match(/<span>([\dA-Za-z.+万亿]+)<\/span>/);
    const rawHeat = heatMatch ? stripTags(heatMatch[1]) : "热议中";
    const href = titleMatch[1].startsWith("http")
      ? titleMatch[1]
      : `https://s.weibo.com${decodeUrl(titleMatch[1])}`;

    items.push({
      title,
      desc: "",
      category: inferCategory(title),
      heat: rawHeat,
      url: href
    });

    if (items.length >= MAX_ITEMS) break;
  }

  if (!items.length) {
    throw new Error("No hot-search items parsed from Weibo HTML.");
  }

  return items;
};

const buildSummaryPrompt = (items) => ({
  model: OPENAI_MODEL,
  reasoning: {
    effort: "minimal"
  },
  max_output_tokens: 1200,
  text: {
    format: {
      type: "json_schema",
      name: "hourly_hot_search_summaries",
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          hourSummary: {
            type: "string"
          },
          itemSummaries: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                title: { type: "string" },
                desc: { type: "string" },
                category: { type: "string" }
              },
              required: ["title", "desc", "category"]
            }
          }
        },
        required: ["hourSummary", "itemSummaries"]
      }
    }
  },
  input: [
    {
      role: "system",
      content: [
        {
          type: "input_text",
          text:
            "你是中文新闻编辑。只基于给定热搜标题生成简洁摘要，不要编造细节，不要引用未提供的事实来源。如果信息不足，就用更保守的表述，描述用户关注点、话题方向和事件状态。"
        }
      ]
    },
    {
      role: "user",
      content: [
        {
          type: "input_text",
          text: JSON.stringify(
            {
              task: "为当前小时热搜生成 1 条整体概括和每条 1 句中文简要概括。",
              constraints: {
                hourSummaryMaxChars: 42,
                itemDescMaxChars: 48,
                descStyle: "中性、简洁、避免夸张",
                categoryStyle: "2到4个中文字符"
              },
              items: items.map((item) => ({
                title: item.title,
                heat: item.heat
              }))
            },
            null,
            2
          )
        }
      ]
    }
  ]
});

const summarizeWithOpenAI = async (items) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return {
      sourceLabel: "微博热搜 + 规则摘要",
      hourSummary: fallbackHourSummary(items),
      items: items.map((item) => ({
        ...item,
        desc: fallbackSummaryForTitle(item.title)
      }))
    };
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(buildSummaryPrompt(items))
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI Responses API failed: HTTP ${response.status} ${errorText}`);
  }

  const payload = await response.json();
  const outputText =
    payload.output_text ||
    payload.output
      ?.flatMap((entry) => entry.content || [])
      .filter((item) => item.type === "output_text")
      .map((item) => item.text)
      .join("");

  if (!outputText) {
    throw new Error("OpenAI response did not contain output_text.");
  }

  const parsed = JSON.parse(outputText);
  const descByTitle = new Map(parsed.itemSummaries.map((item) => [item.title, item]));

  return {
    sourceLabel: `微博热搜 + OpenAI摘要 (${OPENAI_MODEL})`,
    hourSummary: parsed.hourSummary,
    items: items.map((item) => {
      const summary = descByTitle.get(item.title);
      return {
        ...item,
        desc: summary?.desc || fallbackSummaryForTitle(item.title),
        category: summary?.category || item.category
      };
    })
  };
};

const readExistingData = async () => {
  try {
    const raw = await fs.readFile(DATA_PATH, "utf8");
    return JSON.parse(raw);
  } catch {
    return { source: "未初始化", updatedAt: null, hours: [] };
  }
};

const writeData = async (payload) => {
  await fs.mkdir(path.dirname(DATA_PATH), { recursive: true });
  await fs.writeFile(DATA_PATH, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};

const main = async () => {
  const fetchedItems = await fetchWeiboHotSearch();
  let summaryResult;

  try {
    summaryResult = await summarizeWithOpenAI(fetchedItems);
  } catch (error) {
    process.stderr.write(
      `OpenAI summarization failed, falling back to rule summaries: ${
        error instanceof Error ? error.message : String(error)
      }\n`
    );
    summaryResult = {
      sourceLabel: "微博热搜 + 规则摘要",
      hourSummary: fallbackHourSummary(fetchedItems),
      items: fetchedItems.map((item) => ({
        ...item,
        desc: fallbackSummaryForTitle(item.title)
      }))
    };
  }

  const existing = await readExistingData();

  const slot = toSlotString(slotTime);
  const nextEntry = {
    slot,
    label: getLabel(slotTime),
    shortLabel: getShortLabel(slotTime),
    summary: summaryResult.hourSummary,
    items: summaryResult.items.map(({ title, desc, category, heat, url }) => ({
      title,
      desc,
      category,
      heat,
      url
    }))
  };

  const preserved = (existing.hours || []).filter((entry) => (entry.slot || entry.hour) !== slot);
  const hours = [nextEntry, ...preserved].slice(0, MAX_HOURS);
  const output = {
    source: summaryResult.sourceLabel,
    updatedAt: new Date().toISOString(),
    hours
  };

  await writeData(output);
  process.stdout.write(`Updated ${DATA_PATH} with ${hours.length} hourly snapshots.\n`);
};

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
