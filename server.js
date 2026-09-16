import express from 'express';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { extraerPlanilla, mapear } from './planilla.js';
import { PROYECTOS, MESES, calcular, dinero, generarPdf, reciboHtml, RECIBO_CSS, esc, nombreArchivo } from './recibo.js';

const {
  PORT = 3000, DATA_DIR = './data', ADMIN_PASSWORD, SESSION_SECRET = randomBytes(32).toString('hex'),
} = process.env;
if (!ADMIN_PASSWORD) { console.error('Falta la variable de entorno ADMIN_PASSWORD'); process.exit(1); }

// ---------- base de datos ----------
mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(join(DATA_DIR, 'recibos.db'));
db.exec(`CREATE TABLE IF NOT EXISTS recibos (
  token TEXT PRIMARY KEY,
  nombre TEXT NOT NULL, proyecto TEXT NOT NULL, cargo TEXT NOT NULL DEFAULT '',
  salario REAL NOT NULL, iva REAL NOT NULL DEFAULT 0, descuento REAL NOT NULL DEFAULT 0,
  isss REAL NOT NULL, afp REAL NOT NULL, rentaSalario REAL NOT NULL,
  viaticos REAL NOT NULL, rentaViaticos REAL NOT NULL,
  subSalarioPlanilla REAL, subViaticosPlanilla REAL,
  diaInicio INTEGER NOT NULL, diaFin INTEGER NOT NULL, mes TEXT NOT NULL, anio INTEGER NOT NULL,
  fechaEmision TEXT NOT NULL, creadoEn TEXT NOT NULL,
  firmadoEn TEXT, firmaIp TEXT, firmaDispositivo TEXT, firma BLOB
)`);
// Bases creadas antes de que el recibo tuviera IVA y descuento personal.
for (const [col, tipo] of [['iva', 'REAL NOT NULL DEFAULT 0'], ['descuento', 'REAL NOT NULL DEFAULT 0'],
  ['subSalarioPlanilla', 'REAL'], ['subViaticosPlanilla', 'REAL']])
  if (!db.prepare('PRAGMA table_info(recibos)').all().some(c => c.name === col))
    db.exec(`ALTER TABLE recibos ADD COLUMN ${col} ${tipo}`);

const buscar = token => {
  const r = db.prepare('SELECT * FROM recibos WHERE token = ?').get(token);
  if (r?.firma) r.firma = Buffer.from(r.firma);
  return r;
};

const fechaSV = iso => new Date(iso).toLocaleString('es-SV', { timeZone: 'America/El_Salvador', dateStyle: 'short', timeStyle: 'short' });

