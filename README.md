# Weather Pages JS v3 — PC / Smartphone optimized

Open-Meteoをブラウザから直接呼び出し、Chart.jsで描画するGitHub Pages向けの天気ダッシュボードです。PWAではありません。

## ファイル

- `index.html` : 画面本体
- `app.js` : Open-Meteo API取得、3時間キャッシュ、データ加工、Chart.js描画
- `styles.css` : PC / スマホ向けレスポンシブ表示
- `assets/favicon.png` : ブラウザ用アイコン
- `assets/apple-touch-icon.png` : iPhone / iPadホーム画面ショートカット用
- `assets/weather-icon-192.png`, `weather-icon-512.png` : 天気アイコン

## v3の変更点

### 1. 🌤 アイコン
晴れ＋雲をモチーフにしたアイコンを追加しています。

`index.html` では次を設定しています。

```html
<link rel="icon" type="image/png" sizes="64x64" href="assets/favicon.png">
<link rel="apple-touch-icon" sizes="180x180" href="assets/apple-touch-icon.png">
```

### 2. スマホでグラフの縦横比を維持
PCでは画面幅に合わせて表示します。

スマートフォンではグラフ本体を約760×432pxの比率で維持し、画面に入りきらない横幅は横スクロールで閲覧します。これにより、狭い画面へ無理に押し込んでグラフが縦長になるのを防ぎます。

左右の軸タイトル「気温（℃）」「降水確率（%）」はChart.jsの縦書き軸タイトルを使わず、目盛り上部へ移しています。

### 3. 系列凡例を線表示
Chart.js既定の四角い凡例を非表示にし、HTML/CSSで線状の凡例を表示します。

### 4. 現在時刻線
現在の日本時間を示す、青みがかった灰色の縦破線を表示します。ページを開いたままでも1分ごとに描き直します。

### 5. 3時間キャッシュ
Open-Meteoから取得したデータをブラウザの `localStorage` に保存します。

動作は次の通りです。

- 保存データなし → API取得
- 最終取得から3時間未満 → 保存データを即表示し、APIを呼ばない
- 3時間以上経過 → 保存データをまず即表示し、その後バックグラウンドでAPI取得
- 「最新データを取得」ボタン → 経過時間に関係なくAPI取得
- API取得に失敗 → 保存データがあればそのまま表示

キャッシュはGitHub側ではなく、各端末・各ブラウザごとに保存されます。

## GitHub Pagesで使う

以下をPages公開対象のディレクトリへそのまま配置してください。

```text
repository/
├─ index.html
├─ app.js
├─ styles.css
└─ assets/
   ├─ favicon.png
   ├─ apple-touch-icon.png
   ├─ weather-icon-192.png
   └─ weather-icon-512.png
```

## ローカルで使う

フォルダ内で次を実行します。

```bash
python -m http.server 8000
```

その後、ブラウザで開きます。

```text
http://localhost:8000/
```

GitHub PagesとローカルHTTPサーバーで同じファイルを利用できます。

## 地点を変更する

`app.js` 冒頭の `CONFIG` を変更してください。

```javascript
const CONFIG = {
  latitude: 35.68,
  longitude: 139.77,
  timezone: "Asia/Tokyo",
  apiBase: "https://api.open-meteo.com/v1/forecast",
  pastDays: 2,
  forecastDays: 2,
  cacheKey: "weatherDashboardCacheV3",
  cacheMaxAgeMs: 3 * 60 * 60 * 1000,
};
```

## キャッシュを削除したい場合

ブラウザのサイトデータを削除するか、DevToolsのConsoleで以下を実行します。

```javascript
localStorage.removeItem("weatherDashboardCacheV3")
```
