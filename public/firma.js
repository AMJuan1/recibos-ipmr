// Cuadro de firma (dedo o mouse) y envío.
const token = document.currentScript.dataset.token;
const pad = document.getElementById('pad');
const ctx = pad.getContext('2d');
const enviar = document.getElementById('enviar');
const msg = document.getElementById('msg');
let trazo = null, largo = 0; // largo total del trazo en px: evita enviar un toque accidental
let caja; // área dibujada, para recortar la imagen
const reiniciar = () => { largo = 0; caja = [Infinity, Infinity, -Infinity, -Infinity]; enviar.disabled = true; };

function ajustar() {
  const dpr = window.devicePixelRatio || 1, { width, height } = pad.getBoundingClientRect();
  pad.width = width * dpr; pad.height = height * dpr;
  ctx.scale(dpr, dpr);
  ctx.lineWidth = 2.4; ctx.lineCap = ctx.lineJoin = 'round'; ctx.strokeStyle = '#0b2a8a';
  reiniciar();
}
ajustar();
let ancho = innerWidth;
addEventListener('resize', () => { if (innerWidth !== ancho) { ancho = innerWidth; ajustar(); } }); // girar el teléfono borra la firma

const pos = e => { const b = pad.getBoundingClientRect(); return [e.clientX - b.left, e.clientY - b.top]; };
pad.addEventListener('pointerdown', e => { pad.setPointerCapture(e.pointerId); trazo = pos(e); ctx.beginPath(); ctx.moveTo(...trazo); });
pad.addEventListener('pointermove', e => {
  if (!trazo) return;
  const [x, y] = pos(e);
  largo += Math.hypot(x - trazo[0], y - trazo[1]);
  trazo = [x, y]; ctx.lineTo(x, y); ctx.stroke();
  caja = [Math.min(caja[0], x), Math.min(caja[1], y), Math.max(caja[2], x), Math.max(caja[3], y)];
  if (largo > 60) enviar.disabled = false;
});
['pointerup', 'pointercancel'].forEach(t => pad.addEventListener(t, () => { trazo = null; }));

document.getElementById('borrar').onclick = () => { ctx.clearRect(0, 0, pad.width, pad.height); reiniciar(); };

function recortada() {
  const dpr = pad.width / pad.getBoundingClientRect().width, m = 6;
  const [x0, y0] = [Math.max(0, caja[0] - m) * dpr, Math.max(0, caja[1] - m) * dpr];
  const w = Math.min(pad.width - x0, (caja[2] - caja[0] + 2 * m) * dpr), h = Math.min(pad.height - y0, (caja[3] - caja[1] + 2 * m) * dpr);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d').drawImage(pad, x0, y0, w, h, 0, 0, w, h);
  return c.toDataURL('image/png');
}

enviar.onclick = async () => {
  enviar.disabled = true; msg.textContent = 'Enviando firma…';
  try {
    const res = await fetch(`/recibo/${token}/firmar`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ firma: recortada() }),
    });
    const data = await res.json();
    if (!res.ok && res.status !== 409) throw new Error(data.error);
    location.reload();
  } catch (e) {
    msg.textContent = `No se pudo enviar: ${e.message || 'revise su conexión'}. Intente de nuevo.`;
    enviar.disabled = false;
  }
};
