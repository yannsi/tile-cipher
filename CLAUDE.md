# タイル暗号 — 作業メモ

個人の趣味のアプリ。介護ツール（yannsi/kaigo-tools）とは別物なので、混ぜない。

- 公開: GitHub Pages（`.github/workflows/pages.yml`、main に送るとテスト→ `public/` を公開）
- 説明や画面の文言はすべて日本語。日本語フォントは BIZ UDPゴシック
- 形式は `public/core.js` と `tools/tile_cipher.py` で同じに保つ。どちらかを変えたら両方直し、相互に読めるか確かめる
- アプリを変えたら `public/sw.js` の `CACHE` の番号と `public/app.js` の `VERSION` を上げる
- 公開前に `node --test tests/core.test.js` と `python3 tests/parity_test.py` を通す
- 絵の種類は4つ: tile / night / tile-bw / night-bw（core.js の LAYOUTS と tile_cipher.py の read_any）
- 読み取り: `decode(img, key, { thorough })`。写真は true（候補を全部試す）、カメラは false（速さ優先）。黒枠の角は `refineQuad` で辺に直線を当てはめて求め直している
- 読めた文字は `plausible` で制御文字・外字をはじく（JS と Python で同じ判定）
