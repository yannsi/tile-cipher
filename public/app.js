(() => {
  "use strict";
  const VERSION = "v1.3";
  const TC = window.TileCipher;
  const $ = (id) => document.getElementById(id);
  $("ver").textContent = VERSION;

  // ---------- タブ ----------
  function showTab(which) {
    const make = which === "make";
    $("tab-make").setAttribute("aria-selected", String(make));
    $("tab-read").setAttribute("aria-selected", String(!make));
    $("panel-make").hidden = !make;
    $("panel-read").hidden = make;
    if (make) stopCamera();
  }
  $("tab-make").addEventListener("click", () => showTab("make"));
  $("tab-read").addEventListener("click", () => showTab("read"));

  // ---------- 入力内容をこの端末に覚えておく ----------
  const store = {
    get(k) { try { return localStorage.getItem("tc:" + k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem("tc:" + k, v); } catch (e) { /* 保存できなくても動く */ } },
  };
  const savedMsg = store.get("msg");
  if (savedMsg !== null) $("msg").value = savedMsg;
  const styleInputs = Array.from(document.querySelectorAll('input[name="style"]'));
  const colorInputs = Array.from(document.querySelectorAll('input[name="color"]'));
  const savedStyle = store.get("style"), savedColor = store.get("color");
  if (savedStyle) styleInputs.forEach((i) => { i.checked = i.value === savedStyle.replace("-bw", ""); });
  if (savedColor) colorInputs.forEach((i) => { i.checked = i.value === savedColor; });
  const picked = (list) => (list.find((i) => i.checked) || list[0]).value;
  const isBW = () => picked(colorInputs) === "bw";
  const currentStyle = () => picked(styleInputs) + (isBW() ? "-bw" : "");

  // ---------- 作る ----------
  const canvas = document.createElement("canvas");
  canvas.width = TC.W; canvas.height = TC.H;
  const ctx = canvas.getContext("2d");
  let currentIdx = null;
  let currentFile = null;   // 共有ボタンを押した瞬間に渡せるよう、先に作っておく

  function fileName() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    return `${currentStyle()}-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.png`;
  }
  function render() {
    const text = $("msg").value;
    const style = currentStyle();
    const max = TC.maxPayload(style);
    const n = TC.byteLength(text);
    $("meter-text").textContent = `${n} / ${max} バイト`;
    $("meter-bar").style.width = Math.min(100, (n / max) * 100) + "%";
    $("cap-hint").textContent = `日本語はだいたい1文字2バイト。${TC.STYLES[style].name}は${Math.floor(max / 2)}文字前後まで入ります。`;
    store.set("style", picked(styleInputs)); store.set("color", picked(colorInputs));
    $("make-device").classList.toggle("is-bw", isBW());
    $("share-note").textContent = `保存した画像をEZ Signのアプリで選び、スマホを電子ペーパーにかざします（${isBW() ? "2色版は3秒" : "4色版は25秒"}ほど）。`;
    const over = n > max;
    $("meter").classList.toggle("over", over);
    $("share").disabled = over || n === 0;
    store.set("msg", text);
    if (over || n === 0) { currentFile = null; return; }
    currentIdx = TC.encode(text, $("key-make").value, style);
    ctx.putImageData(new ImageData(TC.toRGBA(currentIdx), TC.W, TC.H), 0, 0);
    $("code-img").src = canvas.toDataURL("image/png");
    currentFile = null;
    canvas.toBlob((blob) => { if (blob) currentFile = new File([blob], fileName(), { type: "image/png" }); }, "image/png");
  }
  let timer = 0;
  const schedule = () => { clearTimeout(timer); timer = setTimeout(render, 120); };
  $("msg").addEventListener("input", schedule);
  $("key-make").addEventListener("input", schedule);
  styleInputs.concat(colorInputs).forEach((i) => i.addEventListener("change", render));
  render();

  const canShareFiles = (f) => { try { return !!(navigator.canShare && navigator.share && navigator.canShare({ files: [f] })); } catch (e) { return false; } };
  $("share").addEventListener("click", async () => {
    const f = currentFile;
    if (!f) { $("share-note").textContent = "画像を準備中です。もう一度押してください。"; return; }
    if (canShareFiles(f)) {
      // iPhone: 共有メニュー →「画像を保存」で写真アプリへ。Android: 共有先を選ぶ
      try {
        await navigator.share({ files: [f], title: "タイル暗号" });
        $("share-note").textContent = "保存できたら、EZ Signのアプリで画像を選んで電子ペーパーにかざしてください。";
      } catch (e) {
        if (e && e.name === "AbortError") return;
        downloadFallback(f);
      }
    } else {
      downloadFallback(f);
    }
  });
  function downloadFallback(f) {
    const url = URL.createObjectURL(f);
    const a = document.createElement("a");
    a.href = url; a.download = f.name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    $("share-note").textContent = "ダウンロードしました。うまく保存できないときは、上の画像を長押しして保存してください。";
  }

  // ---------- 読み取り（別スレッドで実行） ----------
  // 読み取り役が落ちたり返事をしなかったりしても「読み取り中…」のまま止まらないよう、
  // 待っている仕事を失敗として返し、読み取り役を作り直す
  let worker = null, jobId = 0, busy = false;
  const pending = new Map();
  function failAll() {
    for (const [, p] of pending) { clearTimeout(p.timer); p.resolve({ ok: false, error: true }); }
    pending.clear();
    busy = false;
  }
  function startWorker() {
    worker = new Worker("worker.js");
    worker.onmessage = (ev) => {
      const p = pending.get(ev.data.id);
      pending.delete(ev.data.id);
      busy = false;
      if (p) { clearTimeout(p.timer); p.resolve(ev.data); }
    };
    worker.onerror = (e) => { if (e && e.preventDefault) e.preventDefault(); restartWorker(); };
    worker.onmessageerror = restartWorker;
  }
  function restartWorker() {
    try { worker.terminate(); } catch (e) { /* もう止まっている */ }
    failAll();
    startWorker();
  }
  startWorker();
  function decodeAsync(img, key, thorough = true) {
    return new Promise((resolve) => {
      const id = ++jobId;
      const timer = setTimeout(restartWorker, 30000);   // 30秒たっても返事がなければやり直す
      pending.set(id, { resolve, timer });
      busy = true;
      worker.postMessage({ id, w: img.w, h: img.h, data: img.data, key, thorough }, [img.data.buffer]);
    });
  }

  function showResult(ok, text) {
    $("result").hidden = false;
    $("status").className = "status " + (ok ? "ok" : "ng");
    $("status").textContent = ok ? "読み取れました" : "読み取れませんでした";
    $("decoded").textContent = text;
  }
  function showWarped(w) {
    const c = $("warped"); c.width = w.w; c.height = w.h;
    const rgba = new Uint8ClampedArray(w.w * w.h * 4);
    for (let i = 0, j = 0; i < w.w * w.h; i++, j += 3) { rgba[i * 4] = w.data[j]; rgba[i * 4 + 1] = w.data[j + 1]; rgba[i * 4 + 2] = w.data[j + 2]; rgba[i * 4 + 3] = 255; }
    c.getContext("2d").putImageData(new ImageData(rgba, w.w, w.h), 0, 0);
    $("warped-wrap").hidden = false;
  }
  function success(res) {
    showResult(true, res.text);
    if (res.style && TC.STYLES[res.style]) $("status").textContent = `読み取れました（${TC.STYLES[res.style].name}）`;
    showWarped(res.warped);
    if (navigator.vibrate) navigator.vibrate(60);
  }

  // 画像やカメラの1コマ（の一部 rect=[x, y, 幅, 高さ]）を、長い辺 max px までの RGB データにする
  const grab = document.createElement("canvas");
  const gctx = grab.getContext("2d", { willReadFrequently: true });
  function toRGB(source, sw, sh, max = 1000, rect = [0, 0, sw, sh]) {
    const [rx, ry, rw, rh] = rect.map(Math.round);
    const f = Math.min(1, max / Math.max(rw, rh));
    const w = Math.round(rw * f), h = Math.round(rh * f);
    grab.width = w; grab.height = h;
    gctx.drawImage(source, rx, ry, rw, rh, 0, 0, w, h);
    const d = gctx.getImageData(0, 0, w, h).data;
    const rgb = new Uint8Array(w * h * 3);
    for (let i = 0, j = 0; i < w * h; i++, j += 3) { rgb[j] = d[i * 4]; rgb[j + 1] = d[i * 4 + 1]; rgb[j + 2] = d[i * 4 + 2]; }
    return { w, h, data: rgb };
  }
  // 真ん中の部分（縦横 r の割合）
  const centerRect = ([x, y, w, h], r) => [x + w * (1 - r) / 2, y + h * (1 - r) / 2, w * r, h * r];

  // 写真から
  $("photo").addEventListener("change", async (ev) => {
    const file = ev.target.files && ev.target.files[0];
    ev.target.value = "";
    if (!file) return;
    stopCamera();
    $("result").hidden = false;
    $("status").className = "status"; $("status").textContent = "読み取り中…"; $("decoded").textContent = "";
    $("warped-wrap").hidden = true;
    try {
      const bmp = await createImageBitmap(file);
      const full = [0, 0, bmp.width, bmp.height];
      // まず縮めて速く読む。だめなら細かく、最後は真ん中を切り出して読む（離れて撮った写真のため）
      const steps = [[1000, full], [1600, full], [1600, centerRect(full, 0.6)]];
      let res = { ok: false };
      for (let i = 0; i < steps.length && !res.ok; i++) {
        if (i > 0) $("status").textContent = "もう少し細かく読んでいます…";
        const [max, rect] = steps[i];
        if (i > 0 && Math.max(rect[2], rect[3]) <= steps[i - 1][0] && rect === full) continue;   // 小さい写真は同じことになる
        res = await decodeAsync(toRGB(bmp, bmp.width, bmp.height, max, rect), $("key-read").value);
        if (res.error) break;
      }
      if (bmp.close) bmp.close();
      if (res.ok) success(res);
      else if (res.error) showResult(false, "読み取りの途中で止まってしまいました。もう一度選んでください。");
      else showResult(false, "合言葉が合っているか、黒い枠が全部写っているか、ピントが合っているかを確かめて、もう一度どうぞ。");
    } catch (e) {
      showResult(false, "この画像は開けませんでした。JPEGかPNGの写真で試してください。");
    }
  });

  // いま作った画像で試す
  $("try-current").addEventListener("click", async () => {
    if (!currentIdx) return;
    const rgb = new Uint8Array(TC.W * TC.H * 3);
    for (let i = 0; i < currentIdx.length; i++) rgb.set(TC.PAL[currentIdx[i]], i * 3);
    if (!$("key-read").value && $("key-make").value) $("key-read").value = $("key-make").value;
    $("result").hidden = false;
    $("status").className = "status"; $("status").textContent = "読み取り中…"; $("decoded").textContent = "";
    const res = await decodeAsync({ w: TC.W, h: TC.H, data: rgb }, $("key-read").value);
    if (res.ok) success(res);
    else showResult(false, res.error ? "読み取りの途中で止まってしまいました。もう一度押してください。" : "合言葉が違うようです。");
  });

  // カメラで連続読み取り
  let stream = null, scanning = false, tries = 0;
  async function startCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showResult(false, "このブラウザではカメラが使えません。「写真から読む」を使ってください。");
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      });
    } catch (e) {
      const denied = e && (e.name === "NotAllowedError" || e.name === "SecurityError");
      showResult(false, denied
        ? "カメラの使用が許可されていません。iPhoneは「設定 → Safari → カメラ」、Androidはブラウザのサイト設定で許可してください。"
        : "カメラを起動できませんでした。「写真から読む」を使ってください。");
      return;
    }
    const v = $("video");
    v.srcObject = stream;
    try { await v.play(); } catch (e) { /* iPhoneでは自動で再生される */ }
    $("camera").hidden = false;
    $("cam-start").hidden = true;
    $("cam-stop").hidden = false;
    $("result").hidden = true;
    $("warped-wrap").hidden = true;
    $("cam-status").textContent = "電子ペーパーを点線の枠に合わせてください";
    scanning = true; tries = 0;
    loop();
  }
  function stopCamera() {
    scanning = false;
    if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
    $("video").srcObject = null;
    $("camera").hidden = true;
    $("cam-start").hidden = false;
    $("cam-stop").hidden = true;
  }
  // 映像のうち、画面の枠に実際に見えている範囲（object-fit: cover で切れた外側は使わない）
  function visibleRect(v) {
    const vw = v.videoWidth, vh = v.videoHeight, ew = v.clientWidth || vw, eh = v.clientHeight || vh;
    const sc = Math.max(ew / vw, eh / vh);
    const w = Math.min(vw, ew / sc), h = Math.min(vh, eh / sc);
    return [(vw - w) / 2, (vh - h) / 2, w, h];
  }
  async function loop() {
    const v = $("video");
    while (scanning) {
      if (!busy && v.readyState >= 2 && v.videoWidth) {
        // 交互に: 見えている範囲全体 / 真ん中だけを細かく（離れていても読めるように）
        const vis = visibleRect(v);
        const img = toRGB(v, v.videoWidth, v.videoHeight, 1000, tries % 2 ? centerRect(vis, 0.6) : vis);
        const res = await decodeAsync(img, $("key-read").value, false);
        if (!scanning) break;
        tries++;
        if (res.ok) { stopCamera(); success(res); break; }
        if (tries === 8) $("cam-status").textContent = "まだ読めません。少し離す・正面から撮る・映り込みを避けると読みやすくなります";
        if (tries > 8 && tries % 10 === 0 && !$("key-read").value) $("cam-status").textContent = "合言葉付きで作った画像なら、上に合言葉を入れてください";
      }
      await new Promise((r) => setTimeout(r, 150));
    }
  }
  $("cam-start").addEventListener("click", startCamera);
  $("cam-stop").addEventListener("click", stopCamera);
  document.addEventListener("visibilitychange", () => { if (document.hidden) stopCamera(); });

  // ---------- ホーム画面に追加の案内 ----------
  const standalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  let deferredPrompt = null;
  if (!standalone && store.get("install-closed") !== "1") {
    if (isIOS) {
      $("install-text").textContent = "Safariの下にある共有ボタン（□に↑）→「ホーム画面に追加」をタップしてください。";
      $("install").hidden = false;
    }
    window.addEventListener("beforeinstallprompt", (e) => {
      e.preventDefault();
      deferredPrompt = e;
      $("install-text").textContent = "ボタンを押すと、ホーム画面にアイコンが追加されます。";
      $("install-btn").hidden = false;
      $("install").hidden = false;
    });
  }
  $("install-btn").addEventListener("click", async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice.catch(() => null);
    deferredPrompt = null;
    $("install").hidden = true;
  });
  $("install-close").addEventListener("click", () => { $("install").hidden = true; store.set("install-closed", "1"); });

  // ---------- オフライン用の登録 ----------
  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js").catch(() => { /* なくても動く */ });
  }
})();
