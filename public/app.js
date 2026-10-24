(() => {
  "use strict";
  const VERSION = "v1.0";
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

  // ---------- 作る ----------
  const canvas = document.createElement("canvas");
  canvas.width = TC.W; canvas.height = TC.H;
  const ctx = canvas.getContext("2d");
  let currentIdx = null;
  let currentFile = null;   // 共有ボタンを押した瞬間に渡せるよう、先に作っておく

  function fileName() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    return `tile-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.png`;
  }
  function render() {
    const text = $("msg").value;
    const n = TC.byteLength(text);
    $("meter-text").textContent = `${n} / ${TC.MAXP} バイト`;
    $("meter-bar").style.width = Math.min(100, (n / TC.MAXP) * 100) + "%";
    const over = n > TC.MAXP;
    $("meter").classList.toggle("over", over);
    $("share").disabled = over || n === 0;
    store.set("msg", text);
    if (over || n === 0) { currentFile = null; return; }
    currentIdx = TC.encode(text, $("key-make").value);
    ctx.putImageData(new ImageData(TC.toRGBA(currentIdx), TC.W, TC.H), 0, 0);
    $("code-img").src = canvas.toDataURL("image/png");
    currentFile = null;
    canvas.toBlob((blob) => { if (blob) currentFile = new File([blob], fileName(), { type: "image/png" }); }, "image/png");
  }
  let timer = 0;
  const schedule = () => { clearTimeout(timer); timer = setTimeout(render, 120); };
  $("msg").addEventListener("input", schedule);
  $("key-make").addEventListener("input", schedule);
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
  const worker = new Worker("worker.js");
  let jobId = 0, busy = false;
  const pending = new Map();
  worker.onmessage = (ev) => {
    const cb = pending.get(ev.data.id);
    pending.delete(ev.data.id);
    busy = false;
    if (cb) cb(ev.data);
  };
  function decodeAsync(img, key) {
    return new Promise((resolve) => {
      const id = ++jobId;
      pending.set(id, resolve);
      busy = true;
      worker.postMessage({ id, w: img.w, h: img.h, data: img.data, key }, [img.data.buffer]);
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
    showWarped(res.warped);
    if (navigator.vibrate) navigator.vibrate(60);
  }

  // 画像やカメラの1コマを、長い辺1000pxまでの RGB データにする
  const grab = document.createElement("canvas");
  const gctx = grab.getContext("2d", { willReadFrequently: true });
  function toRGB(source, sw, sh, max = 1000) {
    const f = Math.min(1, max / Math.max(sw, sh));
    const w = Math.round(sw * f), h = Math.round(sh * f);
    grab.width = w; grab.height = h;
    gctx.drawImage(source, 0, 0, w, h);
    const d = gctx.getImageData(0, 0, w, h).data;
    const rgb = new Uint8Array(w * h * 3);
    for (let i = 0, j = 0; i < w * h; i++, j += 3) { rgb[j] = d[i * 4]; rgb[j + 1] = d[i * 4 + 1]; rgb[j + 2] = d[i * 4 + 2]; }
    return { w, h, data: rgb };
  }

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
      const img = toRGB(bmp, bmp.width, bmp.height);
      const res = await decodeAsync(img, $("key-read").value);
      if (res.ok) success(res);
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
    if (res.ok) success(res); else showResult(false, "合言葉が違うようです。");
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
  async function loop() {
    const v = $("video");
    while (scanning) {
      if (!busy && v.readyState >= 2 && v.videoWidth) {
        const img = toRGB(v, v.videoWidth, v.videoHeight);
        const res = await decodeAsync(img, $("key-read").value);
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
