import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const ROOT_DIR = process.cwd();
const DATA_PATH = path.join(ROOT_DIR, "data", "hourly-trends.json");
const ZHIHU_SOURCE_URL = "https://api.zhihu.com/topstory/hot-list";
const WEIBO_AJAX_SOURCE_URL = "https://weibo.com/ajax/side/hotSearch";
const WEIBO_SOURCE_URL = "https://s.weibo.com/top/summary?cate=realtimehot";
const TIMEZONE = "Asia/Shanghai";
const MAX_HOURS = Number.parseInt(process.env.MAX_HOURS || "24", 10);
const MAX_ITEMS = Number.parseInt(process.env.MAX_ITEMS || "20", 10);
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5-mini";
const OPENAI_RETRY_ATTEMPTS = Number.parseInt(process.env.OPENAI_RETRY_ATTEMPTS || "3", 10);

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

const normalizeHeat = (value) => {
  const cleaned = stripTags(value || "");
  return cleaned || "热议中";
};

const truncateText = (value, maxLength) => {
  const cleaned = stripTags(value || "").replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength - 1)}…` : cleaned;
};

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

const buildSourceBackedHourSummary = (items) => {
  const sourcedDescs = items
    .map((item) => truncateText(item.desc, 28))
    .filter(Boolean)
    .slice(0, 2);

  if (sourcedDescs.length) {
    return sourcedDescs.join("；");
  }

  return "";
};

const fallbackHourSummary = (items) => {
  const sourceBacked = buildSourceBackedHourSummary(items);
  if (sourceBacked) {
    return sourceBacked;
  }

  const categories = [...new Set(items.map((item) => item.category))].slice(0, 3);
  const joined = categories.join("、") || "综合";
  return `这一小时热搜主要集中在${joined}话题，用户更关注最新进展、事件影响和可快速理解的背景信息。`;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const shouldRetryOpenAIStatus = (status) => status === 408 || status === 409 || status === 429 || status >= 500;

const buildWeiboTopicUrl = (title, rank) => {
  const query = encodeURIComponent(title);
  const bandRank = Number.isFinite(rank) ? `&band_rank=${rank}` : "";
  return `https://s.weibo.com/weibo?q=${query}&t=31${bandRank}&Refer=top`;
};

