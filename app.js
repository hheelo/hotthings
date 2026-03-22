const fallbackPayload = {
  source: "页面内置兜底数据",
  updatedAt: "2026-03-22T23:40:00+08:00",
  hours: [
    {
      slot: "2026-03-22T20:00:00+08:00",
      label: "03-22 20:00",
      shortLabel: "20:00",
      summary: "黄金时段热搜进入全天峰值，娱乐、社会、科技三类内容的讨论同时活跃。",
      items: [
        {
          title: "新机发布会参数对比刷屏",
          desc: "用户主要比较影像、续航和价格区间，摘要需求明显高于长篇评测阅读。",
          category: "数码",
          heat: "149k"
        },
        {
          title: "热门综艺名场面持续扩散",
          desc: "短视频切片推动二次传播，讨论多集中在嘉宾互动、剪辑节奏和现场反应。",
          category: "综艺",
          heat: "111k"
        },
        {
          title: "公共议题深度解读进入热榜",
          desc: "用户偏好能快速说明背景、关键争点和后续影响的简明概括型内容。",
          category: "社会",
          heat: "97k"
        }
      ]
    }
  ]
};

const state = {
  activeHour: "20:00",
  payload: fallbackPayload
};

const timeline = document.querySelector("#timeline");
const cards = document.querySelector("#cards");
const activeHourTitle = document.querySelector("#activeHourTitle");
const activeHourSummary = document.querySelector("#activeHourSummary");
const timeCaption = document.querySelector("#timeCaption");
const updateBadge = document.querySelector("#updateBadge");
const dataHint = document.querySelector("#dataHint");
const refreshButton = document.querySelector("#refreshButton");
const timelineButtonTemplate = document.querySelector("#timelineButtonTemplate");
const cardTemplate = document.querySelector("#cardTemplate");

const formatNow = () =>
  new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date());

const formatDataTime = (value) => {
  if (!value) return "未提供";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "格式异常";

  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
};

const getEntryKey = (entry) => entry.slot || entry.hour || entry.label;
const getShortLabel = (entry) => entry.shortLabel || entry.hour || "--:--";
const getFullLabel = (entry) => entry.label || entry.hour || "未知时段";

const pickInitialHour = (hours) => hours[0] ? getEntryKey(hours[0]) : "20:00";

const getHours = () => state.payload.hours || [];

const renderLoading = (message) => {
  timeline.innerHTML = "";
  cards.innerHTML = `<div class="loading-card"><p class="loading-copy">${message}</p></div>`;
  activeHourTitle.textContent = "加载中";
  activeHourSummary.textContent = "正在读取每小时热搜数据。";
  timeCaption.textContent = `最近刷新：${formatNow()}`;
  updateBadge.textContent = "加载中";
  dataHint.textContent = "数据文件路径：./data/hourly-trends.json";
};

const renderTimeline = () => {
  timeline.innerHTML = "";

  getHours().forEach((entry) => {
    const button = timelineButtonTemplate.content.firstElementChild.cloneNode(true);
    const entryKey = getEntryKey(entry);
    button.dataset.hour = entryKey;
    button.setAttribute("aria-selected", String(entryKey === state.activeHour));
    button.innerHTML = `<span>${getShortLabel(entry)}</span><span>${entry.items.length} 条</span>`;
    button.addEventListener("click", () => {
      state.activeHour = entryKey;
      renderTimeline();
      renderCards();
    });
    timeline.appendChild(button);
  });
};

const renderCards = () => {
  const hours = getHours();
  const entry = hours.find((item) => getEntryKey(item) === state.activeHour) || hours[0];

  if (!entry) {
    renderLoading("没有可展示的热搜数据。");
    return;
  }

  activeHourTitle.textContent = `${getFullLabel(entry)} 热搜`;
  activeHourSummary.textContent = entry.summary;
  timeCaption.textContent = `最近刷新：${formatNow()}`;
  updateBadge.textContent = state.payload.source || "未标注来源";
  dataHint.textContent = `数据更新时间：${formatDataTime(state.payload.updatedAt)}`;
  cards.innerHTML = "";

  entry.items.forEach((item, index) => {
    const card = cardTemplate.content.firstElementChild.cloneNode(true);
    card.querySelector(".card-rank").textContent = String(index + 1).padStart(2, "0");
    card.querySelector(".card-title").textContent = item.title;
    card.querySelector(".card-desc").textContent = item.desc;
    card.querySelector(".meta-tag").textContent = item.category;
    card.querySelector(".meta-heat").textContent = `热度 ${item.heat}`;
    cards.appendChild(card);
  });
};

const applyPayload = (payload) => {
  state.payload = payload?.hours?.length ? payload : fallbackPayload;
  state.activeHour = pickInitialHour(getHours());
  renderTimeline();
  renderCards();
};

const loadTrendData = async () => {
  renderLoading("正在读取数据文件…");

  try {
    const response = await fetch("./data/hourly-trends.json", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const payload = await response.json();
    applyPayload(payload);
  } catch {
    applyPayload(fallbackPayload);
    updateBadge.textContent = "已回退到内置数据";
    dataHint.textContent = "未读取到 ./data/hourly-trends.json，可直接替换该文件接入真实数据。";
  }
};

refreshButton.addEventListener("click", async () => {
  refreshButton.textContent = "刷新中";
  await loadTrendData();
  window.setTimeout(() => {
    refreshButton.textContent = "刷新摘要";
  }, 1200);
});

loadTrendData();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}
