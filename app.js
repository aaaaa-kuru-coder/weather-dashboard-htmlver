"use strict";

const CONFIG = {
  latitude: 35.68,
  longitude: 139.77,
  timezone: "Asia/Tokyo",
  apiBase: "https://api.open-meteo.com/v1/forecast",
  pastDays: 2,
  forecastDays: 2,
  cacheKey: "weatherDashboardCacheV4_3",
  cacheMaxAgeMs: 3 * 60 * 60 * 1000,
};

const PRESSURE_MAP_CONFIG = {
  apiBase: "https://api.open-meteo.com/v1/jma",
  latitudeMin: 23.0,
  latitudeMax: 49.0,
  longitudeMin: 121.25,
  longitudeMax: 153.75,
  step: 1.25,
  cacheKey: "weatherPressureMapCacheV4_4",
};

const WEATHER_CODE_JA = {
  0: "快晴", 1: "晴れ", 2: "一部曇り", 3: "曇り", 45: "霧", 48: "着氷性の霧",
  51: "弱い霧雨", 53: "霧雨", 55: "強い霧雨", 56: "弱い着氷性霧雨", 57: "強い着氷性霧雨",
  61: "弱い雨", 63: "雨", 65: "強い雨", 66: "弱い着氷性の雨", 67: "強い着氷性の雨",
  71: "弱い雪", 73: "雪", 75: "強い雪", 77: "雪粒", 80: "弱いにわか雨", 81: "にわか雨",
  82: "強いにわか雨", 85: "弱いにわか雪", 86: "強いにわか雪", 95: "雷雨",
  96: "ひょうを伴う雷雨", 99: "強いひょうを伴う雷雨",
};

const THUNDER_WEATHER_CODES = new Set([95, 96, 99]);

const RAIN_COLOR_BINS = [
  { lower: 0, upper: 1, color: "#d9d9d9", label: "～1mm" },
  { lower: 1, upper: 2, color: "#cfefff", label: "～2mm" },
  { lower: 2, upper: 3, color: "#70cfff", label: "～3mm" },
  { lower: 3, upper: 5, color: "#1f77d0", label: "～5mm" },
  { lower: 5, upper: 7, color: "#2ca25f", label: "～7mm" },
  { lower: 7, upper: 10, color: "#9acd32", label: "～10mm" },
  { lower: 10, upper: 20, color: "#ffd92f", label: "～20mm" },
  { lower: 20, upper: 40, color: "#ff8c1a", label: "～40mm" },
  { lower: 40, upper: Infinity, color: "#e31a1c", label: "40mm～" },
];

const SERIES_LEGEND = [
  { label: "一昨日 気温", color: "#f6c89f", style: "solid" },
  { label: "昨日 気温", color: "#f28c28", style: "solid" },
  { label: "今日 気温", color: "#d62728", style: "solid" },
  { label: "今日 気温（予報）", color: "#d62728", style: "dashed" },
  { label: "今日 降水確率", color: "#1f77b4", style: "solid" },
  { label: "今日 湿度", color: "#159a9c", style: "solid" },
  { label: "今日 湿度（予報）", color: "#159a9c", style: "dotted" },
  { label: "現在時刻", color: "#7f96aa", style: "current" },
];

let weatherChart = null;
let latestRows = [];
let latestFetchedAt = null;
let currentTimeTimer = null;
let fetchedAtLabelTimer = null;

const $ = (id) => document.getElementById(id);

function getRainColor(value) {
  const v = Number.isFinite(Number(value)) ? Number(value) : 0;
  for (const bin of RAIN_COLOR_BINS) {
    if (bin.lower === 0 && v <= bin.upper) return bin.color;
    if (bin.lower < v && v <= bin.upper) return bin.color;
  }
  return RAIN_COLOR_BINS.at(-1).color;
}

function dateKeyFromIso(isoLocal) {
  return isoLocal.slice(0, 10);
}

function hourFromIso(isoLocal) {
  return Number(isoLocal.slice(11, 13));
}

function shiftDateKey(dateKey, days) {
  const [y, m, d] = dateKey.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

function getJstParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: CONFIG.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return {
    dateKey: `${map.year}-${map.month}-${map.day}`,
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
    decimalHour: Number(map.hour) + Number(map.minute) / 60 + Number(map.second) / 3600,
    mmdd: `${map.month}/${map.day}`,
    hhmm: `${map.hour}:${map.minute}`,
    display: `${map.year}年${map.month}月${map.day}日 ${map.hour}:${map.minute}`,
  };
}

function formatFetchedAtLabel(fetchedAt) {
  const ageMs = Math.max(0, Date.now() - fetchedAt.getTime());
  const minutes = Math.floor(ageMs / 60000);

  if (ageMs < 3 * 60 * 1000) return "たった今";
  if (ageMs < 60 * 60 * 1000) return `${minutes}分前`;

  return getJstParts(fetchedAt).display;
}

function updateFetchedAtLabel() {
  if (!latestFetchedAt) return;
  $("updatedAt").textContent = `最終データ取得：${formatFetchedAtLabel(latestFetchedAt)}`;
}

function isMobileLayout() {
  return window.matchMedia("(max-width: 760px)").matches;
}

function buildApiUrl() {
  const params = new URLSearchParams({
    latitude: String(CONFIG.latitude),
    longitude: String(CONFIG.longitude),
    timezone: CONFIG.timezone,
    past_days: String(CONFIG.pastDays),
    forecast_days: String(CONFIG.forecastDays),
    hourly: [
      "temperature_2m",
      "relative_humidity_2m",
      "precipitation_probability",
      "weather_code",
      "precipitation",
    ].join(","),
  });
  return `${CONFIG.apiBase}?${params.toString()}`;
}