// ---------- sesión admin (cookie firmada con HMAC) ----------
const firmar = v => createHmac('sha256', SESSION_SECRET).update(v).digest('base64url');
const esAdmin = req => {
  const m = /(?:^|;\s*)admin=(\d+)\.([\w-]+)/.exec(req.headers.cookie || '');
  if (!m || Number(m[1]) < Date.now()) return false;
  const a = Buffer.from(m[2]), b = Buffer.from(firmar(m[1]));
  return a.length === b.length && timingSafeEqual(a, b);
};

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '35mb' }));
app.use((req, res, next) => { res.set({ 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex' }); next(); });
app.use(express.static('public', { index: false }));

app.get('/', (req, res) => res.redirect('/admin'));
app.get('/admin', (req, res) => res.sendFile('admin.html', { root: 'public' }));

// Bloqueo por fuerza bruta: la contraseña puede ser corta, así que 5 fallos cierran esa IP por 15 minutos.
const intentos = new Map();
app.post('/api/login', (req, res) => {
  const previo = intentos.get(req.ip);
  if (previo?.hasta > Date.now())
    return res.status(429).json({ error: `Demasiados intentos. Espere ${Math.ceil((previo.hasta - Date.now()) / 60000)} minutos.` });
  const a = Buffer.from(String(req.body?.password ?? '')), b = Buffer.from(ADMIN_PASSWORD);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    const n = (previo?.n || 0) + 1;
    intentos.set(req.ip, { n, hasta: n >= 5 ? Date.now() + 9e5 : 0 });
    return setTimeout(() => res.status(401).json({ error: 'Contraseña incorrecta' }), 800);
  }
  intentos.delete(req.ip);
  const exp = String(Date.now() + 7 * 864e5);
  res.cookie('admin', `${exp}.${firmar(exp)}`, { httpOnly: true, sameSite: 'lax', secure: req.secure, maxAge: 7 * 864e5 });
  res.json({ ok: true });
});
app.post('/api/logout', (req, res) => res.clearCookie('admin').json({ ok: true }));
app.use('/api', (req, res, next) => esAdmin(req) ? next() : res.status(401).json({ error: 'No autorizado' }));

// ---------- extracción de planilla (extractor/planillas.py) ----------
app.post('/api/extraer', async (req, res) => {
  const { archivo, nombre = 'planilla.xlsx' } = req.body || {};
  if (!archivo) return res.status(400).json({ error: 'Falta el archivo de la planilla' });
  try {
    const datos = await extraerPlanilla(Buffer.from(archivo, 'base64'), String(nombre).slice(0, 120));
    const { periodo, trabajadores, avisos } = mapear(datos);
    if (!trabajadores.length) return res.status(422).json({ error: 'No se encontraron trabajadores en el archivo' });
    res.json({ periodo, trabajadores, avisos });
  } catch (e) {
    console.error('Error de extracción', e);
    res.status(502).json({ error: `Error al leer la planilla: ${e.message}` });
  }
});

// ---------- recibos (admin) ----------
const CAMPOS = ['salario', 'iva', 'descuento', 'isss', 'afp', 'rentaSalario', 'viaticos', 'rentaViaticos'];
const SUBTOTALES = ['subSalarioPlanilla', 'subViaticosPlanilla'];

function validar(body) {
  const { periodo: p = {}, fechaEmision, trabajadores } = body || {};
  const entero = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
  if (!entero(p.diaInicio, 1, 31) || !entero(p.diaFin, 1, 31) || !MESES.includes(p.mes) || !entero(p.anio, 2000, 2100)) return 'Período inválido';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaEmision || '')) return 'Fecha de emisión inválida';
  if (!Array.isArray(trabajadores) || !trabajadores.length) return 'No hay trabajadores seleccionados';
  for (const t of trabajadores) {
    if (!String(t.nombre || '').trim()) return 'Hay un trabajador sin nombre';
    if (!PROYECTOS.includes(t.proyecto)) return `Proyecto inválido para ${t.nombre}`;
    for (const k of CAMPOS)
      if (typeof t[k] !== 'number' || !Number.isFinite(t[k]) || t[k] < 0) return `Monto inválido (${k}) para ${t.nombre}`;
    for (const k of SUBTOTALES)
      if (t[k] != null && (typeof t[k] !== 'number' || !Number.isFinite(t[k]))) return `Subtotal inválido (${k}) para ${t.nombre}`;
    if (calcular(t).total <= 0) return `El total de ${t.nombre} debe ser mayor que cero`;
  }
}

app.post('/api/recibos', (req, res) => {
  const error = validar(req.body);
  if (error) return res.status(400).json({ error });
  const { periodo: p, fechaEmision, trabajadores } = req.body;
  const columnas = [...CAMPOS, ...SUBTOTALES];
  const ins = db.prepare(`INSERT INTO recibos (token, nombre, proyecto, cargo, ${columnas.join(', ')},
    diaInicio, diaFin, mes, anio, fechaEmision, creadoEn) VALUES (${Array(columnas.length + 10).fill('?').join(',')})`);
  const ahora = new Date().toISOString();
  db.exec('BEGIN');
  try {
    for (const t of trabajadores)
      ins.run(randomBytes(24).toString('base64url'), t.nombre.trim(), t.proyecto, String(t.cargo || '').trim(),
        ...CAMPOS.map(k => t[k]), ...SUBTOTALES.map(k => (t[k] == null ? null : t[k])), p.diaInicio, p.diaFin, p.mes, p.anio, fechaEmision, ahora);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  res.json({ ok: true, creados: trabajadores.length });
});

app.get('/api/recibos', (req, res) => {
  const filas = db.prepare(`SELECT token, nombre, proyecto, cargo, ${[...CAMPOS, ...SUBTOTALES].join(', ')},
    diaInicio, diaFin, mes, anio, fechaEmision, creadoEn, firmadoEn, firmaIp, firmaDispositivo
    FROM recibos ORDER BY anio DESC, creadoEn DESC, proyecto, nombre`).all();
  res.json(filas.map(r => ({ ...r, total: calcular(r).total, firmadoEnTexto: r.firmadoEn && fechaSV(r.firmadoEn) })));
});

app.delete('/api/recibos/:token', (req, res) => {
  const { changes } = db.prepare('DELETE FROM recibos WHERE token = ? AND firmadoEn IS NULL').run(req.params.token);
  changes ? res.json({ ok: true }) : res.status(409).json({ error: 'No existe o ya fue firmado' });
});

app.get('/api/recibos/:token/pdf', async (req, res) => {
  const r = buscar(req.params.token);
  if (!r) return res.sendStatus(404);
  res.type('pdf').set('Content-Disposition', `inline; filename="${nombreArchivo(r)}"`).send(await generarPdf(r));
});

// ---------- flujo del trabajador (sin login, solo token) ----------
const pagina = (titulo, cuerpo) => `<!doctype html><html lang="es-SV"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(titulo)}</title>
<link rel="stylesheet" href="/trabajador.css"><style>${RECIBO_CSS}</style></head><body>${cuerpo}</body></html>`;

app.get('/recibo/:token', (req, res) => {
  const r = buscar(req.params.token);
  if (!r) return res.status(404).send(pagina('Recibo no encontrado', '<main class="aviso"><h1>Recibo no encontrado</h1><p>Verifique el enlace que recibió.</p></main>'));
  const firmaUrl = r.firma && `data:image/png;base64,${r.firma.toString('base64')}`;
  const acciones = r.firmadoEn
    ? `<section class="panel ok"><p><b>✔ Recibo firmado</b> el ${esc(fechaSV(r.firmadoEn))}</p>
       <a class="btn" href="/recibo/${r.token}/pdf">Descargar mi recibo (PDF)</a></section>`
    : `<section class="panel" id="firmar">
       <h2>Firme aquí</h2><p>Revise su recibo y firme con el dedo dentro del recuadro.</p>
       <canvas id="pad" aria-label="Recuadro para firmar"></canvas>
       <div class="fila"><button type="button" class="btn sec" id="borrar">Borrar</button>
       <button type="button" class="btn" id="enviar" disabled>Firmar y enviar</button></div>
       <p id="msg" role="status"></p></section>
       <script src="/firma.js" data-token="${r.token}"></script>`;
  res.send(pagina(`Recibo — ${r.nombre}`, `<main><p class="intro">Recibo de pago · ${esc(r.proyecto)} · ${r.diaInicio} al ${r.diaFin} de ${esc(r.mes)} ${r.anio}${r.firmadoEn ? '' : ' · <a href="#firmar">Ir a firmar ↓</a>'}</p>
    ${reciboHtml(r, firmaUrl)}${acciones}</main>`));
});

app.post('/recibo/:token/firmar', async (req, res) => {
  const r = buscar(req.params.token);
  if (!r) return res.status(404).json({ error: 'Recibo no encontrado' });
  if (r.firmadoEn) return res.status(409).json({ error: 'Este recibo ya fue firmado' });
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(req.body?.firma || ''));
  const firma = m && Buffer.from(m[1], 'base64');
  if (!firma || firma.length > 1_000_000 || !firma.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    return res.status(400).json({ error: 'Firma inválida' });
  try { await generarPdf({ ...r, firma }); } catch { return res.status(400).json({ error: 'Firma inválida' }); }

  const firmadoEn = new Date().toISOString();
  const { changes } = db.prepare('UPDATE recibos SET firma = ?, firmadoEn = ?, firmaIp = ?, firmaDispositivo = ? WHERE token = ? AND firmadoEn IS NULL')
    .run(firma, firmadoEn, req.ip, String(req.get('user-agent') || '').slice(0, 300), r.token);
  if (!changes) return res.status(409).json({ error: 'Este recibo ya fue firmado' });
  res.json({ ok: true });
});

app.get('/recibo/:token/pdf', async (req, res) => {
  const r = buscar(req.params.token);
  if (!r?.firmadoEn) return res.sendStatus(404);
  res.type('pdf').set('Content-Disposition', `attachment; filename="${nombreArchivo(r)}"`).send(await generarPdf(r));
});

app.listen(PORT, () => console.log(`Recibos IPMR en http://localhost:${PORT}`));
