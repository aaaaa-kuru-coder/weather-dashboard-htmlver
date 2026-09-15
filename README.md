# Weather Pages JS v2

添付の新しいPython版の表示仕様を、GitHub Pagesで動かせるHTML/JavaScript版へ移植したサンプルです。

## ファイル

- `index.html` : 画面本体
- `app.js` : Open-Meteo API取得、データ加工、Chart.js描画
- `styles.css` : 画面レイアウトと装飾

## 主な仕様

- Open-MeteoのForecast APIをブラウザから直接取得
- `past_days=2`, `forecast_days=2`
- `temperature_2m`, `precipitation_probability`, `weather_code`, `precipitation` を取得
- 一昨日・昨日・今日の気温を描画
- 今日の気温は現在時刻以前を実線、以後を点線
- 今日の降水確率を青線で表示
- 降水確率10%以上の時刻に、降水量別の色付き四角マーカーを表示
- WMO 95/96/99 は雷マーク表示
- 18時未満: 今日の最高・最低気温と最大降水確率を注記
- 18時以降: 翌日0～18時を同じ0～18時位置に重ね、翌日分の最高・最低気温と最大降水確率のみ注記
- ボタンで最新データを再取得
- 取得データをCSVとしてローカル保存可能

## GitHub Pagesで使う

この3ファイルをPages公開対象のディレクトリに置いてください。

```text
repository/
├─ index.html
├─ app.js
└─ styles.css
```

GitHubの `Settings > Pages` で公開元を設定すれば、そのまま静的サイトとして動きます。

## ローカルで使う

同じディレクトリで次を実行するのが確実です。

```bash
python -m http.server 8000
```

その後、ブラウザで以下を開きます。

```text
http://localhost:8000/
```

`index.html` のダブルクリック（file://）でも動く場合がありますが、ブラウザのセキュリティ設定やCDN/APIアクセスの制約を避けるため、ローカルHTTPサーバー経由を推奨します。

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
};
```

## 補足

この版はGitHub ActionsやPythonを使わず、閲覧者のブラウザからOpen-Meteoへ直接アクセスします。そのため「最新データを取得」ボタンを押すと、その場で再取得して表示が更新されます。リポジトリ内のCSV等を書き換えるものではありません。
