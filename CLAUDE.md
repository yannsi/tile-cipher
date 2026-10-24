# タイル暗号 — 作業メモ

個人の趣味のアプリ。介護ツール（yannsi/kaigo-tools）とは別物なので、混ぜない。

- 公開: GitHub Pages（`.github/workflows/pages.yml`、main に送るとテスト→ `public/` を公開）
- 説明や画面の文言はすべて日本語。日本語フォントは BIZ UDPゴシック
- 形式は `public/core.js` と `tools/tile_cipher.py` で同じに保つ。どちらかを変えたら両方直し、相互に読めるか確かめる
- アプリを変えたら `public/sw.js` の `CACHE` の番号と `public/app.js` の `VERSION` を上げる
- 公開前に `node --test tests/core.test.js` を通す
