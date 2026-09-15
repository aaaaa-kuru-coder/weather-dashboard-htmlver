"use strict";

const CONFIG = {
  latitude: 35.68,
  longitude: 139.77,
  timezone: "Asia/Tokyo",
  apiBase: "https://api.open-meteo.com/v1/forecast",
  pastDays: 2,
  forecastDays: 2,
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

let weatherChart = null;
let latestRows = [];
let latestFetchedAt = null;

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
    hour12: false,
  }).formatToParts(now);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return {
    dateKey: `${map.year}-${map.month}-${map.day}`,
    hour: Number(map.hour),
    minute: Number(map.minute),
    mmdd: `${map.month}/${map.day}`,
    hhmm: `${map.hour}:${map.minute}`,
    display: `${map.year}年${map.month}月${map.day}日 ${map.hour}:${map.minute}`,
  };
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

  const datasets = [
    {
      label: "一昨日 気温",
      yAxisID: "yTemp",
      data: pointRows(dayBefore, "temperature_2m_c"),
      borderColor: "#f6c89f",
      backgroundColor: "#f6c89f",
      borderWidth: 2.3,
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
      borderWidth: 2.7,
      pointRadius: 0,
      tension: 0.2,
      order: 5,
    },
    {
      label: "今日 気温",
      yAxisID: "yTemp",
      data: pointRows(today, "temperature_2m_c", (r) => r.hour <= nowJst.hour),
      borderColor: "#d62728",
      backgroundColor: "#d62728",
      borderWidth: 3.1,
      pointRadius: 0,
      tension: 0.2,
      order: 3,
    },
    {
      label: "今日 気温（予報）",
      yAxisID: "yTemp",
      data: pointRows(today, "temperature_2m_c", (r) => r.hour >= nowJst.hour),
      borderColor: "#d62728",
      backgroundColor: "#d62728",
      borderWidth: 3.1,
      borderDash: [9, 6],
      pointRadius: 0,
      tension: 0.2,
      order: 3,
    },
    {
      label: "今日 降水確率",
      yAxisID: "yPop",
      data: pointRows(today, "precipitation_probability_percent"),
      borderColor: "#1f77b4",
      backgroundColor: "#1f77b4",
      borderWidth: 2.7,
      pointRadius: 2.4,
      pointHoverRadius: 5,
      tension: 0.15,
      order: 4,
    },
    {
      label: "今日 降水量マーカー",
      yAxisID: "yPop",
      showLine: false,
      data: pointRows(today, "precipitation_probability_percent", (r) => r.precipitation_probability_percent >= 10),
      pointStyle: "rect",
      pointRadius: 8.0,
      pointHoverRadius: 9.5,
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
        borderWidth: 2.8,
        borderDash: [9, 6],
        pointRadius: 0,
        tension: 0.2,
        order: 4,
      },
      {
        label: "翌日 降水確率（0～18時）",
        yAxisID: "yPop",
        data: pointRows(tomorrow, "precipitation_probability_percent"),
        borderColor: "rgba(31, 119, 180, 0.58)",
        backgroundColor: "rgba(31, 119, 180, 0.58)",
        borderWidth: 2.5,
        borderDash: [2, 5],
        pointRadius: 2.1,
        pointHoverRadius: 5,
        tension: 0.15,
        order: 4,
      },
      {
        label: "翌日 降水量マーカー",
        yAxisID: "yPop",
        showLine: false,
        data: pointRows(tomorrow, "precipitation_probability_percent", (r) => r.precipitation_probability_percent >= 10),
        pointStyle: "rect",
        pointRadius: 8.0,
        pointHoverRadius: 9.5,
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
  for (const row of today) if (row.precipitation_probability_percent >= 10 && row.has_thunder) thunderRows.push({ row, alpha: 1 });
  if (showTomorrow) for (const row of tomorrow) if (row.precipitation_probability_percent >= 10 && row.has_thunder) thunderRows.push({ row, alpha: 0.7 });

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
  afterDatasetsDraw(chart, args, pluginOptions) {
    const { ctx, scales } = chart;
    const annotations = pluginOptions.annotations ?? [];
    const thunderRows = pluginOptions.thunderRows ?? [];

    ctx.save();

    for (const ann of annotations) {
      const x = scales.x.getPixelForValue(ann.row.hour);
      const yValue = ann.axis === "yTemp" ? ann.row.temperature_2m_c : ann.row.precipitation_probability_percent;
      const y = scales[ann.axis].getPixelForValue(yValue);
      const ty = y + ann.offsetY;

      ctx.strokeStyle = ann.color;
      ctx.globalAlpha = 0.65;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, ty + (ann.offsetY < 0 ? 8 : -8));
      ctx.stroke();

      ctx.globalAlpha = 1;
      ctx.fillStyle = ann.color;
      ctx.beginPath();
      ctx.arc(x, y, 4.2, 0, Math.PI * 2);
      ctx.fill();

      ctx.font = "bold 18px -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans JP', sans-serif";
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
      ctx.font = "bold 22px 'DejaVu Sans', 'Segoe UI Symbol', sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText("↯", x, y - 11);
    }

    ctx.restore();
  },
};