const fetchZhihuHotSearch = async () => {
  const response = await fetch(ZHIHU_SOURCE_URL, {
    headers: {
      "user-agent": "Mozilla/5.0",
      accept: "application/json,text/plain,*/*",
      referer: "https://www.zhihu.com/hot"
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch Zhihu hot list: HTTP ${response.status}`);
  }

  const payload = await response.json();
  const data = Array.isArray(payload?.data) ? payload.data : [];
  const items = data
    .map((entry) => {
      const target = entry?.target || {};
      const title =
        target?.titleArea?.text ||
        target?.title ||
        "";
      const excerpt =
        target?.excerptArea?.text ||
        target?.excerpt ||
        "";
      const hot =
        target?.metricsArea?.text ||
        entry?.detail_text ||
        "热议中";
      const url =
        target?.link?.url ||
        target?.url ||
        "";

      return {
        title: stripTags(title),
        desc: truncateText(excerpt, 48),
        category: inferCategory(stripTags(title)),
        heat: normalizeHeat(hot),
        url
      };
    })
    .filter((item) => item.title)
    .slice(0, MAX_ITEMS);

  if (!items.length) {
    throw new Error("No hot-search items parsed from Zhihu JSON.");
  }

  return items;
};

const fetchWeiboAjaxHotSearch = async () => {
  const response = await fetch(WEIBO_AJAX_SOURCE_URL, {
    headers: {
      "user-agent": "Mozilla/5.0",
      accept: "application/json,text/plain,*/*",
      referer: "https://weibo.com/"
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch Weibo hot search JSON: HTTP ${response.status}`);
  }

  const payload = await response.json();
  const realtime = Array.isArray(payload?.data?.realtime) ? payload.data.realtime : [];
  const items = realtime
    .map((entry, index) => {
      const title = stripTags(entry?.word || entry?.note || "");
      const rank = Number.parseInt(entry?.rank || `${index + 1}`, 10);
      const label = stripTags(entry?.label_name || "");
      const rawHeat = entry?.raw_hot || entry?.num || entry?.onboard_time || "";
      const decoratedTitle = label ? `${title} ${label}` : title;

      return {
        title: decoratedTitle.trim(),
        desc: "",
        category: inferCategory(title),
        heat: normalizeHeat(String(rawHeat || "热议中")),
        url: buildWeiboTopicUrl(title, rank)
      };
    })
    .filter((item) => item.title)
    .slice(0, MAX_ITEMS);

  if (!items.length) {
    throw new Error("No hot-search items parsed from Weibo JSON.");
  }

  return items;
};

const parseWeiboRows = (html) => {
  const rows = [...html.matchAll(/<td class="td-02">([\s\S]*?)<\/td>/g)];
  const items = [];

  for (const rowMatch of rows) {
    const rowHtml = rowMatch[1];
    const titleMatch = rowHtml.match(/<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!titleMatch) continue;

    const title = stripTags(titleMatch[2]);
    if (!title || title.includes("查看更多")) continue;

    const heatMatch = rowHtml.match(/<span>([\dA-Za-z.+万亿]+)<\/span>/);
    const href = titleMatch[1].startsWith("http")
      ? titleMatch[1]
      : `https://s.weibo.com${decodeUrl(titleMatch[1])}`;

    items.push({
      title,
      desc: "",
      category: inferCategory(title),
      heat: normalizeHeat(heatMatch?.[1]),
      url: href
    });

    if (items.length >= MAX_ITEMS) break;
  }

  return items;
};

const parseWeiboLinksFallback = (html) => {
  const items = [];
  const linkMatches = [
    ...html.matchAll(/<a[^>]+href="(\/weibo\?q=[^"]+|https:\/\/s\.weibo\.com\/weibo\?q=[^"]+)"[^>]*>([\s\S]*?)<\/a>/g)
  ];

  for (const match of linkMatches) {
    const href = match[1].startsWith("http") ? match[1] : `https://s.weibo.com${decodeUrl(match[1])}`;
    const title = stripTags(match[2]);
    if (!title) continue;
    if (title.length < 2) continue;
    if (title.includes("更多")) continue;
    if (title.includes("微博")) continue;
    if (items.some((item) => item.title === title)) continue;

    items.push({
      title,
      desc: "",
      category: inferCategory(title),
      heat: "热议中",
      url: href
    });

    if (items.length >= MAX_ITEMS) break;
  }

  return items;
};

const fetchWeiboHotSearch = async () => {
  const response = await fetch(WEIBO_SOURCE_URL, {
    headers: {
      "user-agent": "Mozilla/5.0",
      accept: "text/html,application/xhtml+xml"
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch Weibo hot search: HTTP ${response.status}`);
  }

  const html = await response.text();
  const items = parseWeiboRows(html);
  if (items.length) return items;

  const fallbackItems = parseWeiboLinksFallback(html);
  if (fallbackItems.length) return fallbackItems;

  throw new Error("No hot-search items parsed from Weibo HTML.");
};

const fetchHotSearch = async () => {
  try {
    const items = await fetchWeiboAjaxHotSearch();
    return {
      platform: "微博热搜",
      items
    };
  } catch (weiboAjaxError) {
    process.stderr.write(
      `Weibo JSON fetch failed, falling back to Weibo HTML: ${
        weiboAjaxError instanceof Error ? weiboAjaxError.message : String(weiboAjaxError)
      }\n`
    );
  }

  try {
    const items = await fetchWeiboHotSearch();
    return {
      platform: "微博热搜",
      items
    };
  } catch (weiboHtmlError) {
    process.stderr.write(
      `Weibo HTML fetch failed, falling back to Zhihu: ${
        weiboHtmlError instanceof Error ? weiboHtmlError.message : String(weiboHtmlError)
      }\n`
    );
  }

  const zhihuItems = await fetchZhihuHotSearch();
  return {
    platform: "知乎热榜",
    items: zhihuItems
  };
};

const buildSummaryPrompt = (items) => {
  const itemLines = items
    .map((item, index) => `${index + 1}. 标题：${item.title}；热度：${item.heat}`)
    .join("\n");

  return {
    model: OPENAI_MODEL,
    max_output_tokens: 1200,
    input: `你是中文新闻编辑。只基于给定热搜标题生成简洁摘要，不要编造细节，不要引用未提供的事实来源。如果信息不足，就用更保守的表述，描述用户关注点、话题方向和事件状态。

请严格按以下纯文本格式返回，不要输出 JSON，不要加解释：
HOUR_SUMMARY: <一条整体概括，42字内>
ITEM: <原标题> | <分类，2到4个中文字符> | <一句简要概括，48字内>

需要处理的热搜如下：
${itemLines}`
  };
};

const parseSummaryText = (outputText, items) => {
  const lines = outputText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const hourSummaryLine = lines.find((line) => line.startsWith("HOUR_SUMMARY:"));
  const hourSummary = hourSummaryLine
    ? hourSummaryLine.replace("HOUR_SUMMARY:", "").trim()
    : fallbackHourSummary(items);

  const summaries = new Map();
  lines
    .filter((line) => line.startsWith("ITEM:"))
    .forEach((line) => {
      const payload = line.replace("ITEM:", "").trim();
      const [titlePart, categoryPart, descPart] = payload.split("|").map((part) => part.trim());
      if (!titlePart) return;
      summaries.set(titlePart, {
        category: categoryPart || "",
        desc: descPart || ""
      });
    });

  return {
    hourSummary,
    items: items.map((item) => {
      const summary = summaries.get(item.title);
      return {
        ...item,
        desc: summary?.desc || item.desc || fallbackSummaryForTitle(item.title),
        category: summary?.category || item.category
      };
    })
  };
};

const summarizeWithOpenAI = async (items) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return {
      sourceLabel: "热榜 + 规则摘要",
      hourSummary: fallbackHourSummary(items),
      items: items.map((item) => ({
        ...item,
        desc: item.desc || fallbackSummaryForTitle(item.title)
      }))
    };
  }

  const responsesUrl = new URL("responses", OPENAI_BASE_URL.endsWith("/") ? OPENAI_BASE_URL : `${OPENAI_BASE_URL}/`);
  let payload;

  for (let attempt = 1; attempt <= OPENAI_RETRY_ATTEMPTS; attempt += 1) {
    let response;

    try {
      response = await fetch(responsesUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify(buildSummaryPrompt(items))
      });
    } catch (error) {
      if (attempt === OPENAI_RETRY_ATTEMPTS) {
        throw error;
      }

      const delayMs = attempt * 2000;
      process.stderr.write(
        `OpenAI request failed on attempt ${attempt}/${OPENAI_RETRY_ATTEMPTS}, retrying in ${delayMs}ms.\n`
      );
      await sleep(delayMs);
      continue;
    }

    if (!response.ok) {
      const errorText = await response.text();
      const message = `OpenAI Responses API failed: HTTP ${response.status} ${errorText}`;

      if (!shouldRetryOpenAIStatus(response.status) || attempt === OPENAI_RETRY_ATTEMPTS) {
        throw new Error(message);
      }

      const delayMs = attempt * 2000;
      process.stderr.write(
        `${message}\nRetrying in ${delayMs}ms (${attempt}/${OPENAI_RETRY_ATTEMPTS}).\n`
      );
      await sleep(delayMs);
      continue;
    }

    payload = await response.json();
    break;
  }

  if (!payload) {
    throw new Error("OpenAI response payload was empty after retries.");
  }

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

  const parsed = parseSummaryText(outputText, items);

  return {
    sourceLabel: `热榜 + OpenAI摘要 (${OPENAI_MODEL})`,
    hourSummary: parsed.hourSummary,
    items: parsed.items
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

const hasEntryForCurrentSlot = (payload, slot) =>
  Boolean((payload.hours || []).find((entry) => (entry.slot || entry.hour) === slot));

const writeData = async (payload) => {
  await fs.mkdir(path.dirname(DATA_PATH), { recursive: true });
  await fs.writeFile(DATA_PATH, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};

const main = async () => {
  const existing = await readExistingData();
  let fetched;

  try {
    fetched = await fetchHotSearch();
  } catch (error) {
    const slot = toSlotString(slotTime);
    if (hasEntryForCurrentSlot(existing, slot)) {
      process.stderr.write(
        `Fetch failed but current slot ${slot} already exists, keeping existing data: ${
          error instanceof Error ? error.message : String(error)
        }\n`
      );
      return;
    }

    if ((existing.hours || []).length > 0) {
      process.stderr.write(
        `Fetch failed, preserving previous data without updating current slot: ${
          error instanceof Error ? error.message : String(error)
        }\n`
      );
      return;
    }

    throw error;
  }

  let summaryResult;

  try {
    summaryResult = await summarizeWithOpenAI(fetched.items);
  } catch (error) {
    process.stderr.write(
      `OpenAI summarization failed, falling back to rule summaries: ${
        error instanceof Error ? error.message : String(error)
      }\n`
    );
    summaryResult = {
      sourceLabel: `${fetched.platform} + 规则摘要`,
      hourSummary: fallbackHourSummary(fetched.items),
      items: fetched.items.map((item) => ({
        ...item,
        desc: item.desc || fallbackSummaryForTitle(item.title)
      }))
    };
  }

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
    source: summaryResult.sourceLabel.startsWith("热榜")
      ? summaryResult.sourceLabel.replace("热榜", fetched.platform)
      : summaryResult.sourceLabel,
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
