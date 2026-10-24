// 読み取り処理を画面とは別に動かす（カメラ映像がカクつかないように）
importScripts("encoding.min.js", "core.js");

self.onmessage = (ev) => {
  const { id, w, h, data, key } = ev.data;
  let res = null;
  try { res = self.TileCipher.decode({ w, h, data }, key); } catch (e) { res = null; }
  if (res) {
    // 補正後の画像も返す（確認用に表示する）
    const wd = res.warped;
    const rgb = new Uint8Array(wd.w * wd.h * 3);
    for (let i = 0; i < rgb.length; i++) rgb[i] = wd.data[i];
    self.postMessage({ id, ok: true, text: res.text, style: res.style, warped: { w: wd.w, h: wd.h, data: rgb } }, [rgb.buffer]);
  } else {
    self.postMessage({ id, ok: false });
  }
};
