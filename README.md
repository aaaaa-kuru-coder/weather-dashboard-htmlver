# Weather Dashboard v4

GitHub Pages などの静的ホスティング上で、ブラウザの JavaScript から Open-Meteo API を直接呼び出して描画する天気ダッシュボードです。Python や GitHub Actions は表示時には不要です。

## ファイル構成

- `index.html` : ページ本体
- `styles.css` : PC / スマホ向けレイアウト
- `app.js` : Open-Meteo 取得、キャッシュ、Chart.js 描画
- `assets/` : favicon / ホーム画面用アイコン

## v4 の主な仕様

- 0時・12時・23時の縦罫線を通常より少し濃く表示
- 0℃・10℃・20℃・30℃の横罫線を通常より少し濃く表示
- スマホでも24時間全体を横スクロールなしで表示
- 軸タイトルはプロット上部の左右に配置し、描画領域の横幅を確保
- グラフ系列の凡例はグラフ下部へ移動
- 「今日の天気予報」横の重複した更新時刻表示を廃止
- 最終データ取得表示は次のルール
  - 取得から3分未満: `たった今`
  - 3分以上1時間未満: `○分前`
  - 1時間以上: 日本時間の実日時
- キャッシュが3時間以内なら API を再取得せず、ブラウザの `localStorage` から即表示
- キャッシュが3時間以上なら、先にキャッシュを描画してから Open-Meteo を再取得
- 「最新データを取得」ボタンはキャッシュ年齢に関係なく強制更新
- 現在時刻の縦線を1分ごとに再描画
- 18時以降は翌日0〜18時の予報を同じ0〜18時位置へ重ねて表示

## GitHub Pages

リポジトリの公開対象ディレクトリへ、このフォルダ内のファイルをそのまま配置してください。

例:

```text
/
├─ index.html
├─ app.js
├─ styles.css
└─ assets/
   ├─ favicon.png
   ├─ apple-touch-icon.png
   ├─ weather-icon-192.png
   └─ weather-icon-512.png
```

Chart.js は jsDelivr CDN から読み込みます。

## ローカルで確認

ブラウザの `file://` 直開きではなく、簡易HTTPサーバー経由を推奨します。

```bash
python -m http.server 8000
```

その後、ブラウザで次を開きます。

```text
http://localhost:8000/
```

## 地点の変更

`app.js` 冒頭の `CONFIG` を編集します。

```javascript
const CONFIG = {
  latitude: 35.68,
  longitude: 139.77,
  timezone: "Asia/Tokyo",
  ...
};
```

## キャッシュについて

キャッシュは各端末・各ブラウザの `localStorage` に保存されます。GitHub リポジトリへデータを書き戻す処理はありません。

そのため、スマホとPCではそれぞれ別のキャッシュを持ちます。