Chart.register(overlayPlugin);

function tooltipLabel(context) {
  const raw = context.raw;
  const row = raw?.row;
  if (!row) return `${context.dataset.label}: ${context.formattedValue}`;
  if (context.dataset.yAxisID === "yTemp") return `${context.dataset.label}: ${row.temperature_2m_c.toFixed(1)}℃`;
  if (context.dataset.label.includes("降水量マーカー")) {
    return `降水量: ${row.precipitation_mm.toFixed(1)}mm/h / 降水確率 ${Math.round(row.precipitation_probability_percent)}% / ${row.weather_ja}`;
  }
  return `${context.dataset.label}: ${Math.round(row.precipitation_probability_percent)}%`;
}

function renderChart(rows, fetchedAt) {
  const nowJst = getJstParts(fetchedAt);
  const { datasets, annotations, thunderRows, showTomorrow } = buildDatasets(rows, nowJst);

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
      layout: { padding: { top: 44, right: 10, bottom: 4, left: 4 } },
      plugins: {
        weatherOverlay: { annotations, thunderRows },
        legend: {
          position: "top",
          align: "start",
          labels: {
            font: { size: 13 },
            boxWidth: 34,
            filter: (item, data) => !data.datasets[item.datasetIndex]._hideFromLegend,
          },
        },
        tooltip: {
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
            font: { size: 13 },
            callback: (v) => `${v}:00`,
          },
          title: { display: true, text: "時刻", font: { size: 15 } },
        },
        yTemp: {
          position: "left",
          grid: { color: "rgba(0,0,0,0.12)" },
          ticks: { font: { size: 13 } },
          title: { display: true, text: "気温（℃）", font: { size: 15 } },
        },
        yPop: {
          position: "right",
          min: 0,
          max: 105,
          grid: { drawOnChartArea: false },
          ticks: { stepSize: 20, font: { size: 13 }, callback: (v) => `${v}%` },
          title: { display: true, text: "降水確率（%）", font: { size: 15 } },
        },
      },
    },
  });

  $("tomorrowNote").hidden = !showTomorrow;
  $("chartUpdatedAt").textContent = `（${nowJst.mmdd} ${nowJst.hhmm} 更新）`;
  $("updatedAt").textContent = `最終更新：${nowJst.display}`;
}

function renderRainLegend() {
  const parent = $("rainLegend");
  parent.innerHTML = "";
  for (const bin of RAIN_COLOR_BINS) {
    const item = document.createElement("span");
    item.className = "rain-legend-item";
    item.innerHTML = `<span class="rain-swatch" style="background:${bin.color}"></span><span>${bin.label}</span>`;
    parent.appendChild(item);
  }
  const thunder = document.createElement("span");
  thunder.className = "rain-legend-item";
  thunder.innerHTML = `<span class="thunder-swatch">↯</span><span>雷予報</span>`;
  parent.appendChild(thunder);
}

async function fetchWeather() {
  $("refreshButton").disabled = true;
  $("status").className = "status";
  $("status").textContent = "Open-Meteoから最新データを取得しています...";

  try {
    const response = await fetch(buildApiUrl(), { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
    const data = await response.json();
    latestRows = normalizeWeather(data);
    latestFetchedAt = new Date();
    renderChart(latestRows, latestFetchedAt);
    $("csvButton").disabled = false;
    $("status").className = "status ok";
    $("status").textContent = "最新データを取得しました。";
  } catch (err) {
    console.error(err);
    $("status").className = "status error";
    $("status").textContent = `取得に失敗しました：${err.message}`;
  } finally {
    $("refreshButton").disabled = false;
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
    "temperature_2m_c", "precipitation_probability_percent", "precipitation_mm",
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

$("refreshButton").addEventListener("click", fetchWeather);
$("csvButton").addEventListener("click", downloadCsv);

renderRainLegend();
fetchWeather();
