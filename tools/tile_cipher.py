#!/usr/bin/env python3
"""タイル暗号 v2 — 文字を4色の図形タイル（8x6=48マス）に変換し、画像や写真から元に戻す。

  書き込み:  python3 tile_cipher.py encode "メッセージ" -o secret.png [-k 合言葉]
  読み取り:  python3 tile_cipher.py decode secret.png [-k 合言葉]
             （電子ペーパーをスマホで撮った写真もそのまま渡せます）

必要なもの:  Python3, Pillow, OpenCV, NumPy
  Arch Linux:  sudo pacman -S python-pillow python-opencv python-numpy

仕組み
  - 1マス = 64通り（背景4色 × 図形の色3色 × 図形6種のうち64個）= 6ビット
  - 48マス × 6ビット = 36バイト
      先頭1バイト: 長さ(下位7ビット) + 文字コード(最上位ビット: 0=Shift_JIS, 1=UTF-8)
      本文: 最大33バイト（日本語なら約16文字）
      末尾2バイト: チェック用の値
  - 本文は合言葉から作った乱数列とXORして、見た目をでたらめにする
    （遊び用。本格的な暗号の強さはありません）
  - 外周の黒枠で写真の中の位置を見つけ、下の赤・黄の色見本で向きと色合いを合わせる
"""
import argparse, hashlib, sys
import numpy as np
from PIL import Image, ImageDraw

# ---------------- 画面レイアウト（400x300） ----------------
W, H = 400, 300
COLS, ROWS, T = 8, 6, 42
GX, GY = 32, 16                       # タイル群の左上
BORDER = (4, 4, 395, 295)             # 外周の黒枠（外側の線）
BORDER_W = 7
PATCH_R = (32, 274, 80, 284)          # 色見本（赤）
PATCH_Y = (88, 274, 136, 284)         # 色見本（黄）

K, WH, R, Y = (0, 0, 0), (255, 255, 255), (255, 0, 0), (255, 255, 0)
COLORS = [K, WH, R, Y]
SHAPES = ["circle", "quarter", "half", "triangle", "stripes", "dots"]
CAP = COLS * ROWS * 6 // 8            # 36バイト
CHECK = 2
MAX_PAYLOAD = CAP - 1 - CHECK         # 33バイト

SYMBOLS = [(bg, fg, sh) for sh in SHAPES for bg in COLORS for fg in COLORS if fg != bg][:64]

INSET = 5                             # 読み取り時に無視するタイル縁の幅
GRID_N = 12                           # タイル内を何x何マスに分けて比べるか


# ---------------- 描画 ----------------
def draw_tile(sym, t=T):
    bg, fg, shape = sym
    tile = Image.new("RGB", (t, t), bg)
    d = ImageDraw.Draw(tile)
    u = t / 50
    if shape == "circle":
        d.ellipse((9 * u, 9 * u, t - 10 * u, t - 10 * u), fill=fg)
    elif shape == "quarter":
        d.ellipse((-t, -t, t - 4 * u, t - 4 * u), fill=fg)
    elif shape == "half":
        d.pieslice((2 * u, t / 2 - 2 * u, t - 3 * u, t * 1.5 - 3 * u), 180, 360, fill=fg)
    elif shape == "triangle":
        d.polygon([(0, t), (t, t), (t, 0)], fill=fg)
    elif shape == "stripes":
        x = 4 * u
        while x < t:
            d.rectangle((x, 0, x + 6 * u, t), fill=fg)
            x += 14 * u
    elif shape == "dots":
        for cx in (14 * u, 36 * u):
            for cy in (14 * u, 36 * u):
                d.ellipse((cx - 7 * u, cy - 7 * u, cx + 7 * u, cy + 7 * u), fill=fg)
    return tile


def keystream(key, n):
    out, i = b"", 0
    while len(out) < n:
        out += hashlib.sha256(f"{key}:{i}".encode()).digest()
        i += 1
    return out[:n]


def check_bytes(data):
    return hashlib.sha256(b"tile-cipher" + data).digest()[:CHECK]


def pack(text, key):
    for flag, enc in ((0, "cp932"), (1, "utf-8")):
        try:
            body = text.encode(enc)
            break
        except UnicodeEncodeError:
            continue
    if len(body) > MAX_PAYLOAD:
        raise SystemExit(f"長すぎます（{len(body)}バイト / 最大{MAX_PAYLOAD}バイト。日本語なら約16文字まで）")
    raw = bytes([len(body) | (flag << 7)]) + body
    raw += check_bytes(raw)
    raw += bytes(CAP - len(raw))
    return bytes(a ^ b for a, b in zip(raw, keystream(key, CAP)))


