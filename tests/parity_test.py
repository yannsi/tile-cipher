"""アプリ（core.js）と Python 版（tools/tile_cipher.py）が同じ形式かを確かめる。
  - 夜景・白黒の絵は、1画素も違わない同じ絵になること
  - 4色の図形タイルは、お互いに作った画像を読めること
実行: python3 tests/parity_test.py（node が必要）"""
import json, os, subprocess, sys, tempfile
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))
import tile_cipher as tc

CASES = [("tile", "今日もおつかれさま", ""), ("night", "今夜も街は静かです", "k"),
         ("tile-bw", "白黒でも読めます", ""), ("night-bw", "キノコの夜", "sock")]
PY_ENCODE = {"tile": tc.encode, "night": tc.encode_night, "tile-bw": tc.encode_tile_bw,
             "night-bw": lambda t, k: tc.encode_night(t, k, bw=True)}

tmp = tempfile.mkdtemp()
js = f"""
globalThis.Encoding = require({json.dumps(os.path.join(ROOT, "public", "encoding.min.js"))});
const TC = require({json.dumps(os.path.join(ROOT, "public", "core.js"))});
const fs = require("fs");
const cases = {json.dumps(CASES)};
for (const [st, t, k] of cases) fs.writeFileSync({json.dumps(tmp)} + "/" + st + ".idx", Buffer.from(TC.encode(t, k, st)));
// Python が作った画像を JS で読む
const out = {{}};
for (const [st, t, k] of cases) {{
  const b = fs.readFileSync({json.dumps(tmp)} + "/py_" + st + ".rgb");
  const r = TC.decode({{ w: 400, h: 300, data: new Uint8Array(b) }}, k);
  out[st] = r ? r.text : null;
}}
fs.writeFileSync({json.dumps(tmp)} + "/js_read.json", JSON.stringify(out));
"""
pal = np.array(tc.COLORS, dtype=np.uint8)
for st, t, k in CASES:
    open(f"{tmp}/py_{st}.rgb", "wb").write(np.array(PY_ENCODE[st](t, k).convert("RGB")).tobytes())
subprocess.run(["node", "-e", js], check=True)
js_read = json.load(open(f"{tmp}/js_read.json"))

failed = False
for st, t, k in CASES:
    jsidx = np.frombuffer(open(f"{tmp}/{st}.idx", "rb").read(), np.uint8).reshape(300, 400)
    py = np.array(PY_ENCODE[st](t, k).convert("RGB"))
    pyidx = np.full((300, 400), 9, np.uint8)
    for i, c in enumerate(tc.COLORS):
        pyidx[(py == c).all(-1)] = i
    diff = int((jsidx != pyidx).sum())
    py_reads_js = tc.decode(Image.fromarray(pal[jsidx]), k)
    ok = (diff == 0 or st == "tile") and py_reads_js == t and js_read[st] == t
    failed |= not ok
    print(f"{'OK' if ok else 'NG'}  {st:9s} 違う画素 {diff:6d}  Pythonが読む: {py_reads_js}  JSが読む: {js_read[st]}")
sys.exit(1 if failed else 0)
