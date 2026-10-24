"""電子ペーパーをスマホで撮った写真を再現するテスト用スクリプト。
色のくすみ・本体の白い縁・斜め・回転・明るさのムラ・ぼけ・ノイズ・JPEG圧縮を加える。"""
import sys, random
import numpy as np, cv2
from PIL import Image

# 実物の電子ペーパーっぽい、くすんだ4色
EPAPER = {(0, 0, 0): (45, 42, 48), (255, 255, 255): (205, 203, 192),
          (255, 0, 0): (165, 38, 40), (255, 255, 0): (214, 182, 46)}


def simulate(src, out, seed, rot90=0, tilt=0.12, blur=1.6, noise=6, quality=80):
    rnd = random.Random(seed)
    im = np.asarray(Image.open(src).convert("RGB")).copy()
    for k, v in EPAPER.items():
        im[(im == k).all(-1)] = v
    big = cv2.resize(im, (800, 600), interpolation=cv2.INTER_NEAREST)
    # 本体の白い縁（ベゼル）
    dev = np.full((760, 960, 3), (238, 238, 234), np.uint8)
    dev[80:680, 80:880] = big
    H, W = 1500, 2000
    cw, ch = dev.shape[1], dev.shape[0]
    src_pts = np.float32([[0, 0], [cw, 0], [cw, ch], [0, ch]])
    cx, cy, sc = W / 2, H / 2, 1.3
    base = np.float32([[-cw / 2, -ch / 2], [cw / 2, -ch / 2], [cw / 2, ch / 2], [-cw / 2, ch / 2]]) * sc
    jit = np.float32([[rnd.uniform(-1, 1), rnd.uniform(-1, 1)] for _ in range(4)]) * tilt * cw
    ang = np.radians(rnd.uniform(-15, 15))
    Rm = np.float32([[np.cos(ang), -np.sin(ang)], [np.sin(ang), np.cos(ang)]])
    dst_pts = (base + jit) @ Rm.T + np.float32([cx, cy])
    M = cv2.getPerspectiveTransform(src_pts, dst_pts)
    bg = np.full((H, W, 3), (110, 95, 80), np.uint8)       # 木の机っぽい背景
    photo = cv2.warpPerspective(dev, M, (W, H), dst=bg, borderMode=cv2.BORDER_TRANSPARENT)
    # 明るさのムラ（左上から光）
    yy, xx = np.mgrid[0:H, 0:W]
    grad = 0.8 + 0.3 * (1 - (xx / W + yy / H) / 2)
    photo = np.clip(photo * grad[..., None], 0, 255)
    photo = cv2.GaussianBlur(photo, (0, 0), blur)
    photo = np.clip(photo + np.random.default_rng(seed).normal(0, noise, photo.shape), 0, 255).astype(np.uint8)
    photo = np.rot90(photo, rot90).copy()
    Image.fromarray(photo).save(out, quality=quality)


if __name__ == "__main__":
    simulate(sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4]) if len(sys.argv) > 4 else 0)