function normalizeWeather(data) {
  const h = data.hourly;
  if (!h || !Array.isArray(h.time)) throw new Error("Open-Meteoのhourlyデータがありません。");

  return h.time.map((datetime, i) => {
    const weatherCode = Number(h.weather_code[i]);
    return {
      datetime,
      date: dateKeyFromIso(datetime),
      hour: hourFromIso(datetime),
      weather_code: weatherCode,
      weather_ja: WEATHER_CODE_JA[weatherCode] ?? "不明",
      has_thunder: THUNDER_WEATHER_CODES.has(weatherCode),
      temperature_2m_c: Number(h.temperature_2m[i]),
      relative_humidity_2m_percent: Number(h.relative_humidity_2m[i]),
      precipitation_probability_percent: Number(h.precipitation_probability[i]),
      precipitation_mm: Number(h.precipitation[i]),
    };
  });
}

function rowsForDate(rows, dateKey) {
  return rows.filter((r) => r.date === dateKey);
}

function pointRows(rows, valueKey, filter = () => true) {
  return rows.filter(filter).map((r) => ({ x: r.hour, y: r[valueKey], row: r }));
}

function findExtreme(rows, key, mode) {
  if (!rows.length) return null;
  return rows.reduce((best, row) => {
    if (!best) return row;
    if (mode === "max" && row[key] > best[key]) return row;
    if (mode === "min" && row[key] < best[key]) return row;
    return best;
  }, null);
}

