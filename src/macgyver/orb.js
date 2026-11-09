// MacGyver — a bola de energia (desenhada em canvas)
const ORB_PAL = {
  calm:   { base: '#0d0b1a', blobs: ['#6c4bff', '#2fc6ff', '#ff4fa3', '#8affd8'], speed: 1 },
  alert:  { base: '#1a0d05', blobs: ['#ff7a1a', '#ffb347', '#ff3d6e', '#ffd36b'], speed: 1.5 },
  listen: { base: '#050d1f', blobs: ['#2f7bff', '#36e0ff', '#7b5cff', '#b8f3ff'], speed: 2.2 },
  think:  { base: '#0d0b1a', blobs: ['#8a5cff', '#ff4fa3', '#2fc6ff', '#ffffff'], speed: 3.2 },
};
function drawOrb(cv, t, mode, level) {
  const g = cv.getContext('2d'), S = cv.width, R = S / 2, p = ORB_PAL[mode] || ORB_PAL.calm, sp = p.speed;
  level = level || 0;
  g.clearRect(0, 0, S, S);
  g.save(); g.beginPath(); g.arc(R, R, R, 0, 7); g.clip();
  g.fillStyle = p.base; g.fillRect(0, 0, S, S);
  g.globalCompositeOperation = 'lighter';
  g.filter = `blur(${S * 0.035}px) saturate(1.3)`;
  p.blobs.forEach((col, i) => {
    const a = t * 0.0006 * sp * (1 + i * 0.37) + i * 1.9;
    const rr = R * (0.72 + 0.16 * Math.sin(t * 0.0009 * sp + i));
    const x = R + Math.cos(a) * R * 0.5 * (1 + level * 0.3), y = R + Math.sin(a * 1.3 + i) * R * 0.5 * (1 + level * 0.3);
    const gr = g.createRadialGradient(x, y, 0, x, y, rr * (1 + level * 0.5));
    gr.addColorStop(0, col); gr.addColorStop(0.45, col + '99'); gr.addColorStop(1, col + '00');
    g.globalAlpha = i === 3 ? 0.6 : 1; g.fillStyle = gr; g.fillRect(0, 0, S, S);
  });
  const br = 0.5 + 0.5 * Math.sin(t * 0.0025 * sp);
  const core = g.createRadialGradient(R, R, 0, R, R, R * (0.32 + 0.08 * br + level * 0.25));
  core.addColorStop(0, 'rgba(255,255,255,.85)'); core.addColorStop(1, 'rgba(255,255,255,0)');
  g.globalAlpha = Math.min(1, 0.45 + 0.35 * br + level * 0.4); g.fillStyle = core; g.fillRect(0, 0, S, S);
  g.restore();
  g.save();
  const gl = g.createRadialGradient(R * 0.7, R * 0.55, 0, R * 0.7, R * 0.55, R * 0.9);
  gl.addColorStop(0, 'rgba(255,255,255,.28)'); gl.addColorStop(0.5, 'rgba(255,255,255,0)');
  g.beginPath(); g.arc(R, R, R - 1, 0, 7); g.fillStyle = gl; g.fill();
  g.lineWidth = Math.max(1, S * 0.006); g.strokeStyle = 'rgba(255,255,255,.12)'; g.stroke();
  g.restore();
}
