// Web Audio による効果音（旧 script.js から移植）
let audioCtx = null;
let enabled = true;

// サウンドON/OFF（旧 soundOn フラグと同等）
export function setSoundEnabled(on) {
  enabled = on;
}

export function beep(freq, dur = 0.06, vol = 0.18) {
  if (!enabled) return;
  try {
    if (!audioCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      audioCtx = new Ctx();
    }
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "square";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(vol, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + dur);
  } catch {
    // オーディオ不可時は無音で続行
  }
}