function buildDatasets(rows, nowJst) {
  const todayKey = nowJst.dateKey;
  const tomorrowKey = shiftDateKey(todayKey, 1);
  const yesterdayKey = shiftDateKey(todayKey, -1);
  const dayBeforeKey = shiftDateKey(todayKey, -2);
  const showTomorrow = nowJst.hour >= 18;

  const today = rowsForDate(rows, todayKey);
  const yesterday = rowsForDate(rows, yesterdayKey);
  const dayBefore = rowsForDate(rows, dayBeforeKey);
  const tomorrow = rowsForDate(rows, tomorrowKey).filter((r) => r.hour <= 18);

  if (!today.length) throw new Error(`今日分のデータがありません。today=${todayKey}`);
  if (showTomorrow && !tomorrow.length) throw new Error(`翌日0～18時のデータがありません。tomorrow=${tomorrowKey}`);

  const todayFuture = (r) => r.hour >= nowJst.hour;
  const todayPast = (r) => r.hour <= nowJst.hour;

  const datasets = [
    {
      label: "一昨日 気温",
      yAxisID: "yTemp",
      data: pointRows(dayBefore, "temperature_2m_c"),
      borderColor: "#f6c89f",
      backgroundColor: "#f6c89f",
      borderWidth: 1.53,
      pointRadius: 0,
      tension: 0.2,
      order: 5,
    },
    {
      label: "昨日 気温",
      yAxisID: "yTemp",
      data: pointRows(yesterday, "temperature_2m_c"),
      borderColor: "#f28c28",
      backgroundColor: "#f28c28",
      borderWidth: 1.80,
      pointRadius: 0,
      tension: 0.2,
      order: 5,
    },
    {
      label: "今日 気温",
      yAxisID: "yTemp",
      data: pointRows(today, "temperature_2m_c", todayPast),
      borderColor: "#d62728",
      backgroundColor: "#d62728",
      borderWidth: 2.07,
      pointRadius: 0,
      tension: 0.2,
      order: 3,
    },
    {
      label: "今日 気温（予報）",
      yAxisID: "yTemp",
      data: pointRows(today, "temperature_2m_c", todayFuture),
      borderColor: "#d62728",
      backgroundColor: "#d62728",
      borderWidth: 2.07,
      borderDash: [9, 6],
      pointRadius: 0,
      tension: 0.2,
      order: 3,
    },

    // 降水確率の「将来部分だけ」を薄青で0%まで塗るための補助データセット。
    // 過去部分は線だけにし、18時以降に翌日予報を重ねても塗りが重ならないようにする。
    {
      label: "今日 降水確率（塗り）",
      yAxisID: "yPop",
      data: pointRows(today, "precipitation_probability_percent", todayFuture),
      borderWidth: 0,
      pointRadius: 0,
      backgroundColor: "rgba(83, 170, 225, 0.16)",
      fill: "origin",
      tension: 0.15,
      order: 10,
      _hideFromLegend: true,
      _hideFromTooltip: true,
    },
    {
      label: "今日 降水確率",
      yAxisID: "yPop",
      data: pointRows(today, "precipitation_probability_percent"),
      borderColor: "#1f77b4",
      backgroundColor: "#1f77b4",
      borderWidth: 1.25,
      pointRadius: 2.2,
      pointHoverRadius: 5,
      tension: 0.15,
      order: 4,
    },

    // 湿度は同じ0～100%軸を利用。
    {
      label: "今日 湿度",
      yAxisID: "yPop",
      data: pointRows(today, "relative_humidity_2m_percent", todayPast),
      borderColor: "#159a9c",
      backgroundColor: "#159a9c",
      borderWidth: 1.35,
      pointRadius: 0,
      tension: 0.18,
      order: 5,
    },
    {
      label: "今日 湿度（予報）",
      yAxisID: "yPop",
      data: pointRows(today, "relative_humidity_2m_percent", todayFuture),
      borderColor: "#159a9c",
      backgroundColor: "#159a9c",
      borderWidth: 1.35,
      borderDash: [5, 5],
      pointRadius: 0,
      tension: 0.18,
      order: 5,
    },

    {
      label: "今日 降水量マーカー",
      yAxisID: "yPop",
      showLine: false,
      data: pointRows(today, "precipitation_probability_percent", (r) => r.precipitation_probability_percent >= 10),
      pointStyle: "rect",
      pointRadius: 5.33,
      pointHoverRadius: 6.33,
      pointBorderWidth: 0.65,
      pointBorderColor: "#555555",
      pointBackgroundColor: (ctx) => getRainColor(ctx.raw?.row?.precipitation_mm),
      order: 1,
      _hideFromLegend: true,
    },
  ];

  if (showTomorrow) {
    datasets.push(
      {
        label: "翌日 気温（0～18時）",
        yAxisID: "yTemp",
        data: pointRows(tomorrow, "temperature_2m_c"),
        borderColor: "rgba(214, 39, 40, 0.58)",
        backgroundColor: "rgba(214, 39, 40, 0.58)",
        borderWidth: 1.87,
        borderDash: [9, 6],
        pointRadius: 0,
        tension: 0.2,
        order: 4,
      },

      // 翌日0～18時は全て将来なので、全域を薄青で塗る。
      {
        label: "翌日 降水確率（塗り）",
        yAxisID: "yPop",
        data: pointRows(tomorrow, "precipitation_probability_percent"),
        borderWidth: 0,
        pointRadius: 0,
        backgroundColor: "rgba(83, 170, 225, 0.10)",
        fill: "origin",
        tension: 0.15,
        order: 11,
        _hideFromLegend: true,
        _hideFromTooltip: true,
      },
      {
        label: "翌日 降水確率（0～18時）",
        yAxisID: "yPop",
        data: pointRows(tomorrow, "precipitation_probability_percent"),
        borderColor: "rgba(31, 119, 180, 0.58)",
        backgroundColor: "rgba(31, 119, 180, 0.58)",
        borderWidth: 1.15,
        borderDash: [2, 5],
        pointRadius: 2.0,
        pointHoverRadius: 5,
        tension: 0.15,
        order: 4,
      },
      {
        label: "翌日 湿度（0～18時）",
        yAxisID: "yPop",
        data: pointRows(tomorrow, "relative_humidity_2m_percent"),
        borderColor: "rgba(21, 154, 156, 0.62)",
        backgroundColor: "rgba(21, 154, 156, 0.62)",
        borderWidth: 1.25,
        borderDash: [5, 5],
        pointRadius: 0,
        tension: 0.18,
        order: 5,
      },
      {
        label: "翌日 降水量マーカー",
        yAxisID: "yPop",
        showLine: false,
        data: pointRows(tomorrow, "precipitation_probability_percent", (r) => r.precipitation_probability_percent >= 10),
        pointStyle: "rect",
        pointRadius: 5.33,
        pointHoverRadius: 6.33,
        pointBorderWidth: 0.65,
        pointBorderColor: "rgba(85,85,85,0.65)",
        pointBackgroundColor: (ctx) => {
          const c = getRainColor(ctx.raw?.row?.precipitation_mm);
          return hexToRgba(c, 0.65);
        },
        order: 1,
        _hideFromLegend: true,
      }
    );
  }

  const annotations = [];
  if (!showTomorrow) {
    const maxTemp = findExtreme(today, "temperature_2m_c", "max");
    const minTemp = findExtreme(today, "temperature_2m_c", "min");
    const maxPop = findExtreme(today, "precipitation_probability_percent", "max");
    if (maxTemp) annotations.push({ row: maxTemp, axis: "yTemp", text: `${maxTemp.temperature_2m_c.toFixed(1)}℃`, color: "#d62728", offsetY: -25 });
    if (minTemp) annotations.push({ row: minTemp, axis: "yTemp", text: `${minTemp.temperature_2m_c.toFixed(1)}℃`, color: "#d62728", offsetY: 34 });
    if (maxPop) annotations.push({ row: maxPop, axis: "yPop", text: `${Math.round(maxPop.precipitation_probability_percent)}%`, color: "#1f77b4", offsetY: -28 });
  } else {
    const maxTemp = findExtreme(tomorrow, "temperature_2m_c", "max");
    const minTemp = findExtreme(tomorrow, "temperature_2m_c", "min");
    const maxPop = findExtreme(tomorrow, "precipitation_probability_percent", "max");
    if (maxTemp) annotations.push({ row: maxTemp, axis: "yTemp", text: `翌日最高 ${maxTemp.temperature_2m_c.toFixed(1)}℃`, color: "#b22222", offsetY: -42 });
    if (minTemp) annotations.push({ row: minTemp, axis: "yTemp", text: `翌日最低 ${minTemp.temperature_2m_c.toFixed(1)}℃`, color: "#b22222", offsetY: 50 });
    if (maxPop) annotations.push({ row: maxPop, axis: "yPop", text: `翌日最大 ${Math.round(maxPop.precipitation_probability_percent)}%`, color: "#145a8d", offsetY: -45 });
  }

  const thunderRows = [];
  for (const row of today) {
    if (row.precipitation_probability_percent >= 10 && row.has_thunder) thunderRows.push({ row, alpha: 1 });
  }
  if (showTomorrow) {
    for (const row of tomorrow) {
      if (row.precipitation_probability_percent >= 10 && row.has_thunder) thunderRows.push({ row, alpha: 0.7 });
    }
  }

  return { datasets, annotations, thunderRows, showTomorrow };
}

