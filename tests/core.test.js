// 暗号の作成 → 読み取りが正しく往復するかを確かめる（node --test tests/core.test.js）
const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const crypto = require("node:crypto");

globalThis.Encoding = require(path.join(__dirname, "..", "public", "encoding.min.js"));
const TC = require(path.join(__dirname, "..", "public", "core.js"));

// 4点対応の射影変換（src の点 → dst の点）
function homography(src, dst) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i], [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  for (let c = 0; c < 8; c++) {
    let p = c; for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]];
    for (let r = 0; r < 8; r++) if (r !== c) { const f = A[r][c] / A[c][c]; for (let k = c; k < 8; k++) A[r][k] -= f * A[c][k]; b[r] -= f * b[c]; }
  }
  return [...b.map((v, i) => v / A[i][i]), 1];
}

function toRGB(idx) {
  const rgb = new Uint8Array(TC.W * TC.H * 3);
  for (let i = 0; i < idx.length; i++) rgb.set(TC.PAL[idx[i]], i * 3);
  return { w: TC.W, h: TC.H, data: rgb };
}

test("SHA-256 が標準の結果と一致する", () => {
  for (const s of ["", "abc", "x".repeat(200), "合言葉:3"]) {
    const mine = Buffer.from(TC.sha256(new TextEncoder().encode(s))).toString("hex");
    assert.strictEqual(mine, crypto.createHash("sha256").update(s).digest("hex"));
  }
});

test("作った画像から同じ言葉が読める", () => {
  const cases = [["今日もおつかれさま", ""], ["キノコは旗を目指している", "sock"], ["①②～髙﨑", "k"], ["Hello 👋", ""], ["", ""]];
  for (const [text, key] of cases) {
    const r = TC.decode(toRGB(TC.encode(text, key)), key);
    assert.ok(r, `読めなかった: ${text}`);
    assert.strictEqual(r.text, text);
  }
});

test("合言葉が違うと読めない", () => {
  const img = toRGB(TC.encode("ひみつ", "right"));
  assert.strictEqual(TC.decode(img, "wrong"), null);
});

test("画像は黒・白・赤・黄の4色だけでできている", () => {
  const idx = TC.encode("色のテスト", "");
  assert.ok(idx.every((c) => c >= 0 && c <= 3));
  assert.strictEqual(idx.length, TC.W * TC.H);
});

test("長すぎる言葉は断る", () => {
  assert.throws(() => TC.encode("あいうえおかきくけこさしすせそたち", ""), /長すぎます/);
});

test("写真のように斜め・くすみ・ぼけがあっても読める", () => {
  // 400x300 の画像を、白い縁付きで斜めに置き、色をくすませた 900x700 の「写真」を作る
  const src = toRGB(TC.encode("斜めでも読める", "photo"));
  const dull = { 0: [45, 42, 48], 1: [205, 203, 192], 2: [165, 38, 40], 3: [214, 182, 46] };
  const W = 900, H = 700, out = new Uint8Array(W * H * 3).fill(110);
  const corners = [[150, 120], [760, 90], [800, 600], [120, 560]]; // 左上・右上・右下・左下（白い縁の外側）
  const bez = 30; // 白い縁の幅（元画像の座標で）
  const sw = TC.W + 2 * bez, sh = TC.H + 2 * bez;
  // 写真の四隅 → 元画像（白い縁込み）の四隅 への射影変換を作る
  const Hm = homography(corners, [[0, 0], [sw, 0], [sw, sh], [0, sh]]);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const d = Hm[6] * x + Hm[7] * y + 1;
    const u = (Hm[0] * x + Hm[1] * y + Hm[2]) / d, v = (Hm[3] * x + Hm[4] * y + Hm[5]) / d;
    if (u < 0 || u >= sw || v < 0 || v >= sh) continue;
    const sx = Math.floor(u) - bez, sy = Math.floor(v) - bez;
    let c = [238, 238, 234];
    if (sx >= 0 && sy >= 0 && sx < TC.W && sy < TC.H) {
      const o = (sy * TC.W + sx) * 3;
      const k = TC.PAL.findIndex((p) => p[0] === src.data[o] && p[1] === src.data[o + 1] && p[2] === src.data[o + 2]);
      c = dull[k];
    }
    out.set(c, (y * W + x) * 3);
  }
  // 軽くぼかす
  const blur = new Uint8Array(out.length);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) for (let k = 0; k < 3; k++) {
    let s = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += out[((y + dy) * W + x + dx) * 3 + k];
    blur[(y * W + x) * 3 + k] = s / 9;
  }
  const r = TC.decode({ w: W, h: H, data: blur }, "photo");
  assert.ok(r, "写真から読めなかった");
  assert.strictEqual(r.text, "斜めでも読める");
});
