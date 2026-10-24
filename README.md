# タイル暗号

言葉を4色の図形タイル（8×6＝48マス）や夜景の窓の明かりに隠した画像を作り、Santek EZ Sign 4.2インチ4色版に表示して、
スマホのカメラで読み取るアプリです。iPhone・Android の両方で、ホーム画面に置いて使えます。

公開先: https://yannsi.github.io/tile-cipher/

## スマホでの使い方

### ホーム画面に追加

- **iPhone**：Safari で開く → 下の共有ボタン（□に↑）→「ホーム画面に追加」
- **Android**：Chrome で開く → 画面の「ホーム画面に追加」ボタン、またはメニュー →「アプリをインストール」

一度開けば、電波がなくても動きます。

### 作る

1. 絵の種類（図形タイル／夜景）と色（4色／白黒）を選び、隠す言葉と合言葉（なしでもOK）を入れる
   - 色は持っている電子ペーパーに合わせます。白黒は2色版のEZ Signや白黒の印刷でも使えます
2. 「画像を保存する」
   - iPhone：共有メニュー →「画像を保存」で写真アプリへ
   - Android：共有先（フォトなど）を選ぶ
3. EZ Sign のアプリで画像を選び、スマホを電子ペーパーにかざす（4色版は25秒、2色版は3秒ほど）

### 読む

- 「カメラで読む」→ 電子ペーパーを点線の枠に合わせると、自動で読み取って止まります
- 「写真から読む」→ 撮っておいた写真を選びます
- 合言葉付きで作った画像は、先に合言葉を入れておきます
- 図形タイルか夜景か、4色か白黒かは、自動で見分けます

## フォルダの中身

```
public/                 公開されるアプリ本体
  index.html            画面
  app.js                画面の動き（作る・読む・カメラ・保存・ホーム画面に追加）
  core.js               暗号の計算と写真の補正
  worker.js             読み取りを裏で動かす（カメラ映像がカクつかないように）
  encoding.min.js       Shift_JIS 変換（encoding-japanese 2.0.0, MIT）
  sw.js                 オフラインで開けるようにする仕組み
  manifest.webmanifest  ホーム画面用の設定
  icons/                アイコン
tools/
  tile_cipher.py        パソコン用（Python）。アプリと同じ形式
  sim_photo.py          写真の読み取りを試すため、斜め・くすみ・ぼけた写真を作る
tests/
  core.test.js          作成→読み取りの往復テスト（公開の前に自動で実行）
  parity_test.py        アプリと Python 版が同じ形式か確かめる（公開の前に自動で実行）
.github/workflows/pages.yml   main に送るとテスト→公開
```

## 更新のしかた

1. `public/` の中を直す
2. `public/sw.js` の `CACHE = "tile-cipher-v1"` の番号を上げ（v2, v3…）、`public/app.js` の `VERSION` も合わせる
   （上げないと、ホーム画面のアプリが古いファイルを使い続けることがあります）
3. main に送ると、テストが通れば数分で公開されます

手元で試すとき:

```bash
node --test tests/core.test.js
cd public && python3 -m http.server 8000   # http://localhost:8000 で開く
```

## パソコン（Python）で使う

```bash
sudo pacman -S python-pillow python-opencv python-numpy
python3 tools/tile_cipher.py encode "伝えたい言葉" -o secret.png -k 合言葉
python3 tools/tile_cipher.py encode "伝えたい言葉" -o night.png --style night      # 夜景
python3 tools/tile_cipher.py encode "伝えたい言葉" -o bw.png --style tile-bw       # 白黒の図形タイル（night-bw で白黒の夜景）
python3 tools/tile_cipher.py decode 撮った写真.jpg -k 合言葉
```

## 形式

| 項目 | 内容 |
|---|---|
| 画像 | 400×300、黒・白・赤・黄の4色。外周に黒枠、下に赤と黄の色見本 |
| 図形タイル | 8×6＝48マス、1マス6ビット（背景4色×図形の色3色×図形6種のうち64通り）。36バイト（長さ1＋本文最大33＋チェック2） |
| 夜景 | ビル6棟・窓107個、1つの窓で2ビット（消灯・白・赤・黄）。26バイト（長さ1＋本文最大23＋チェック2） |
| 白黒の図形タイル | 図形32種類（向き違いを含む）で1マス5ビット。30バイト（本文最大27）。色見本がないぶん、タイルを上下の真ん中に置く |
| 白黒の夜景 | 窓が「消灯・全部点灯・左半分・右半分」の4通りで1窓2ビット。26バイト（本文最大23） |
| 文字コード | Shift_JIS（入らない文字があれば UTF-8 に自動で切り替え） |
| 合言葉 | SHA-256 で作った乱数と XOR（遊び用。本格的な暗号の強さはありません） |

アプリと Python 版はまったく同じ形式なので、どちらで作った画像もどちらでも読めます（夜景と白黒は1画素も違わない同じ絵になります）。
