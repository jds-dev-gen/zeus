// Gravação: recebe o som do microfone, passa-o a 16 kHz mono em 16 bits (o formato do Whisper) e manda-o à página aos pedaços de 1 s.
class ZeusRec extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / 16000;
    this.buf = new Int16Array(16000); this.n = 0;
    this.acc = 0; this.accN = 0; this.pos = 0;
    this.sum = 0; this.cnt = 0; this.paused = false;
    this.port.onmessage = e => {
      if (e.data === 'flush') { this.flush(); this.port.postMessage({ done: true }); }
      else if (e.data === 'pause') this.paused = true;
      else if (e.data === 'resume') this.paused = false;
    };
  }
  flush() { if (this.n) { const out = this.buf.slice(0, this.n); this.port.postMessage({ pcm: out.buffer }, [out.buffer]); this.n = 0; } }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch || this.paused) return true;
    for (let i = 0; i < ch.length; i++) {
      const v = ch[i];
      this.sum += v * v; this.cnt++;
      this.acc += v; this.accN++; this.pos += 1;
      if (this.pos >= this.ratio) {           // média simples sobre cada janela (chega para voz)
        let s = this.acc / this.accN; s = s < -1 ? -1 : s > 1 ? 1 : s;
        this.buf[this.n++] = s < 0 ? s * 0x8000 : s * 0x7fff;
        this.acc = 0; this.accN = 0; this.pos -= this.ratio;
        if (this.n === this.buf.length) this.flush();
      }
    }
    if (this.cnt >= sampleRate / 10) { this.port.postMessage({ level: Math.sqrt(this.sum / this.cnt) }); this.sum = 0; this.cnt = 0; }
    return true;
  }
}
registerProcessor('zeus-rec', ZeusRec);
