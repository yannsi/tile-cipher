// タイル暗号 v2 — 計算部分（DOMを使わない純粋な関数だけ。ブラウザとNodeの両方で動く）
(function (root) {
  "use strict";
  const W = 400, H = 300, COLS = 8, ROWS = 6, T = 42, GX = 32, GY = 16;
  const BORDER = [4, 4, 395, 295], BW = 7;
  const PATCH_R = [32, 274, 80, 284], PATCH_Y = [88, 274, 136, 284];
  const PAL = [[0, 0, 0], [255, 255, 255], [255, 0, 0], [255, 255, 0]];
  const SHAPES = ["circle", "quarter", "half", "triangle", "stripes", "dots"];
  const CAP = 36, CHECK = 2, INSET = 5, GN = 12;

  const SYMBOLS = [];
  for (const sh of SHAPES) for (let bg = 0; bg < 4; bg++) for (let fg = 0; fg < 4; fg++) if (fg !== bg) SYMBOLS.push([bg, fg, sh]);
  SYMBOLS.length = 64;

  // ---------- SHA-256 ----------
  const K256 = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
  function sha256(msg) {
    const len = msg.length, bitLen = len * 8;
    const padLen = ((len + 9 + 63) >> 6) << 6;
    const buf = new Uint8Array(padLen);
    buf.set(msg); buf[len] = 0x80;
    const dv = new DataView(buf.buffer);
    dv.setUint32(padLen - 4, bitLen >>> 0); dv.setUint32(padLen - 8, Math.floor(bitLen / 2 ** 32));
    const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    const w = new Uint32Array(64);
    const rotr = (x, n) => (x >>> n) | (x << (32 - n));
    for (let off = 0; off < padLen; off += 64) {
      for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
      for (let i = 16; i < 64; i++) {
        const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
        const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      }
      let [a, b, c, d, e, f, g, hh] = h;
      for (let i = 0; i < 64; i++) {
        const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        const ch = (e & f) ^ (~e & g);
        const t1 = (hh + S1 + ch + K256[i] + w[i]) >>> 0;
        const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        const mj = (a & b) ^ (a & c) ^ (b & c);
        const t2 = (S0 + mj) >>> 0;
        hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
    }
    const out = new Uint8Array(32);
    const odv = new DataView(out.buffer);
    for (let i = 0; i < 8; i++) odv.setUint32(i * 4, h[i]);
    return out;
  }

  const utf8 = (s) => new TextEncoder().encode(s);
  function concat(...arrs) {
    const n = arrs.reduce((a, b) => a + b.length, 0), out = new Uint8Array(n);
    let o = 0; for (const a of arrs) { out.set(a, o); o += a.length; }
    return out;
  }
  function keystream(key, n) {
    const parts = []; let got = 0, i = 0;
    while (got < n) { const d = sha256(utf8(`${key}:${i}`)); parts.push(d); got += d.length; i++; }
    return concat(...parts).slice(0, n);
  }
  const checkBytes = (data, prefix) => sha256(concat(utf8(prefix), data)).slice(0, CHECK);

  // ---------- 文字コード（Shift_JIS 優先、無理なら UTF-8） ----------
  function encodeBody(text) {
    const E = root.Encoding;
    if (E) {
      const codes = E.convert(E.stringToCode(text), { to: "SJIS", from: "UNICODE" });
      const back = E.codeToString(E.convert(codes, { to: "UNICODE", from: "SJIS" }));
      if (back === text) return { flag: 0, body: Uint8Array.from(codes) };
    }
    return { flag: 1, body: utf8(text) };
  }
  // 人が入力する文字だけでできているか（偶然チェックをすり抜けた、でたらめな並びをはじく）
  function plausible(text) {
    for (const ch of text) {
      const c = ch.codePointAt(0);
      if ((c < 0x20 && c !== 0x0a && c !== 0x09) || (c >= 0x7f && c <= 0x9f)) return false;   // 制御文字
      if ((c >= 0xe000 && c <= 0xf8ff) || c >= 0xf0000 || c === 0xfffd) return false;         // 外字・置き換え文字
    }
    return true;
  }
  function decodeBody(bytes, flag) {
    let text;
    if (flag) text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    else {
      const E = root.Encoding;
      if (E) {
        text = E.codeToString(E.convert(Array.from(bytes), { to: "UNICODE", from: "SJIS" }));
        // Shift_JIS として正しい並びなら、文字に戻してもう一度変換すると元と同じになる
        const back = E.convert(E.stringToCode(text), { to: "SJIS", from: "UNICODE" });
        if (back.length !== bytes.length || back.some((b, i) => b !== bytes[i])) throw new Error("not sjis");
      } else text = new TextDecoder("shift_jis", { fatal: true }).decode(bytes);
    }
    if (!plausible(text)) throw new Error("implausible");
    return text;
  }
  function byteLength(text) { return encodeBody(text).body.length; }

  // ---------- 詰める・取り出す（絵の種類ごとに容量とチェック用の目印が違う） ----------
  function pack(text, key, cap, prefix) {
    const { flag, body } = encodeBody(text);
    const maxp = cap - 1 - CHECK;
    if (body.length > maxp) throw new Error(`長すぎます（${body.length}バイト / 最大${maxp}バイト）`);
    const head = concat(Uint8Array.of(body.length | (flag << 7)), body);
    const raw = new Uint8Array(cap);
    raw.set(concat(head, checkBytes(head, prefix)));
    const ks = keystream(key, cap);
    return raw.map((b, i) => b ^ ks[i]);
  }
  // strict=true は読み直し用: 空き部分（0のはず）もほぼ0であることを求めて、取り違えを防ぐ
  function unpack(xored, key, cap, prefix, strict = false) {
    const ks = keystream(key, cap);
    const raw = xored.map((b, i) => b ^ ks[i]);
    const n = raw[0] & 0x7f, flag = raw[0] >> 7;
    if (n > cap - 1 - CHECK) return null;
    const chk = checkBytes(raw.slice(0, 1 + n), prefix);
    for (let i = 0; i < CHECK; i++) if (raw[1 + n + i] !== chk[i]) return null;
    if (strict) {
      let ones = 0, bits = 0;
      for (let i = 1 + n + CHECK; i < cap; i++) { bits += 8; for (let v = raw[i]; v; v >>= 1) ones += v & 1; }
      if (ones > bits / 10) return null;
    }
    try { return decodeBody(raw.slice(1, 1 + n), flag); } catch (e) { return null; }
  }
  function toVals(bytes, bitsPer, count) {
    let bits = ""; for (const b of bytes) bits += b.toString(2).padStart(8, "0");
    bits = bits.padEnd(bitsPer * count, "0");
    const out = []; for (let i = 0; i < count; i++) out.push(parseInt(bits.slice(i * bitsPer, (i + 1) * bitsPer), 2));
    return out;
  }
  function fromVals(vals, bitsPer, cap) {
    let bits = ""; for (const v of vals) bits += v.toString(2).padStart(bitsPer, "0");
    const out = new Uint8Array(cap);
    for (let i = 0; i < cap; i++) out[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
    return out;
  }

  // ---------- 図形（座標で判定するので、4色以外の色が混ざらない） ----------
  function inEll(px, py, x0, y0, x1, y1) {
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = (x1 - x0) / 2, ry = (y1 - y0) / 2;
    const dx = (px - cx) / rx, dy = (py - cy) / ry;
    return dx * dx + dy * dy <= 1;
  }
  function shapeHit(sh, px, py, t, r = 0) {
    for (let i = 0; i < r; i++) [px, py] = [py, t - px];   // 90度ずつ回す
    const u = t / 50;
    switch (sh) {
      case "ring": return inEll(px, py, 6 * u, 6 * u, t - 6 * u, t - 6 * u) && !inEll(px, py, 17 * u, 17 * u, t - 17 * u, t - 17 * u);
      case "square": return px >= 15 * u && px <= t - 15 * u && py >= 15 * u && py <= t - 15 * u;
      case "checker": return (px < t / 2) === (py < t / 2);
      case "bar": return py >= 18 * u && py <= t - 18 * u;
      case "circle": return inEll(px, py, 9 * u, 9 * u, t - 10 * u, t - 10 * u);
      case "quarter": return inEll(px, py, -t, -t, t - 4 * u, t - 4 * u);
      case "half": { const y0 = t / 2 - 2 * u, y1 = t * 1.5 - 3 * u; return py <= (y0 + y1) / 2 && inEll(px, py, 2 * u, y0, t - 3 * u, y1); }
      case "triangle": return px + py >= t;
      case "stripes": { if (px < 4 * u) return false; return (px - 4 * u) % (14 * u) <= 6 * u + 0.5 * t / T; }
      case "dots": {
        for (const cx of [14 * u, 36 * u]) for (const cy of [14 * u, 36 * u]) {
          const dx = px - cx, dy = py - cy; if (dx * dx + dy * dy <= 49 * u * u) return true;
        }
        return false;
      }
    }
    return false;
  }
  const tileColor = (sym, px, py, t) => (shapeHit(sym[2], px, py, t, sym[3] || 0) ? sym[1] : sym[0]);

  // 白黒用の32種類: [背景, 図形の色, 図形, 向き]。見分けやすいものだけを選んである
  const BW_SYMBOLS = [[0,1,"circle",0],[1,0,"circle",0],[1,0,"half",0],[0,1,"checker",0],[0,1,"stripes",0],[0,1,"half",0],[1,0,"checker",0],[0,1,"half",3],
    [0,1,"dots",0],[1,0,"stripes",0],[1,0,"stripes",1],[1,0,"dots",0],[0,1,"stripes",1],[1,0,"half",3],[0,1,"ring",0],[1,0,"ring",0],
    [1,0,"quarter",0],[0,1,"quarter",0],[0,1,"bar",0],[0,1,"bar",1],[1,0,"bar",0],[1,0,"bar",1],[1,0,"quarter",1],[1,0,"quarter",2],
    [1,0,"quarter",3],[0,1,"quarter",1],[0,1,"quarter",2],[0,1,"quarter",3],[0,1,"square",0],[1,0,"square",0],[0,1,"triangle",0],[0,1,"triangle",1]];
  const BW_CAP = Math.floor(COLS * ROWS * 5 / 8);   // 30バイト
  const BW_GY = 24;   // 白黒版は色見本がいらないので、タイルを上下の真ん中に置いて上下の余白を広げる
  const inBox = (x, y, b) => x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3];

  // 色番号(0-3)の画像に描くための小さな道具
  function canvasIdx() {
    const idx = new Uint8Array(W * H).fill(1);
    const set = (x, y, c) => { if (x >= 0 && y >= 0 && x < W && y < H) idx[y * W + x] = c; };
    return {
      idx, set,
      rect(x0, y0, x1, y1, c) { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, c); },
      ell(x0, y0, x1, y1, c) {
        for (let y = Math.floor(y0); y <= Math.ceil(y1); y++) for (let x = Math.floor(x0); x <= Math.ceil(x1); x++)
          if (inEll(x + 0.5, y + 0.5, x0, y0, x1 + 1, y1 + 1)) set(x, y, c);
      },
      border() {
        for (let y = BORDER[1]; y <= BORDER[3]; y++) for (let x = BORDER[0]; x <= BORDER[2]; x++)
          if (x < BORDER[0] + BW || x > BORDER[2] - BW || y < BORDER[1] + BW || y > BORDER[3] - BW) set(x, y, 0);
      },
    };
  }

  // ---------- 絵の種類1: 図形タイル（8x6=48マス、1マス6ビット） ----------
  function renderTile(vals, symbols = SYMBOLS, patches = true, gy = GY) {
    const cv = canvasIdx(), idx = cv.idx;
    cv.border();
    const gw = COLS * T, gh = ROWS * T;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const lx = x - GX, ly = y - gy;
      if (lx >= 0 && lx < gw && ly >= 0 && ly < gh) {
        const col = Math.floor(lx / T), row = Math.floor(ly / T);
        let c = tileColor(symbols[vals[row * COLS + col]], lx - col * T + 0.5, ly - row * T + 0.5, T);
        const mx = lx % T, my = ly % T;
        if (mx === 0 || mx === T - 1 || my === 0 || my === T - 1) c = 0;
        idx[y * W + x] = c;
      }
      if (((lx === -1 || lx === gw) && ly >= -1 && ly <= gh) || ((ly === -1 || ly === gh) && lx >= -1 && lx <= gw)) idx[y * W + x] = 0;
    }
    if (patches) { cv.rect(...PATCH_R, 2); cv.rect(...PATCH_Y, 3); }
    return idx;
  }

  function classify(m, pal) {
    let best = 0, bd = Infinity;
    for (let k = 0; k < pal.length; k++) {
      const p = pal[k], d = (m[0] - p[0]) ** 2 + (m[1] - p[1]) ** 2 + (m[2] - p[2]) ** 2;
      if (d < bd) { bd = d; best = k; }
    }
    return best;
  }
  // 見本（64種）の色ラベル。タイル内側を GN x GN に分けて、各マスの平均色で決める
  const makeTemplates = (symbols, pal) => {
    const inner = T - 2 * INSET, SS = 6, out = [];
    for (const sym of symbols) {
      const lab = new Uint8Array(GN * GN);
      for (let j = 0; j < GN; j++) for (let i = 0; i < GN; i++) {
        const m = [0, 0, 0]; let n = 0;
        for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
          const px = INSET + (i + (sx + 0.5) / SS) * inner / GN, py = INSET + (j + (sy + 0.5) / SS) * inner / GN;
          const c = PAL[tileColor(sym, px, py, T)];
          m[0] += c[0]; m[1] += c[1]; m[2] += c[2]; n++;
        }
        lab[j * GN + i] = classify([m[0] / n, m[1] / n, m[2] / n], pal);
      }
      out.push(lab);
    }
    return out;
  };
  const TEMPLATES = makeTemplates(SYMBOLS, PAL);
  const BW_TEMPLATES = makeTemplates(BW_SYMBOLS, PAL.slice(0, 2));
  function readTile(img, s, pal, templates = TEMPLATES, bitsPer = 6, cap = CAP, gy = GY) {
    const { w, data } = img;
    const vals = [], seconds = [], margins = [];
    const size = (T - 2 * INSET) * s;
    const lab = new Uint8Array(GN * GN);
    for (let t = 0; t < COLS * ROWS; t++) {
      const x0 = (GX + (t % COLS) * T + INSET) * s, y0 = (gy + Math.floor(t / COLS) * T + INSET) * s;
      for (let j = 0; j < GN; j++) for (let i = 0; i < GN; i++) {
        const ys = Math.floor(y0 + j * size / GN), ye = Math.floor(y0 + (j + 1) * size / GN);
        const xs = Math.floor(x0 + i * size / GN), xe = Math.floor(x0 + (i + 1) * size / GN);
        const m = [0, 0, 0]; let n = 0;
        for (let y = ys; y < ye; y++) for (let x = xs; x < xe; x++) {
          const o = (y * w + x) * 3; m[0] += data[o]; m[1] += data[o + 1]; m[2] += data[o + 2]; n++;
        }
        lab[j * GN + i] = classify([m[0] / n, m[1] / n, m[2] / n], pal);
      }
      let best = 0, bm = Infinity, second = 0, sm = Infinity;
      for (let k = 0; k < templates.length; k++) {
        const tp = templates[k]; let mm = 0;
        for (let q = 0; q < GN * GN; q++) if (tp[q] !== lab[q]) mm++;
        if (mm < bm) { second = best; sm = bm; bm = mm; best = k; }
        else if (mm < sm) { sm = mm; second = k; }
      }
      vals.push(best); seconds.push(second); margins.push(sm - bm);
    }
    // 読み直し用: 自信のないマスを1つずつ2番目の候補に入れ替えたもの
    const order = margins.map((m, i) => [m, i]).sort((a, b) => a[0] - b[0]).slice(0, 6).map(([, i]) => i);
    const alts = order.map((i) => { const v = vals.slice(); v[i] = seconds[i]; return () => fromVals(v, bitsPer, cap); });
    const out = fromVals(vals, bitsPer, cap);
    out.alts = alts;
    return out;
  }

  // ---------- 絵の種類2: 夜景（ビルの窓の明かり、1つの窓で2ビット） ----------
  const N_SCENE = [20, 20, 379, 259];
  const N_PATCH_R = [26, 268, 70, 280], N_PATCH_Y = [78, 268, 122, 280];
  const N_GROUND = 246, N_WIN = 10, N_PX = 16, N_PY = 18;
  const N_BUILDINGS = [[26, 58, 118], [88, 44, 70], [136, 78, 150], [218, 44, 56], [266, 64, 104], [334, 40, 140]];
  const N_WINDOWS = (() => {
    const out = [];
    for (const [bx, bw, top] of N_BUILDINGS) {
      const cols = Math.floor((bw - 12 + 6) / N_PX);
      const gx = bx + Math.floor((bw - (cols * N_PX - (N_PX - N_WIN))) / 2);
      for (let y = top + 10; y + N_WIN <= N_GROUND - 4; y += N_PY)
        for (let c = 0; c < cols; c++) out.push([gx + c * N_PX, y]);
    }
    return out;
  })();
  const N_CAP = Math.floor(N_WINDOWS.length * 2 / 8);
  // 星の位置を決める簡単な乱数（Python版と同じ並びになる）
  function lcg(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
  // bw=true のとき白黒版: 月・灯り・道の線を白に。窓は 0消灯 1全部点灯 2左半分 3右半分（カーテン）
  function renderNight(states, bw = false) {
    const Y_ = bw ? 1 : 3, R_ = bw ? 1 : 2;
    const cv = canvasIdx();
    cv.border();
    cv.rect(...N_SCENE, 0);
    const rnd = lcg(7);
    for (let i = 0; i < 46; i++) {
      const x = N_SCENE[0] + 4 + Math.floor(rnd() * (N_SCENE[2] - N_SCENE[0] - 8));
      const y = N_SCENE[1] + 4 + Math.floor(rnd() * (150 - N_SCENE[1] - 4));
      const big = rnd() < 0.2;
      if (N_BUILDINGS.some(([bx, bw, top]) => x >= bx - 4 && x <= bx + bw + 4 && y >= top - 6)) continue;
      if (Math.hypot(x - 62, y - 54) < 26) continue;
      if (big) { for (let d = -2; d <= 2; d++) { cv.set(x + d, y, 1); cv.set(x, y + d, 1); } }
      else cv.set(x, y, 1);
    }
    cv.ell(44, 36, 80, 72, Y_); cv.ell(54, 30, 90, 66, 0);           // 三日月
    for (const [bx, bw, top] of N_BUILDINGS) {
      cv.rect(bx, top, bx + bw, N_GROUND, 1); cv.rect(bx + 1, top + 1, bx + bw - 1, N_GROUND - 1, 0);
    }
    cv.rect(240, 38, 240, 56, 1); cv.ell(237, 34, 243, 40, R_);      // アンテナと灯
    cv.rect(110, 58, 110, 70, 1); cv.ell(108, 55, 112, 59, R_);
    cv.rect(N_SCENE[0], N_GROUND, N_SCENE[2], N_GROUND, 1);           // 地面
    for (let x = 40; x < 370; x += 46) cv.rect(x, N_GROUND + 1, x, N_GROUND + 6, 1);
    for (let x = 30; x < 375; x += 20) cv.rect(x, N_GROUND + 7, x + 8, N_GROUND + 7, Y_);
    N_WINDOWS.forEach(([x, y], i) => {
      const st = states[i];
      if (!st) return;
      if (!bw) cv.rect(x, y, x + N_WIN - 1, y + N_WIN - 1, st);
      else if (st === 1) cv.rect(x, y, x + N_WIN - 1, y + N_WIN - 1, 1);
      else if (st === 2) cv.rect(x, y, x + 4, y + N_WIN - 1, 1);
      else cv.rect(x + 5, y, x + N_WIN - 1, y + N_WIN - 1, 1);
    });
    if (!bw) { cv.rect(...N_PATCH_R, 2); cv.rect(...N_PATCH_Y, 3); }
    return cv.idx;
  }
  function readNight(img, s, pal) {
    const { w, data } = img;
    const vals = N_WINDOWS.map(([x, y]) => {
      const m = [0, 0, 0]; let n = 0;
      for (let yy = Math.floor((y + 3) * s); yy < Math.floor((y + N_WIN - 3) * s); yy++)
        for (let xx = Math.floor((x + 3) * s); xx < Math.floor((x + N_WIN - 3) * s); xx++) {
          const o = (yy * w + xx) * 3; m[0] += data[o]; m[1] += data[o + 1]; m[2] += data[o + 2]; n++;
        }
      return classify([m[0] / n, m[1] / n, m[2] / n], pal);
    });
    return fromVals(vals, 2, N_CAP);
  }
  function readNightBW(img, s, pal) {
    const { w, data } = img;
    const half = (x0, x1, y0, y1) => {
      const m = [0, 0, 0]; let n = 0;
      for (let yy = Math.floor(y0 * s); yy < Math.floor(y1 * s); yy++)
        for (let xx = Math.floor(x0 * s); xx < Math.floor(x1 * s); xx++) {
          const o = (yy * w + xx) * 3; m[0] += data[o]; m[1] += data[o + 1]; m[2] += data[o + 2]; n++;
        }
      return classify([m[0] / n, m[1] / n, m[2] / n], pal);
    };
    const vals = N_WINDOWS.map(([x, y]) => {
      const l = half(x + 1, x + 4, y + 2, y + N_WIN - 2), r = half(x + 6, x + 9, y + 2, y + N_WIN - 2);
      return l && r ? 1 : l ? 2 : r ? 3 : 0;
    });
    return fromVals(vals, 2, N_CAP);
  }

  // ---------- 絵の種類の一覧 ----------
  // pal: 色見本を取る場所（黒＝外枠、白＝余白、赤・黄＝下の四角）
  const inner = (b) => [b[0] + 3, b[1] + 2, b[2] - 3, b[3] - 2];
  const LAYOUTS = {
    tile: {
      name: "図形タイル", cap: CAP, prefix: "tile-cipher",
      pal: [[40, BORDER[1] + 1, 360, BORDER[1] + BW - 1], [14, 40, 28, 260], inner(PATCH_R), inner(PATCH_Y)],
      render: (bytes) => renderTile(toVals(bytes, 6, COLS * ROWS)), read: readTile,
    },
    night: {
      name: "夜景", cap: N_CAP, prefix: "tile-cipher-night",
      pal: [[40, BORDER[1] + 1, 360, BORDER[1] + BW - 1], [140, 266, 360, 284], inner(N_PATCH_R), inner(N_PATCH_Y)],
      render: (bytes) => renderNight(toVals(bytes, 2, N_WINDOWS.length)), read: readNight,
    },
    "tile-bw": {
      name: "白黒の図形タイル", cap: BW_CAP, prefix: "tile-cipher-bw",
      pal: [[40, BORDER[1] + 1, 360, BORDER[1] + BW - 1], [14, 40, 28, 260]],
      render: (bytes) => renderTile(toVals(bytes, 5, COLS * ROWS), BW_SYMBOLS, false, BW_GY),
      read: (img, s, pal) => readTile(img, s, pal, BW_TEMPLATES, 5, BW_CAP, BW_GY),
    },
    "night-bw": {
      name: "白黒の夜景", cap: N_CAP, prefix: "tile-cipher-night-bw",
      pal: [[40, BORDER[1] + 1, 360, BORDER[1] + BW - 1], [140, 266, 360, 284]],
      render: (bytes) => renderNight(toVals(bytes, 2, N_WINDOWS.length), true), read: readNightBW,
    },
  };
  const maxPayload = (style = "tile") => LAYOUTS[style].cap - 1 - CHECK;

  function encode(text, key, style = "tile") {
    const L = LAYOUTS[style];
    return L.render(pack(text, key, L.cap, L.prefix));
  }
  function toRGBA(idx) {
    const out = new Uint8ClampedArray(idx.length * 4);
    for (let i = 0; i < idx.length; i++) { const c = PAL[idx[i]]; out[i * 4] = c[0]; out[i * 4 + 1] = c[1]; out[i * 4 + 2] = c[2]; out[i * 4 + 3] = 255; }
    return out;
  }

  // 補正済み画像（400x300 の s 倍）から、どれかの絵の種類として読めるか試す
  function readAny(img, s, key) {
    const { w, data } = img;
    const cache = new Map();
    function med(box) {
      const k = box.join(",");
      if (cache.has(k)) return cache.get(k);
      const x0 = Math.floor(box[0] * s), x1 = Math.floor(box[2] * s), y0 = Math.floor(box[1] * s), y1 = Math.floor(box[3] * s);
      // 600点ほどに間引く。細長い場所は長い方向だけ間引く（端のぼけた所ばかり拾わないように）
      const step = Math.max(1, Math.floor(((x1 - x0) * (y1 - y0)) / 600 / Math.min(x1 - x0, y1 - y0)));
      const sx = x1 - x0 >= y1 - y0 ? step : 1, sy = x1 - x0 >= y1 - y0 ? 1 : step;
      const ch = [[], [], []];
      for (let y = y0; y < y1; y += sy) for (let x = x0; x < x1; x += sx) {
        const o = (y * w + x) * 3; ch[0].push(data[o]); ch[1].push(data[o + 1]); ch[2].push(data[o + 2]);
      }
      const r = ch.map((a) => { const f = Float32Array.from(a).sort(); return f[f.length >> 1]; });
      cache.set(k, r);
      return r;
    }
    for (const [style, L] of Object.entries(LAYOUTS)) {
      const pal = L.pal.map(med);
      if (!distinct(pal)) continue;
      const bytes = L.read(img, s, pal);
      let text = unpack(bytes, key, L.cap, L.prefix);
      for (const alt of bytes.alts || []) { if (text !== null) break; text = unpack(alt(), key, L.cap, L.prefix, true); }
      if (text !== null) return { text, style };
    }
    return null;
  }
  function distinct(pal) {
    const need = pal.length === 2 ? 60 : 40;   // 白黒は白と黒の差がはっきりあるはず
    for (let a = 0; a < pal.length; a++) for (let b = a + 1; b < pal.length; b++)
      if (Math.hypot(pal[a][0] - pal[b][0], pal[a][1] - pal[b][1], pal[a][2] - pal[b][2]) < need) return false;
    return true;
  }

  // 4点対応の射影変換（dst座標 → 写真座標）
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
      for (let r = 0; r < 8; r++) if (r !== c) {
        const f = A[r][c] / A[c][c];
        for (let k = c; k < 8; k++) A[r][k] -= f * A[c][k];
        b[r] -= f * b[c];
      }
    }
    const h = b.map((v, i) => v / A[i][i]);
    return [...h, 1];
  }
  function warp(img, quad, s) {
    const ow = W * s, oh = H * s;
    const dstPts = [[BORDER[0], BORDER[1]], [BORDER[2] + 1, BORDER[1]], [BORDER[2] + 1, BORDER[3] + 1], [BORDER[0], BORDER[3] + 1]].map(([x, y]) => [x * s, y * s]);
    const Hm = homography(dstPts, quad);
    const out = new Float32Array(ow * oh * 3);
    const { w, h, data } = img;
    for (let y = 0; y < oh; y++) for (let x = 0; x < ow; x++) {
      const X = x + 0.5, Y = y + 0.5;
      const d = Hm[6] * X + Hm[7] * Y + 1;
      let sx = (Hm[0] * X + Hm[1] * Y + Hm[2]) / d - 0.5, sy = (Hm[3] * X + Hm[4] * Y + Hm[5]) / d - 0.5;
      if (sx < 0) sx = 0; if (sy < 0) sy = 0; if (sx > w - 1.001) sx = w - 1.001; if (sy > h - 1.001) sy = h - 1.001;
      const x0 = sx | 0, y0 = sy | 0, fx = sx - x0, fy = sy - y0;
      const o00 = (y0 * w + x0) * 3, o10 = o00 + 3, o01 = o00 + w * 3, o11 = o01 + 3, oo = (y * ow + x) * 3;
      for (let k = 0; k < 3; k++)
        out[oo + k] = (data[o00 + k] * (1 - fx) + data[o10 + k] * fx) * (1 - fy) + (data[o01 + k] * (1 - fx) + data[o11 + k] * fx) * fy;
    }
    return { w: ow, h: oh, data: out };
  }

  function convexHull(pts) {
    pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], up = [];
    for (const p of pts) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
    for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
    up.pop(); lo.pop();
    return lo.concat(up);
  }
  const triArea = (a, b, c) => Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2;
  const quadArea = (q) => {  // 靴ひも公式（順番がねじれた四角形は小さく出る）
    let a = 0; for (let i = 0; i < 4; i++) { const p = q[i], r = q[(i + 1) % 4]; a += p[0] * r[1] - r[0] * p[1]; }
    return Math.abs(a) / 2;
  };

  // 凸包の頂点から、面積が最大になる4点を選ぶ（= 黒枠の四隅）
  function maxQuad(hull) {
    const n = hull.length;
    if (n < 4) return null;
    const step = Math.max(1, Math.ceil(n / 48));
    const sub = hull.filter((_, i) => i % step === 0);
    const m = sub.length;
    let best = null, ba = 0;
    for (let i = 0; i < m; i++) for (let j = i + 2; j < m; j++) {
      let k1 = -1, a1 = 0; for (let k = i + 1; k < j; k++) { const a = triArea(sub[i], sub[j], sub[k]); if (a > a1) { a1 = a; k1 = k; } }
      let k2 = -1, a2 = 0; for (let k = j + 1; k < i + m; k++) { const kk = k % m; const a = triArea(sub[i], sub[j], sub[kk]); if (a > a2) { a2 = a; k2 = kk; } }
      if (k1 >= 0 && k2 >= 0 && a1 + a2 > ba) { ba = a1 + a2; best = [sub[i], sub[k1], sub[j], sub[k2]]; }
    }
    if (!best) return null;
    for (let round = 0; round < 3; round++) for (let c = 0; c < 4; c++) {
      for (const p of hull) { const q = best.slice(); q[c] = p; const a = quadArea(q); if (a > ba) { ba = a; best = q; } }
    }
    return { quad: best, area: ba };
  }
  function orderCorners(q) {
    const cx = q.reduce((a, p) => a + p[0], 0) / 4, cy = q.reduce((a, p) => a + p[1], 0) / 4;
    const s = q.slice().sort((a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx));
    let st = 0; for (let i = 1; i < 4; i++) if (s[i][0] + s[i][1] < s[st][0] + s[st][1]) st = i;
    return [0, 1, 2, 3].map((i) => s[(st + i) % 4]);
  }

  function findQuads(img, thorough = true) {
    const { w, h, data } = img;
    const gray = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) gray[i] = 0.299 * data[i * 3] + 0.587 * data[i * 3 + 1] + 0.114 * data[i * 3 + 2];
    const I = new Float64Array((w + 1) * (h + 1));
    for (let y = 0; y < h; y++) { let row = 0; for (let x = 0; x < w; x++) { row += gray[y * w + x]; I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + row; } }
    const scale = Math.max(w, h) / 1600;
    const cands = [];
    // 作業用の配列は1回だけ用意して使い回す（毎回作るとスマホで止まりがちになる）
    const mask = new Uint8Array(w * h), m2 = new Uint8Array(w * h), label = new Int32Array(w * h), stack = new Int32Array(w * h);
    for (const base of [31, 61, 121]) {
      const r = Math.max(3, Math.round(base * scale / 2));
      mask.fill(0); m2.fill(0); label.fill(0);
      for (let y = 0; y < h; y++) {
        const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
        for (let x = 0; x < w; x++) {
          const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
          const sum = I[y1 * (w + 1) + x1] - I[y0 * (w + 1) + x1] - I[y1 * (w + 1) + x0] + I[y0 * (w + 1) + x0];
          if (gray[y * w + x] < sum / ((y1 - y0) * (x1 - x0)) - 8) mask[y * w + x] = 1;
        }
      }
      // 途切れをつなぐ（3x3 で太らせる）
      for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        if (mask[i] || mask[i - 1] || mask[i + 1] || mask[i - w] || mask[i + w] || mask[i - w - 1] || mask[i - w + 1] || mask[i + w - 1] || mask[i + w + 1]) m2[i] = 1;
      }
      // つながった黒い部分ごとに、各行の左端・右端を集める
      let next = 1;
      for (let i0 = 0; i0 < w * h; i0++) {
        if (!m2[i0] || label[i0]) continue;
        const rowMin = new Map(), rowMax = new Map();
        let sp = 0, minX = w, maxX = 0, minY = h, maxY = 0;
        stack[sp++] = i0; label[i0] = next;
        while (sp) {
          const i = stack[--sp], x = i % w, y = (i / w) | 0;
          if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
          const a = rowMin.get(y); if (a === undefined || x < a) rowMin.set(y, x);
          const b = rowMax.get(y); if (b === undefined || x > b) rowMax.set(y, x);
          if (x > 0 && m2[i - 1] && !label[i - 1]) { label[i - 1] = next; stack[sp++] = i - 1; }
          if (x < w - 1 && m2[i + 1] && !label[i + 1]) { label[i + 1] = next; stack[sp++] = i + 1; }
          if (y > 0 && m2[i - w] && !label[i - w]) { label[i - w] = next; stack[sp++] = i - w; }
          if (y < h - 1 && m2[i + w] && !label[i + w]) { label[i + w] = next; stack[sp++] = i + w; }
        }
        next++;
        if ((maxX - minX) * (maxY - minY) < w * h * 0.02) continue;
        const pts = [];
        for (const [y, x] of rowMin) pts.push([x, y]);
        for (const [y, x] of rowMax) pts.push([x + 1, y]);
        const mq = maxQuad(convexHull(pts));
        if (mq && mq.area > w * h * 0.02) cands.push({ area: mq.area, quad: orderCorners(mq.quad) });
      }
    }
    cands.sort((a, b) => b.area - a.area);
    // しきい値を変えて同じ枠を何度も見つけるので、ほぼ同じ四角形をまとめる。
    // まとめた中で「ほかと一番そろっているもの」を先に試し、残りは後回しにする
    // （1つの角だけ少しずれた四角形が混ざることがあり、それを先に試すと無駄になる）
    const groups = [];
    for (const c of cands) {
      const g = groups.find((g) => {
        const k = g[0], side = (Math.hypot(k[1][0] - k[0][0], k[1][1] - k[0][1]) + Math.hypot(k[2][0] - k[1][0], k[2][1] - k[1][1])) / 2;
        return k.every((p, i) => Math.hypot(p[0] - c.quad[i][0], p[1] - c.quad[i][1]) < side * 0.03);
      });
      if (g) g.push(c.quad); else groups.push([c.quad]);
    }
    const first = [], later = [];
    for (const g of groups) {
      const med = [0, 1, 2, 3].map((i) => [0, 1].map((k) => { const v = g.map((q) => q[i][k]).sort((a, b) => a - b); return v[v.length >> 1]; }));
      const dist = (q) => q.reduce((a, p, i) => a + Math.hypot(p[0] - med[i][0], p[1] - med[i][1]), 0);
      const sorted = g.slice().sort((a, b) => dist(a) - dist(b));
      const ref = refineQuad(gray, w, h, sorted[0]);
      if (ref) first.push(ref);
      first.push(sorted[0]); later.push(...sorted.slice(1));
    }
    // thorough=false（カメラの連続読み取り）は各まとまりの代表だけ。1コマを早く終えて次のコマへ
    return thorough ? first.concat(later) : first;
  }

  // 四角形の各辺で、黒枠の外側の境目（暗い→明るいに変わる所）を細かく探し直し、
  // 直線を当てはめて角を求め直す。遠くから撮って枠が細く写ったときに特に効く
  function refineQuad(gray, w, h, quad) {
    const at = (x, y) => {
      if (x < 0 || y < 0 || x >= w - 1 || y >= h - 1) return NaN;
      const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0, i = y0 * w + x0;
      return (gray[i] * (1 - fx) + gray[i + 1] * fx) * (1 - fy) + (gray[i + w] * (1 - fx) + gray[i + w + 1] * fx) * fy;
    };
    const cx = quad.reduce((a, p) => a + p[0], 0) / 4, cy = quad.reduce((a, p) => a + p[1], 0) / 4;
    const lines = [];
    for (let i = 0; i < 4; i++) {
      const a = quad[i], b = quad[(i + 1) % 4];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 20) return null;
      let nx = -(b[1] - a[1]) / len, ny = (b[0] - a[0]) / len;
      const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
      if (nx * (mx - cx) + ny * (my - cy) < 0) { nx = -nx; ny = -ny; }   // 外向きにそろえる
      const reach = Math.max(3, len * 0.025), pts = [];
      for (let k = 1; k < 24; k++) {
        const t = k / 24;
        if (t < 0.08 || t > 0.92) continue;   // 角の近くは使わない
        const px = a[0] + (b[0] - a[0]) * t, py = a[1] + (b[1] - a[1]) * t;
        let best = 0, bd = NaN;
        for (let d = -reach; d <= reach; d += 0.5) {
          const g = at(px + nx * (d + 1), py + ny * (d + 1)) - at(px + nx * (d - 1), py + ny * (d - 1));
          if (g > best) { best = g; bd = d; }
        }
        if (best > 20) pts.push([px + nx * bd, py + ny * bd]);
      }
      if (pts.length < 8) return null;
      let L = fitLine(pts);
      const near = pts.filter((p) => Math.abs((p[0] - L[0]) * L[3] - (p[1] - L[1]) * L[2]) < 1.5);
      if (near.length < 6) return null;
      lines.push(fitLine(near));
    }
    const out = [];
    for (let i = 0; i < 4; i++) {
      const p = intersect(lines[(i + 3) % 4], lines[i]);
      if (!p || Math.hypot(p[0] - quad[i][0], p[1] - quad[i][1]) > 40) return null;
      out.push(p);
    }
    return out;
  }
  // 点の並びに直線を当てはめる（[通る点x, y, 向きx, y]）
  function fitLine(pts) {
    const n = pts.length, mx = pts.reduce((a, p) => a + p[0], 0) / n, my = pts.reduce((a, p) => a + p[1], 0) / n;
    let sxx = 0, sxy = 0, syy = 0;
    for (const [x, y] of pts) { sxx += (x - mx) ** 2; sxy += (x - mx) * (y - my); syy += (y - my) ** 2; }
    const th = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    return [mx, my, Math.cos(th), Math.sin(th)];
  }
  function intersect(L1, L2) {
    const det = L1[2] * L2[3] - L1[3] * L2[2];
    if (Math.abs(det) < 1e-6) return null;
    const t = ((L2[0] - L1[0]) * L2[3] - (L2[1] - L1[1]) * L2[2]) / det;
    return [L1[0] + L1[2] * t, L1[1] + L1[3] * t];
  }

  // 補正前に、色見本の位置だけを少し拾って「どれかの絵の種類として4色が分かれているか」を見る
  function quickCheck(img, quad, s) {
    const dstPts = [[BORDER[0], BORDER[1]], [BORDER[2] + 1, BORDER[1]], [BORDER[2] + 1, BORDER[3] + 1], [BORDER[0], BORDER[3] + 1]].map(([x, y]) => [x * s, y * s]);
    const Hm = homography(dstPts, quad);
    const { w, h, data } = img;
    function sample(box) {
      const ch = [[], [], []];
      for (let j = 0; j < 4; j++) for (let i = 0; i < 6; i++) {
        const X = (box[0] + (box[2] - box[0]) * (i + 0.5) / 6) * s, Y = (box[1] + (box[3] - box[1]) * (j + 0.5) / 4) * s;
        const d = Hm[6] * X + Hm[7] * Y + 1;
        const sx = Math.round((Hm[0] * X + Hm[1] * Y + Hm[2]) / d), sy = Math.round((Hm[3] * X + Hm[4] * Y + Hm[5]) / d);
        if (sx < 0 || sy < 0 || sx >= w || sy >= h) return null;
        const o = (sy * w + sx) * 3; ch[0].push(data[o]); ch[1].push(data[o + 1]); ch[2].push(data[o + 2]);
      }
      return ch.map((a) => { a.sort((p, q) => p - q); return a[a.length >> 1]; });
    }
    // 黒枠の4辺がどれも同じくらい暗いか（違う四角形を拾っていないか）
    const sides = [[40, 5, 360, 9], [40, 290, 360, 294], [5, 40, 9, 260], [390, 40, 394, 260]].map(sample);
    if (sides.some((p) => !p)) return false;
    const lum = (p) => 0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2];
    const ls = sides.map(lum);
    for (const L of Object.values(LAYOUTS)) {
      const pal = L.pal.map((b, i) => sample(i === 0 ? [b[0], b[1] + 1, b[2], b[3] - 1] : b));
      if (!pal.every((p) => p) || !distinct(pal)) continue;
      if (ls.every((l) => l < lum(pal[1]) - 50)) return true;
    }
    return false;
  }

  function rotate180(img) {
    const { w, h, data } = img, out = new Float32Array(data.length), n = w * h;
    for (let i = 0; i < n; i++) { const j = n - 1 - i; out[j * 3] = data[i * 3]; out[j * 3 + 1] = data[i * 3 + 1]; out[j * 3 + 2] = data[i * 3 + 2]; }
    return { w, h, data: out };
  }

  // RGB画像（3ch）から読み取る。成功すると { text, style, warped, scale }、失敗すると null
  // opts.thorough=false はカメラ用（速さ優先）。写真は既定の true で、候補を残らず試す
  function decode(img, key, opts = {}) {
    const thorough = opts.thorough !== false;
    if (img.w === W && img.h === H) {
      const r = readAny(img, 1, key);
      if (r) return { ...r, warped: img, scale: 1 };
    }
    const s = 2;
    const len = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    for (const quad of findQuads(img, thorough).slice(0, 12)) {
      // 長い辺が横になる向きを先に試す。180度違いは補正した画像を回すだけで済ませる
      const wide = len(quad[0], quad[1]) + len(quad[2], quad[3]) >= len(quad[1], quad[2]) + len(quad[3], quad[0]);
      for (const base of wide ? [0, 1] : [1, 0]) {
        const q = [0, 1, 2, 3].map((i) => quad[(i + base) % 4]);
        const q2 = [0, 1, 2, 3].map((i) => quad[(i + base + 2) % 4]);
        const ok1 = quickCheck(img, q, s), ok2 = quickCheck(img, q2, s);
        if (!ok1 && !ok2) continue;
        const warped = warp(img, q, s);
        if (ok1) { const r = readAny(warped, s, key); if (r) return { ...r, warped, scale: s }; }
        if (ok2) { const w2 = rotate180(warped); const r = readAny(w2, s, key); if (r) return { ...r, warped: w2, scale: s }; }
      }
    }
    return null;
  }

  const MAXP = maxPayload("tile");
  const STYLES = Object.fromEntries(Object.entries(LAYOUTS).map(([k, L]) => [k, { name: L.name, maxPayload: maxPayload(k) }]));
  const checkBody = (bytes, flag) => { try { return decodeBody(Uint8Array.from(bytes), flag); } catch (e) { return null; } };
  const api = { checkBody, W, H, PAL, MAXP, STYLES, maxPayload, encode, toRGBA, decode, byteLength, sha256, SYMBOLS, BW_SYMBOLS, N_WINDOWS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.TileCipher = api;
})(typeof window !== "undefined" ? window : globalThis);