function hexToRgba(hex, alpha) {
  const h = hex.replace("#", "");
  const n = parseInt(h, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

const overlayPlugin = {
  id: "weatherOverlay",

  beforeDatasetsDraw(chart) {
    const { ctx, scales, chartArea } = chart;
    if (!chartArea || !scales.x || !scales.yTemp) return;

    ctx.save();
    ctx.strokeStyle = "rgba(70, 85, 105, 0.28)";
    ctx.lineWidth = 1.35;
    ctx.setLineDash([]);

    // 0時・12時・23時の縦罫線を強調する。
    for (const hour of [0, 12, 23]) {
      const x = scales.x.getPixelForValue(hour);
      if (x < chartArea.left - 1 || x > chartArea.right + 1) continue;
      ctx.beginPath();
      ctx.moveTo(x, chartArea.top);
      ctx.lineTo(x, chartArea.bottom);
      ctx.stroke();
    }

    // 0℃・10℃・20℃・30℃の横罫線を強調する。
    for (const temp of [0, 10, 20, 30]) {
      const y = scales.yTemp.getPixelForValue(temp);
      if (y < chartArea.top - 1 || y > chartArea.bottom + 1) continue;
      ctx.beginPath();
      ctx.moveTo(chartArea.left, y);
      ctx.lineTo(chartArea.right, y);
      ctx.stroke();
    }

    ctx.restore();
  },

  afterDatasetsDraw(chart, args, pluginOptions) {
    const { ctx, scales, chartArea } = chart;
    const annotations = pluginOptions.annotations ?? [];
    const thunderRows = pluginOptions.thunderRows ?? [];
    const compact = pluginOptions.compact ?? false;

    ctx.save();

    // 現在時刻線。キャッシュ時刻ではなく「いま」のJSTで毎回描く。
    const now = getJstParts(new Date());
    if (now.decimalHour >= 0 && now.decimalHour <= 23 && chartArea) {
      const xNow = scales.x.getPixelForValue(now.decimalHour);
      ctx.save();
      ctx.strokeStyle = "rgba(105, 130, 153, 0.68)";
      ctx.lineWidth = compact ? 1.1 : 1.5;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(xNow, chartArea.top);
      ctx.lineTo(xNow, chartArea.bottom);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    for (const ann of annotations) {
      const x = scales.x.getPixelForValue(ann.row.hour);
      const yValue = ann.axis === "yTemp" ? ann.row.temperature_2m_c : ann.row.precipitation_probability_percent;
      const y = scales[ann.axis].getPixelForValue(yValue);
      const offsetScale = compact ? 0.70 : 1;
      const ty = y + ann.offsetY * offsetScale;

      ctx.strokeStyle = ann.color;
      ctx.globalAlpha = 0.65;
      ctx.lineWidth = compact ? 0.8 : 1;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, ty + (ann.offsetY < 0 ? 7 : -7));
      ctx.stroke();

      ctx.globalAlpha = 1;
      ctx.fillStyle = ann.color;
      ctx.beginPath();
      ctx.arc(x, y, compact ? 3.2 : 4.2, 0, Math.PI * 2);
      ctx.fill();

      ctx.font = `bold ${compact ? 20 : 32}px -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans JP', sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = ann.offsetY < 0 ? "bottom" : "top";
      ctx.fillText(ann.text, x, ty);
    }

    for (const item of thunderRows) {
      const row = item.row;
      const x = scales.x.getPixelForValue(row.hour);
      const y = scales.yPop.getPixelForValue(row.precipitation_probability_percent);
      ctx.globalAlpha = item.alpha;
      ctx.fillStyle = "#7b2cbf";
      ctx.font = `bold ${compact ? 15 : 22}px 'DejaVu Sans', 'Segoe UI Symbol', sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText("↯", x, y - (compact ? 7 : 11));
    }

    ctx.restore();
  },
};

Chart.register(overlayPlugin);

function tooltipLabel(context) {
  const raw = context.raw;
  const row = raw?.row;
  if (!row) return `${context.dataset.label}: ${context.formattedValue}`;
  if (context.dataset._hideFromTooltip) return "";
  if (context.dataset.yAxisID === "yTemp") return `${context.dataset.label}: ${row.temperature_2m_c.toFixed(1)}℃`;
  if (context.dataset.label.includes("降水量マーカー")) {
    return `降水量: ${row.precipitation_mm.toFixed(1)}mm/h / 降水確率 ${Math.round(row.precipitation_probability_percent)}% / ${row.weather_ja}`;
  }
  if (context.dataset.label.includes("湿度")) {
    return `${context.dataset.label}: ${Math.round(row.relative_humidity_2m_percent)}%`;
  }
  return `${context.dataset.label}: ${Math.round(row.precipitation_probability_percent)}%`;
}

function renderSeriesLegend(showTomorrow) {
  const parent = $("seriesLegend");
  parent.innerHTML = "";

  const items = [...SERIES_LEGEND];
  if (showTomorrow) {
    items.splice(items.length - 1, 0,
      { label: "翌日 気温（0～18時）", color: "rgba(214, 39, 40, 0.58)", style: "dashed" },
      { label: "翌日 降水確率（0～18時）", color: "rgba(31, 119, 180, 0.58)", style: "dotted" },
      { label: "翌日 湿度（0～18時）", color: "rgba(21, 154, 156, 0.62)", style: "dotted" },
    );
  }

  for (const item of items) {
    const el = document.createElement("span");
    el.className = "series-legend-item";

    const swatch = document.createElement("span");
    swatch.className = `series-line ${item.style}`;
    swatch.style.setProperty("--line-color", item.color);

    const text = document.createElement("span");
    text.textContent = item.label;

    el.appendChild(swatch);
    el.appendChild(text);
    parent.appendChild(el);
  }
}

function renderChart(rows, fetchedAt) {
  // 表示対象日は常に現在のJST。キャッシュ取得日時を基準にしない。
  const nowJst = getJstParts(new Date());
  const { datasets, annotations, thunderRows, showTomorrow } = buildDatasets(rows, nowJst);
  const compact = isMobileLayout();

  if (weatherChart) weatherChart.destroy();

  const ctx = $("weatherChart").getContext("2d");
  weatherChart = new Chart(ctx, {
    type: "line",
    data: { datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      parsing: false,
      animation: false,
      interaction: { mode: "nearest", intersect: false },
      layout: { padding: compact
        ? { top: 26, right: 0, bottom: 2, left: 0 }
        : { top: 42, right: 6, bottom: 4, left: 2 } },
      plugins: {
        weatherOverlay: { annotations, thunderRows, compact },
        legend: { display: false },
        tooltip: {
          filter(item) {
            return !item.dataset._hideFromTooltip;
          },
          callbacks: {
            title(items) {
              const row = items[0]?.raw?.row;
              return row ? row.datetime.replace("T", " ") : "";
            },
            label: tooltipLabel,
            afterBody(items) {
              const row = items.find((i) => i.raw?.row)?.raw?.row;
              if (!row) return [];
              return [`天気: ${row.weather_ja}${row.has_thunder ? " / 雷予報" : ""}`];
            },
          },
        },
      },
      scales: {
        x: {
          type: "linear",
          min: 0,
          max: 23,
          grid: { color: "rgba(0,0,0,0.10)" },
          ticks: {
            stepSize: 3,
            font: { size: compact ? 9 : 13 },
            maxRotation: 0,
            minRotation: 0,
            callback: (v) => `${v}:00`,
          },
          title: { display: true, text: "時刻", font: { size: compact ? 11 : 15 } },
        },
        yTemp: {
          position: "left",
          grid: { color: "rgba(0,0,0,0.12)" },
          ticks: { font: { size: compact ? 9 : 13 }, padding: compact ? 2 : 4 },
          // 軸名はHTML側で上部表示し、横幅を節約する。
          title: { display: false },
        },
        yPop: {
          position: "right",
          min: 0,
          max: 105,
          grid: { drawOnChartArea: false },
          ticks: { stepSize: 20, font: { size: compact ? 9 : 13 }, padding: compact ? 2 : 4, callback: (v) => `${v}%` },
          title: { display: false },
        },
      },
    },
  });

  renderSeriesLegend(showTomorrow);
  $("tomorrowNote").hidden = !showTomorrow;
  updateFetchedAtLabel();

  if (currentTimeTimer) clearInterval(currentTimeTimer);
  currentTimeTimer = setInterval(() => {
    if (weatherChart) weatherChart.draw();
  }, 60 * 1000);

  if (fetchedAtLabelTimer) clearInterval(fetchedAtLabelTimer);
  fetchedAtLabelTimer = setInterval(updateFetchedAtLabel, 60 * 1000);
}

function appendRainLegendItem(parent, bin) {
  const item = document.createElement("span");
  item.className = "rain-legend-item";
  item.innerHTML = `<span class="rain-swatch" style="background:${bin.color}"></span><span>${bin.label}</span>`;
  parent.appendChild(item);
}

function renderRainLegend() {
  const middle = $("rainLegendMiddle");
  const right = $("rainLegendRight");
  middle.innerHTML = "";
  right.innerHTML = "";

  // 中央列：～1mm ～ ～7mm
  for (const bin of RAIN_COLOR_BINS.slice(0, 5)) {
    appendRainLegendItem(middle, bin);
  }

  // 右列：～10mm ～ 40mm～ ＋ 雷予報
  for (const bin of RAIN_COLOR_BINS.slice(5)) {
    appendRainLegendItem(right, bin);
  }

  const thunder = document.createElement("span");
  thunder.className = "rain-legend-item";
  thunder.innerHTML = `<span class="thunder-swatch">↯</span><span>雷予報</span>`;
  right.appendChild(thunder);
}

function saveCache(rows, fetchedAt) {
  try {
    const payload = {
      version: 4.3,
      fetchedAt: fetchedAt.toISOString(),
      rows,
    };
    localStorage.setItem(CONFIG.cacheKey, JSON.stringify(payload));
  } catch (err) {
    console.warn("キャッシュ保存に失敗しました。", err);
  }
}

function loadCache() {
  try {
    const raw = localStorage.getItem(CONFIG.cacheKey);
    if (!raw) return null;
    const payload = JSON.parse(raw);
    if (!payload || !Array.isArray(payload.rows) || !payload.fetchedAt) return null;
    const fetchedAt = new Date(payload.fetchedAt);
    if (Number.isNaN(fetchedAt.getTime())) return null;
    return { rows: payload.rows, fetchedAt };
  } catch (err) {
    console.warn("キャッシュ読込に失敗しました。", err);
    return null;
  }
}

function cacheAgeMs(fetchedAt) {
  return Math.max(0, Date.now() - fetchedAt.getTime());
}

async function fetchWeather({ manual = false } = {}) {
  $("refreshButton").disabled = true;
  $("status").className = "status";
  $("status").textContent = manual
    ? "Open-Meteoから最新データを取得しています..."
    : "保存済みデータが3時間以上前のため、最新データを取得しています...";

  try {
    const response = await fetch(buildApiUrl(), { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
    const data = await response.json();
    latestRows = normalizeWeather(data);
    latestFetchedAt = new Date();
    saveCache(latestRows, latestFetchedAt);
    renderChart(latestRows, latestFetchedAt);
    $("csvButton").disabled = false;
    $("status").className = "status";
    $("status").textContent = "";
  } catch (err) {
    console.error(err);
    $("status").className = "status error";
    if (latestRows.length) {
      $("status").textContent = `最新データの取得に失敗しました。保存済みデータを表示しています：${err.message}`;
    } else {
      $("status").textContent = `取得に失敗しました：${err.message}`;
    }
  } finally {
    $("refreshButton").disabled = false;
  }
}

function initializeData() {
  const cached = loadCache();

  if (!cached) {
    $("status").className = "status";
    $("status").textContent = "保存済みデータがないため、Open-Meteoから取得します...";
    fetchWeather({ manual: false });
    return;
  }

  latestRows = cached.rows;
  latestFetchedAt = cached.fetchedAt;

  try {
    // まずキャッシュを即描画。古くてもAPI応答待ちで真っ白にしない。
    renderChart(latestRows, latestFetchedAt);
    $("csvButton").disabled = false;
  } catch (err) {
    console.warn("キャッシュの描画に失敗しました。再取得します。", err);
    localStorage.removeItem(CONFIG.cacheKey);
    latestRows = [];
    latestFetchedAt = null;
    fetchWeather({ manual: false });
    return;
  }

  const age = cacheAgeMs(latestFetchedAt);
  if (age < CONFIG.cacheMaxAgeMs) {
    $("status").className = "status";
    $("status").textContent = "";
  } else {
    $("status").className = "status";
    $("status").textContent = "最新データを取得しています...";
    fetchWeather({ manual: false });
  }
}

function escapeCsv(value) {
  const s = String(value ?? "");
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

function downloadCsv() {
  if (!latestRows.length) return;
  const headers = [
    "datetime", "date", "hour", "weather_code", "weather_ja", "has_thunder",
    "temperature_2m_c", "relative_humidity_2m_percent", "precipitation_probability_percent", "precipitation_mm",
  ];
  const lines = [headers.join(",")];
  for (const row of latestRows) lines.push(headers.map((h) => escapeCsv(row[h])).join(","));
  const blob = new Blob(["\ufeff" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const now = getJstParts(latestFetchedAt ?? new Date());
  a.href = url;
  a.download = `weather_${now.dateKey}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}



// ============================================================
// 日本周辺の気圧配置・風向き（必要時だけ別API取得）
// ============================================================

const PRESSURE_COASTLINES = [
  // 本州（簡易海岸線）
  [[130.9,34.0],[132.1,34.2],[133.3,34.4],[134.6,34.6],[135.2,34.3],[136.7,34.5],
   [138.0,34.7],[139.7,35.5],[140.7,36.5],[141.0,38.1],[141.6,40.1],[140.2,41.2],
   [139.5,40.1],[139.0,38.8],[138.5,37.3],[137.2,36.7],[136.1,36.5],[135.1,35.6],
   [133.5,35.5],[132.0,35.0],[130.9,34.0]],
  // 北海道
  [[140.4,41.4],[141.1,41.8],[140.7,42.5],[141.5,43.2],[142.5,43.6],[143.5,44.2],
   [145.2,43.4],[145.4,42.7],[144.4,42.1],[143.1,42.0],[141.8,41.4],[140.4,41.4]],
  // 四国
  [[132.0,33.9],[133.0,33.5],[134.4,33.3],[134.8,34.0],[133.8,34.4],[132.6,34.3],[132.0,33.9]],
  // 九州
  [[129.6,33.9],[130.6,33.7],[131.4,33.2],[131.8,32.2],[131.1,31.3],[130.2,31.0],
   [129.7,31.7],[130.0,32.6],[129.6,33.9]],
  // 朝鮮半島（簡易）
  [[126.0,34.3],[127.2,34.6],[128.3,35.2],[129.4,36.0],[129.5,37.6],[128.3,38.5],
   [126.6,38.7],[125.5,37.8],[125.3,36.2],[126.0,34.3]],
  // 台湾
  [[120.0,22.0],[121.0,21.9],[121.8,23.0],[121.4,24.5],[120.5,25.2],[120.0,24.0],[120.0,22.0]],
  // 中国大陸の東岸（画面内の目安）
  [[125.0,39.8],[123.0,39.0],[122.0,37.5],[121.0,36.0],[120.3,34.0],[121.0,31.5],[121.5,30.0],[122.0,28.5]],
];

function buildPressureGridCoordinates() {
  const lats = [];
  const lons = [];
  for (let lat = PRESSURE_MAP_CONFIG.latitudeMin; lat <= PRESSURE_MAP_CONFIG.latitudeMax + 1e-9; lat += PRESSURE_MAP_CONFIG.step) {
    lats.push(Number(lat.toFixed(2)));
  }
  for (let lon = PRESSURE_MAP_CONFIG.longitudeMin; lon <= PRESSURE_MAP_CONFIG.longitudeMax + 1e-9; lon += PRESSURE_MAP_CONFIG.step) {
    lons.push(Number(lon.toFixed(2)));
  }

  const points = [];
  for (const lat of lats) {
    for (const lon of lons) points.push({ lat, lon });
  }
  return { lats, lons, points };
}

function buildPressureApiUrl(points) {
  const params = new URLSearchParams({
    latitude: points.map((p) => p.lat).join(","),
    longitude: points.map((p) => p.lon).join(","),
    current: ["pressure_msl", "wind_speed_10m", "wind_direction_10m"].join(","),
    timezone: CONFIG.timezone,
    cell_selection: "nearest",
    //elevation: "nan",
  });
  return `${PRESSURE_MAP_CONFIG.apiBase}?${params.toString()}`;
}

function savePressureCache(payload) {
  try {
    localStorage.setItem(PRESSURE_MAP_CONFIG.cacheKey, JSON.stringify(payload));
  } catch (err) {
    console.warn("気圧配置キャッシュの保存に失敗しました。", err);
  }
}

function loadPressureCache() {
  try {
    const raw = localStorage.getItem(PRESSURE_MAP_CONFIG.cacheKey);
    if (!raw) return null;
    const payload = JSON.parse(raw);
    if (!payload || !Array.isArray(payload.points)) return null;
    return payload;
  } catch {
    return null;
  }
}
// APIの分割取得をするための補助関数
function chunkArray(array,size){
  const chunks = [];

  for(let i=0; i<array.length; i+=size){
    chunk.push(array.slice(i,i+size));
  }
  return chunks;
}

async function fetchPressureWind() {
  const button = $("pressureButton");
  const status = $("pressureStatus");
  button.disabled = true;
  status.textContent = "日本周辺の格子データを取得しています…";

  const grid = buildPressureGridCoordinates();

  try {
    const response = await fetch(
      buildPressureApiUrl(grid.points),
      {
        cache: "no-store",
      }
    );
    
    if (!response.ok) {
      let reason = "";
    
      try {
        const errorBody = await response.json();
    
        reason =
          errorBody?.reason ??
          JSON.stringify(errorBody);
      } catch {
        reason = await response.text();
      }
    
      throw new Error(
        `HTTP ${response.status}: ${reason}`
      );
    }
    
    const raw = await response.json();
    const entries = Array.isArray(raw) ? raw : [raw];

    if (entries.length !== grid.points.length) {
      throw new Error(`格子点数が一致しません（期待 ${grid.points.length} / 取得 ${entries.length}）`);
    }

    const points = entries.map((entry, i) => ({
      lat: grid.points[i].lat,
      lon: grid.points[i].lon,
      pressure: Number(entry.current?.pressure_msl),
      windSpeed: Number(entry.current?.wind_speed_10m),
      windDirection: Number(entry.current?.wind_direction_10m),
      time: entry.current?.time ?? "",
    })).filter((p) =>
      Number.isFinite(p.pressure) &&
      Number.isFinite(p.windSpeed) &&
      Number.isFinite(p.windDirection)
    );

    if (points.length < grid.points.length * 0.8) {
      throw new Error("有効な格子データが十分に取得できませんでした。");
    }

    const payload = {
      fetchedAt: new Date().toISOString(),
      lats: grid.lats,
      lons: grid.lons,
      points,
      dataTime: points[0]?.time ?? "",
    };
    savePressureCache(payload);
    renderPressureWindMap(payload);
    status.textContent = `表示時点：${payload.dataTime.replace("T", " ")}（JST）`;
  } catch (err) {
    console.error(err);
    const cached = loadPressureCache();
    if (cached) {
      renderPressureWindMap(cached);
      status.textContent = `最新取得に失敗したため保存データを表示：${err.message}`;
    } else {
      status.textContent = `取得に失敗しました：${err.message}`;
    }
  } finally {
    button.disabled = false;
  }
}

function renderPressureWindMap(payload) {
  const wrap = $("pressureMapWrap");
  const canvas = $("pressureMapCanvas");
  wrap.hidden = false;

  const cssWidth = Math.max(300, wrap.clientWidth || 900);
  const cssHeight = Math.max(310, Math.min(650, cssWidth * 0.78));
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  canvas.width = Math.round(cssWidth * dpr);
  canvas.height = Math.round(cssHeight * dpr);

  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const margin = { left: 42, right: 20, top: 20, bottom: 34 };
  const left = margin.left;
  const right = cssWidth - margin.right;
  const top = margin.top;
  const bottom = cssHeight - margin.bottom;

  const lonMin = PRESSURE_MAP_CONFIG.longitudeMin;
  const lonMax = PRESSURE_MAP_CONFIG.longitudeMax;
  const latMin = PRESSURE_MAP_CONFIG.latitudeMin;
  const latMax = PRESSURE_MAP_CONFIG.latitudeMax;

  const xForLon = (lon) => left + (lon - lonMin) / (lonMax - lonMin) * (right - left);
  const yForLat = (lat) => bottom - (lat - latMin) / (latMax - latMin) * (bottom - top);

  // 海
  ctx.fillStyle = "#eef8ff";
  ctx.fillRect(0, 0, cssWidth, cssHeight);
  ctx.fillStyle = "#f8fbfd";
  ctx.fillRect(left, top, right - left, bottom - top);

  // 緯度経度グリッド
  ctx.strokeStyle = "rgba(90,120,145,0.14)";
  ctx.lineWidth = 1;
  ctx.font = "11px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  ctx.fillStyle = "#718096";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (let lon = 125; lon <= 150; lon += 5) {
    const x = xForLon(lon);
    ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke();
    ctx.fillText(`${lon}°E`, x, bottom + 7);
  }
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let lat = 30; lat <= 45; lat += 5) {
    const y = yForLat(lat);
    ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke();
    ctx.fillText(`${lat}°N`, left - 6, y);
  }

  // 簡易海岸線
  ctx.strokeStyle = "rgba(55,73,83,0.70)";
  ctx.fillStyle = "rgba(223,232,221,0.55)";
  ctx.lineWidth = 1.2;
  for (const poly of PRESSURE_COASTLINES) {
    ctx.beginPath();
    poly.forEach(([lon, lat], i) => {
      const x = xForLon(lon);
      const y = yForLat(lat);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  // 格子値テーブル
  const valueMap = new Map(payload.points.map((p) => [`${p.lat}|${p.lon}`, p]));
  const lats = payload.lats;
  const lons = payload.lons;
  const pressures = payload.points.map((p) => p.pressure).filter(Number.isFinite);
  const pMin = Math.min(...pressures);
  const pMax = Math.max(...pressures);

  // 4hPa間隔の等圧線
  const firstLevel = Math.ceil(pMin / 4) * 4;
  const lastLevel = Math.floor(pMax / 4) * 4;

  ctx.strokeStyle = "rgba(95,78,72,0.78)";
  ctx.lineWidth = 1.25;
  ctx.font = "bold 10px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  for (let level = firstLevel; level <= lastLevel; level += 4) {
    let labelPlaced = false;

    for (let i = 0; i < lats.length - 1; i++) {
      for (let j = 0; j < lons.length - 1; j++) {
        const lat0 = lats[i], lat1 = lats[i + 1];
        const lon0 = lons[j], lon1 = lons[j + 1];

        const q00 = valueMap.get(`${lat0}|${lon0}`)?.pressure;
        const q10 = valueMap.get(`${lat0}|${lon1}`)?.pressure;
        const q11 = valueMap.get(`${lat1}|${lon1}`)?.pressure;
        const q01 = valueMap.get(`${lat1}|${lon0}`)?.pressure;
        if (![q00,q10,q11,q01].every(Number.isFinite)) continue;

        const intersections = [];
        const edge = (aLon, aLat, aVal, bLon, bLat, bVal) => {
          if ((level < Math.min(aVal,bVal)) || (level > Math.max(aVal,bVal)) || aVal === bVal) return;
          const t = (level - aVal) / (bVal - aVal);
          if (t < 0 || t > 1) return;
          intersections.push([
            aLon + (bLon - aLon) * t,
            aLat + (bLat - aLat) * t
          ]);
        };

        edge(lon0, lat0, q00, lon1, lat0, q10);
        edge(lon1, lat0, q10, lon1, lat1, q11);
        edge(lon1, lat1, q11, lon0, lat1, q01);
        edge(lon0, lat1, q01, lon0, lat0, q00);

        if (intersections.length === 2 || intersections.length === 4) {
          const pairs = intersections.length === 2
            ? [[intersections[0], intersections[1]]]
            : [[intersections[0], intersections[1]], [intersections[2], intersections[3]]];

          for (const [a,b] of pairs) {
            const ax = xForLon(a[0]), ay = yForLat(a[1]);
            const bx = xForLon(b[0]), by = yForLat(b[1]);
            ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();

            if (!labelPlaced) {
              const mx = (ax + bx) / 2, my = (ay + by) / 2;
              if (mx > left + 35 && mx < right - 35 && my > top + 18 && my < bottom - 18) {
                const label = `${level}`;
                const w = ctx.measureText(label).width + 7;
                ctx.fillStyle = "rgba(248,251,253,0.82)";
                ctx.fillRect(mx - w/2, my - 7, w, 14);
                ctx.fillStyle = "#65534f";
                ctx.fillText(label, mx, my);
                labelPlaced = true;
              }
            }
          }
        }
      }
    }
  }

  // 風向・風速矢印。Open-Meteoの風向は「吹いてくる方角」なので180°反転して進行方向を描く。
  for (const p of payload.points) {
    const x = xForLon(p.lon);
    const y = yForLat(p.lat);
    if (x < left || x > right || y < top || y > bottom) continue;

    const toDeg = (p.windDirection + 180) % 360;
    const rad = toDeg * Math.PI / 180;
    const length = 7 + Math.min(Math.max(p.windSpeed, 0), 60) / 60 * 11;
    const dx = Math.sin(rad) * length;
    const dy = -Math.cos(rad) * length;

    const x2 = x + dx;
    const y2 = y + dy;

    ctx.strokeStyle = "rgba(32,104,122,0.76)";
    ctx.fillStyle = "rgba(32,104,122,0.82)";
    ctx.lineWidth = 1.15;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x2, y2); ctx.stroke();

    const head = 3.2;
    const angle = Math.atan2(y2-y, x2-x);
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - head*Math.cos(angle-Math.PI/6), y2 - head*Math.sin(angle-Math.PI/6));
    ctx.lineTo(x2 - head*Math.cos(angle+Math.PI/6), y2 - head*Math.sin(angle+Math.PI/6));
    ctx.closePath();
    ctx.fill();
  }

  // ラベル
  ctx.fillStyle = "#374151";
  ctx.font = "bold 12px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(`等圧線：4 hPa間隔（${firstLevel}～${lastLevel} hPa）`, left + 6, top + 5);
}

$("pressureButton").addEventListener("click", fetchPressureWind);


$("refreshButton").addEventListener("click", () => fetchWeather({ manual: true }));
$("csvButton").addEventListener("click", downloadCsv);

renderRainLegend();
initializeData();