def to_symbols(data):
    bits = "".join(f"{b:08b}" for b in data)
    return [int(bits[i:i + 6], 2) for i in range(0, len(bits), 6)]


def from_symbols(vals):
    bits = "".join(f"{v:06b}" for v in vals)
    return bytes(int(bits[i:i + 8], 2) for i in range(0, len(bits), 8))


def unpack(raw_xored, key):
    raw = bytes(a ^ b for a, b in zip(raw_xored, keystream(key, CAP)))
    n, flag = raw[0] & 0x7F, raw[0] >> 7
    if n > MAX_PAYLOAD or raw[1 + n:1 + n + CHECK] != check_bytes(raw[:1 + n]):
        return None
    try:
        return raw[1:1 + n].decode("utf-8" if flag else "cp932")
    except UnicodeDecodeError:
        return None


def encode(text, key):
    vals = to_symbols(pack(text, key))
    im = Image.new("RGB", (W, H), WH)
    d = ImageDraw.Draw(im)
    d.rectangle(BORDER, outline=K, width=BORDER_W)
    for i, v in enumerate(vals):
        im.paste(draw_tile(SYMBOLS[v]), (GX + (i % COLS) * T, GY + (i // COLS) * T))
    for c in range(COLS + 1):
        d.line((GX + c * T, GY, GX + c * T, GY + ROWS * T), fill=K, width=2)
    for r in range(ROWS + 1):
        d.line((GX, GY + r * T, GX + COLS * T, GY + r * T), fill=K, width=2)
    d.rectangle(PATCH_R, fill=R)
    d.rectangle(PATCH_Y, fill=Y)
    return im


# ---------------- 読み取り ----------------
def cell_means(arr):
    """タイル画像(RGB配列)を GRID_N x GRID_N に分け、各マスの平均色を返す"""
    h, w, _ = arr.shape
    out = np.zeros((GRID_N, GRID_N, 3))
    for j in range(GRID_N):
        for i in range(GRID_N):
            ys, ye = int(j * h / GRID_N), int((j + 1) * h / GRID_N)
            xs, xe = int(i * w / GRID_N), int((i + 1) * w / GRID_N)
            out[j, i] = arr[ys:ye, xs:xe].reshape(-1, 3).mean(axis=0)
    return out


def classify(means, palette):
    """各マスの色を、4色の見本のうち一番近いものの番号(0-3)にする"""
    p = np.array(palette, dtype=float)
    dist = ((means[..., None, :] - p[None, None, :, :]) ** 2).sum(-1)
    return dist.argmin(-1)


TEMPLATE_LABELS = []
for _s in SYMBOLS:
    big = np.asarray(draw_tile(_s, T * 4), dtype=float)
    inset = INSET * 4
    TEMPLATE_LABELS.append(classify(cell_means(big[inset:-inset, inset:-inset]), COLORS))
TEMPLATE_LABELS = np.stack(TEMPLATE_LABELS)  # (64, N, N)


def read_layout(arr, scale):
    """まっすぐに補正済みの画像（400x300の scale 倍）からタイルを読む"""
    s = scale

    def med(box):
        x0, y0, x1, y1 = box
        return np.median(arr[int(y0 * s):int(y1 * s), int(x0 * s):int(x1 * s)].reshape(-1, 3), axis=0)

    palette = [
        med((40, BORDER[1] + 1, 360, BORDER[1] + BORDER_W - 1)),   # 黒（上の枠）
        med((14, 40, 28, 260)),                                    # 白（左の余白）
        med((PATCH_R[0] + 3, PATCH_R[1] + 2, PATCH_R[2] - 3, PATCH_R[3] - 2)),
        med((PATCH_Y[0] + 3, PATCH_Y[1] + 2, PATCH_Y[2] - 3, PATCH_Y[3] - 2)),
    ]
    # 4色が互いに十分ちがわなければ、向きや位置がずれている
    pal = np.array(palette)
    if min(np.linalg.norm(pal[a] - pal[b]) for a in range(4) for b in range(a + 1, 4)) < 40:
        return None
    vals = []
    for idx in range(COLS * ROWS):
        x0 = (GX + (idx % COLS) * T + INSET) * s
        y0 = (GY + (idx // COLS) * T + INSET) * s
        sz = (T - 2 * INSET) * s
        tile = arr[int(y0):int(y0 + sz), int(x0):int(x0 + sz)]
        labels = classify(cell_means(tile), palette)
        mism = (TEMPLATE_LABELS != labels[None]).sum(axis=(1, 2))
        vals.append(int(mism.argmin()))
    return from_symbols(vals)


def order_corners(pts):
    pts = np.array(pts, dtype=np.float32).reshape(4, 2)
    c = pts.mean(axis=0)
    ang = np.arctan2(pts[:, 1] - c[1], pts[:, 0] - c[0])
    pts = pts[np.argsort(ang)]              # 画像座標で時計回り
    start = np.argmin(pts.sum(axis=1))      # 左上に近い点から
    return np.roll(pts, -start, axis=0)     # 左上, 右上, 右下, 左下


def find_quads(img):
    import cv2
    gray = cv2.cvtColor(img, cv2.COLOR_RGB2GRAY)
    cands = []
    for block in (31, 61, 121):
        th = cv2.adaptiveThreshold(cv2.GaussianBlur(gray, (5, 5), 0), 255,
                                   cv2.ADAPTIVE_THRESH_MEAN_C, cv2.THRESH_BINARY_INV, block, 8)
        th = cv2.morphologyEx(th, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
        contours, _ = cv2.findContours(th, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
        for cnt in contours:
            area = cv2.contourArea(cnt)
            if area < img.shape[0] * img.shape[1] * 0.02:
                continue
            peri = cv2.arcLength(cnt, True)
            approx = cv2.approxPolyDP(cnt, 0.02 * peri, True)
            if len(approx) == 4 and cv2.isContourConvex(approx):
                cands.append((area, order_corners(approx)))
    cands.sort(key=lambda a: -a[0])
    return [q for _, q in cands]


def decode_photo(im, key, debug=None):
    import cv2
    img = np.asarray(im.convert("RGB"))
    if max(img.shape[:2]) > 1600:
        f = 1600 / max(img.shape[:2])
        img = cv2.resize(img, None, fx=f, fy=f, interpolation=cv2.INTER_AREA)
    s = 3
    dst = np.array([[BORDER[0], BORDER[1]], [BORDER[2] + 1, BORDER[1]],
                    [BORDER[2] + 1, BORDER[3] + 1], [BORDER[0], BORDER[3] + 1]], dtype=np.float32) * s
    for quad in find_quads(img)[:12]:
        for rot in range(4):                 # 4通りの向きを試す
            src = np.roll(quad, rot, axis=0)
            M = cv2.getPerspectiveTransform(src, dst)
            warped = cv2.warpPerspective(img, M, (W * s, H * s)).astype(float)
            raw = read_layout(warped, s)
            if raw is None:
                continue
            text = unpack(raw, key)
            if text is not None:
                if debug:
                    Image.fromarray(warped.astype(np.uint8)).save(debug)
                return text
    return None


def decode(im, key, debug=None):
    # 生成した画像そのもの（400x300）ならそのまま読む
    if im.size == (W, H):
        raw = read_layout(np.asarray(im.convert("RGB"), dtype=float), 1)
        if raw is not None:
            text = unpack(raw, key)
            if text is not None:
                return text
    return decode_photo(im, key, debug)


def main():
    ap = argparse.ArgumentParser(description="タイル暗号")
    sub = ap.add_subparsers(dest="cmd", required=True)
    e = sub.add_parser("encode", help="文字から暗号画像を作る")
    e.add_argument("text"); e.add_argument("-o", "--out", default="secret.png"); e.add_argument("-k", "--key", default="")
    dd = sub.add_parser("decode", help="画像や写真から文字に戻す")
    dd.add_argument("image"); dd.add_argument("-k", "--key", default="")
    dd.add_argument("--debug", help="補正後の画像をこのファイル名で保存する")
    a = ap.parse_args()
    if a.cmd == "encode":
        encode(a.text, a.key).save(a.out)
        print(f"保存しました: {a.out}")
    else:
        from PIL import ImageOps
        im = ImageOps.exif_transpose(Image.open(a.image))   # スマホ写真の回転情報を反映
        text = decode(im, a.key, a.debug)
        if text is None:
            sys.exit("読み取れませんでした（合言葉が違う・枠が写っていない・ピンぼけ などを確認してください）")
        print(text)


if __name__ == "__main__":
    main()
