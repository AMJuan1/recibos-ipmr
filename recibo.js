// Cálculo, monto en letras y render (PDF + HTML) de los dos documentos:
//   tipo 'quincena'   -> recibo de una quincena        (Plantilla_Recibo_IPMR.docx)
//   tipo 'constancia' -> constancia de varias planillas (Plantilla_Recibo_Multiples_Quincenas_IPMR.docx)
import PDFDocument from 'pdfkit';
import { fileURLToPath } from 'node:url';

export const PROYECTOS = ['Changallo', 'Italia', 'Oficina'];
export const MESES = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'];
const FIRMA_AUTORIZA = fileURLToPath(new URL('./public/firma-autoriza.png', import.meta.url));
const DIRECCION = 'Av. Artillería 9-A, Col. Manuel José Arce, Distrito de San Salvador, Municipio de San Salvador Centro, Departamento de San Salvador, El Salvador. Tel: 2230-5042, 7700-6226 Email inpromorsa@gmail.com';

// ---------- montos ----------
const cents = n => Math.round((Number(n) || 0) * 100); // iva y descuento son opcionales

export const lineasDe = r => (typeof r.lineas === 'string' ? JSON.parse(r.lineas || '[]') : r.lineas || []);
export const esConstancia = r => r.tipo === 'constancia';

// Los subtotales de la planilla mandan cuando vienen (Excel calcula con más decimales de los que
// imprime: AFP 32.625 se muestra 32.63, así que sumar las líneas impresas puede dar un centavo menos).
const dePlanilla = v => (v === null || v === undefined || v === '' ? null : cents(v));

export function calcular(r) {
  if (esConstancia(r)) {
    const total = lineasDe(r).reduce((s, l) => s + cents(l.monto), 0);
    return { subSalario: total / 100, subViaticos: 0, total: total / 100 };
  }
  const subSalario = dePlanilla(r.subSalarioPlanilla)
    ?? cents(r.salario) + cents(r.iva) - cents(r.isss) - cents(r.afp) - cents(r.rentaSalario) - cents(r.descuento);
  const subViaticos = dePlanilla(r.subViaticosPlanilla) ?? cents(r.viaticos) - cents(r.rentaViaticos);
  return { subSalario: subSalario / 100, subViaticos: subViaticos / 100, total: (subSalario + subViaticos) / 100 };
}

export const dinero = n => Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ---------- número a letras (estilo legal salvadoreño: "UN MIL", centavos xx/100) ----------
const UNI = ['', 'UN', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE', 'DIEZ', 'ONCE', 'DOCE', 'TRECE', 'CATORCE', 'QUINCE',
  'DIECISÉIS', 'DIECISIETE', 'DIECIOCHO', 'DIECINUEVE', 'VEINTE', 'VEINTIÚN', 'VEINTIDÓS', 'VEINTITRÉS', 'VEINTICUATRO', 'VEINTICINCO',
  'VEINTISÉIS', 'VEINTISIETE', 'VEINTIOCHO', 'VEINTINUEVE'];
const DEC = ['', '', '', 'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA'];
const CEN = ['', 'CIENTO', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS', 'SEISCIENTOS', 'SETECIENTOS', 'OCHOCIENTOS', 'NOVECIENTOS'];

function cientos(n) {
  if (n === 100) return 'CIEN';
  const r = n % 100;
  const dec = r < 30 ? UNI[r] : DEC[Math.floor(r / 10)] + (r % 10 ? ' Y ' + UNI[r % 10] : '');
  return [CEN[Math.floor(n / 100)], dec].filter(Boolean).join(' ');
}

function entero(n) {
  if (n === 0) return 'CERO';
  const millones = Math.floor(n / 1e6), miles = Math.floor(n / 1e3) % 1e3, resto = n % 1e3;
  return [
    millones && (millones === 1 ? 'UN MILLÓN' : entero(millones) + ' MILLONES'),
    miles && cientos(miles) + ' MIL',
    resto && cientos(resto),
  ].filter(Boolean).join(' ');
}

export function montoEnLetras(monto) {
  const c = cents(monto);
  return `${entero(Math.floor(c / 100))} ${String(c % 100).padStart(2, '0')}/100 DÓLARES`;
}

// ---------- datos derivados comunes a PDF y HTML ----------
const fechaDe = fechaEmision => {
  const [anio, mes, dia] = fechaEmision.split('-').map(Number);
  return { dia: String(dia), mes: MESES[mes - 1].toLowerCase(), anio: String(anio) };
};

function datos(r) {
  const { subSalario, subViaticos, total } = calcular(r);
  const rango = `${r.diaInicio} AL ${r.diaFin}`;
  return {
    total, subSalario, subViaticos,
    letras: montoEnLetras(total),
    periodo: `${rango} DE ${r.mes} ${r.anio}`,
    // IVA y descuento personal solo aparecen si la planilla los trae; si no, el recibo queda igual a la plantilla.
    filas: [
      { label: `SALARIO DEL ${rango}`, monto: r.salario },
      Number(r.iva) > 0 && { mas: true, label: 'IVA', monto: r.iva },
      { menos: true, label: 'ISSS', monto: r.isss },
      { sangria: true, label: 'AFP', monto: r.afp },
      { sangria: true, label: 'RENTA', monto: r.rentaSalario },
      Number(r.descuento) > 0 && { sangria: true, label: 'DESCUENTO PERSONAL', monto: r.descuento },
      { total: true, label: 'SUB-TOTAL', monto: subSalario },
      { vacia: true },
      { label: `VIÁTICOS DEL ${rango}`, monto: r.viaticos },
      { menos: true, label: 'RENTA', monto: r.rentaViaticos },
      { total: true, label: 'SUB-TOTAL', monto: subViaticos },
      { vacia: true },
      { total: true, label: 'TOTAL A RECIBIR', monto: total },
    ].filter(Boolean),
    fecha: fechaDe(r.fechaEmision),
  };
}

const limpiaNombre = s => s.normalize('NFD').replace(/[^\w ]/g, '').trim().replace(/\s+/g, '_');

export const nombreArchivo = r => esConstancia(r)
  ? `Constancia_${limpiaNombre(r.nombre)}_${lineasDe(r).length}_planillas.pdf`
  : `Recibo_${limpiaNombre(r.nombre)}_${r.diaInicio}-${r.diaFin}_${r.mes}_${r.anio}.pdf`;

// ---------- PDF (Letter, medidas tomadas de las plantillas .docx) ----------
const L = 72, W = 612 - 72 - 66;
const Y_INICIO = 108;   // debajo del membrete
const Y_LIMITE = 715;   // arriba del pie de página

function membrete(doc) {
  // IPMR rojo serif + razón social Arial bold subrayada en rojo, misma línea.
  const base = 78, x0 = 58, razon = 'INGENIERIA Y PROYECTOS MORALES SA DE CV';
  doc.font('Times-Bold').fontSize(48).fillColor('#BD1003');
  const wIpmr = doc.widthOfString('IPMR');
  doc.text('IPMR', x0, base, { baseline: 'alphabetic', lineBreak: false });
  let tam = 14;
  doc.font('Helvetica-Bold');
  while (doc.fontSize(tam).widthOfString(razon) > 612 - 40 - (x0 + wIpmr + 6)) tam -= 0.5;
  const xr = x0 + wIpmr + 6, wr = doc.widthOfString(razon);
  doc.fillColor('black').text(razon, xr, base, { baseline: 'alphabetic', lineBreak: false });
  doc.moveTo(xr, base + 2.5).lineTo(xr + wr, base + 2.5).lineWidth(1).strokeColor('#FF0000').stroke();
}

function pieDePagina(doc) {
  doc.moveTo(L, 740).lineTo(L + W, 740).lineWidth(1.2).strokeColor('#FF0000').stroke();
  doc.font('Helvetica').fontSize(8).fillColor('black').text(DIRECCION, L, 745, { width: W, align: 'center' });
}

function nuevaHoja(doc) {
  doc.addPage();
  membrete(doc);
  pieDePagina(doc);
  return Y_INICIO;
}

// Fecha, firma del trabajador y firma de autorización: igual en los dos documentos.
const ALTO_CIERRE = 300;

function cierre(doc, r, y, conforme) {
  const d = fechaDe(r.fechaEmision);
  const seg = [['San Salvador, ', false], [d.dia, true], [' de ', false], [d.mes, true], [' del ', false], [d.anio, true], ['.-', false]];
  doc.font('Helvetica').fontSize(10).fillColor('black');
  let x = L;
  for (const [t, u] of seg) { doc.text(t, x, y, { lineBreak: false, underline: u }); x += doc.widthOfString(t); }

  y += 36;
  doc.text(conforme, L, y);

  const yLinea = y + 78; // espacio amplio para que quepa la firma
  if (r.firma) doc.image(r.firma, L + 14, yLinea - 62, { fit: [190, 68], align: 'center', valign: 'bottom' });
  doc.text('F: ______________________________', L, yLinea);
  doc.text('Nombre del trabajador: ', L, yLinea + 15, { continued: true }).text(r.nombre, { underline: true });
  y = yLinea + 30;
  if (r.cargo) { doc.text('Cargo: ', L, y, { continued: true }).text(r.cargo, { underline: true }); y += 15; }

  y += 12;
  doc.image(FIRMA_AUTORIZA, L, y, { width: 72 });
  y += 76;
  doc.font('Helvetica-Bold').text('Ing. José Othmaro Morales Urbina', L, y);
  doc.font('Helvetica').text('NIT: 0715-250560-002-1', L, y + 12);
  doc.font('Helvetica-Oblique').text('Autoriza', L, y + 24);
}

function abrirDoc(r) {
  const doc = new PDFDocument({
    size: 'LETTER', margins: { top: 72, left: L, right: 66, bottom: 20 },
    info: { Title: `${esConstancia(r) ? 'Constancia' : 'Recibo'} ${r.nombre}` },
  });
  const chunks = [];
  doc.on('data', c => chunks.push(c));
  const listo = new Promise((ok, fail) => { doc.on('end', () => ok(Buffer.concat(chunks))); doc.on('error', fail); });
  membrete(doc);
  pieDePagina(doc);
  return { doc, listo };
}

export function generarPdf(r) {
  return esConstancia(r) ? pdfConstancia(r) : pdfRecibo(r);
}

function pdfRecibo(r) {
  const d = datos(r);
  const { doc, listo } = abrirDoc(r);

  doc.fillColor('black').font('Helvetica-Bold').fontSize(12)
    .text(`POR $ ${dinero(d.total)}`, L, Y_INICIO, { width: W, align: 'center', underline: true });
  doc.moveDown(1);

  const tramos = [
    ['Recibí de ', false], ['INGENIERÍA Y PROYECTOS MORALES, S.A. DE C.V.', true], [', la cantidad de ', false],
    [`${d.letras} (US$${dinero(d.total)})`, true], [', en concepto de ', false], ['SALARIO MÁS VIÁTICOS', true],
    [', correspondientes del ', false], [d.periodo, true], ['; según el siguiente detalle.', false],
  ];
  doc.fontSize(10);
  doc.x = L;
  tramos.forEach(([t, b], i) => doc.font(b ? 'Helvetica-Bold' : 'Helvetica').text(t, { width: W, align: 'justify', continued: i < tramos.length - 1, lineGap: 1.5 }));
  let y = doc.y + 12;

  // Tabla de desglose (col 1: 331pt, col 2: 130pt alineada a la derecha)
  for (const f of d.filas) {
    if (f.vacia) { y += 9; continue; }
    doc.font(f.total ? 'Helvetica-Bold' : 'Helvetica').fontSize(10);
    if (f.menos || f.mas) doc.text(f.mas ? '(+)' : '(-)', L + 29, y, { lineBreak: false });
    doc.text(f.label, L + (f.menos || f.mas || f.sangria ? 60 : 0), y, { lineBreak: false, underline: !!f.total });
    doc.text(`$${dinero(f.monto)}`, L + 331, y, { width: 130, align: 'right', underline: !!f.total });
    y += 15.5;
  }

  cierre(doc, r, y + 26, 'Recibí conforme el pago detallado anteriormente.');
  doc.end();
  return listo;
}

// Constancia: la tabla puede tener muchas planillas, así que salta de página cuando hace falta.
function pdfConstancia(r) {
  const lineas = lineasDe(r);
  const total = calcular(r).total;
  const { doc, listo } = abrirDoc(r);
  const COL = { no: 40, concepto: 314, monto: 120 };

  doc.fillColor('black').font('Helvetica-Bold').fontSize(13)
    .text('CONSTANCIA DE RECIBO DE PAGOS', L, Y_INICIO, { width: W, align: 'center', underline: true });
  doc.font('Helvetica-Oblique').fontSize(10)
    .text('(Planillas atrasadas / sin constancia previa)', L, doc.y + 4, { width: W, align: 'center' });

  const tramos = [
    ['Yo, ', 'n'], [r.nombre, 'bu'], [', con cargo de ', 'n'], [r.cargo || '—', 'u'], [' en el proyecto ', 'n'], [r.proyecto, 'u'],
    [', hago constar que he recibido de ', 'n'], ['INGENIERÍA Y PROYECTOS MORALES, S.A. DE C.V.', 'b'], [' la cantidad de ', 'n'],
    [`${montoEnLetras(total)} (US$${dinero(total)})`, 'b'], [', correspondiente al pago de ', 'n'], ['SALARIO Y VIÁTICOS', 'b'],
    [' de las siguientes planillas/quincenas, ya trabajadas y pagadas con anterioridad, de las cuales no se tenía constancia firmada, según el siguiente detalle:', 'n'],
  ];
  doc.fontSize(10);
  doc.x = L; doc.y = doc.y + 10;
  tramos.forEach(([t, e], i) => doc.font(e.includes('b') ? 'Helvetica-Bold' : 'Helvetica')
    .text(t, { width: W, align: 'justify', underline: e.includes('u'), continued: i < tramos.length - 1, lineGap: 1.5 }));
  let y = doc.y + 14;

  const fila = (texto, monto, opts = {}) => {
    doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(10);
    const alto = Math.max(17, doc.heightOfString(texto, { width: COL.concepto - 12 }) + 7);
    if (y + alto > Y_LIMITE) y = nuevaHoja(doc);
    let x = L;
    for (const [ancho, contenido, align] of [[COL.no, opts.no ?? '', 'center'], [COL.concepto, texto, opts.bold ? 'right' : 'left'], [COL.monto, monto, 'right']]) {
      doc.rect(x, y, ancho, alto).lineWidth(0.6).strokeColor('#999999').stroke();
      doc.fillColor('black').text(String(contenido), x + 6, y + 4, { width: ancho - 12, align, lineBreak: true });
      x += ancho;
    }
    y += alto;
  };

  fila('Planilla / Período', 'Monto recibido', { bold: true, no: 'No.' });
  doc.font('Helvetica');
  lineas.forEach((l, i) => fila(l.concepto, `$${dinero(l.monto)}`, { no: i + 1 }));
  fila('TOTAL', `$${dinero(total)}`, { bold: true });

  y += 16;
  if (y + 24 + ALTO_CIERRE > Y_LIMITE) y = nuevaHoja(doc);
  doc.font('Helvetica').fontSize(10)
    .text('Declaro que los montos anteriores me fueron pagados en su totalidad y que no tengo ningún reclamo pendiente relacionado con dichos períodos.',
      L, y, { width: W, align: 'justify', lineGap: 1.5 });

  cierre(doc, r, doc.y + 20, 'Recibí conforme los pagos detallados anteriormente.');
  doc.end();
  return listo;
}

// ---------- HTML (vista móvil del mismo documento) ----------
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

const hoja = (cuerpo, r, firmaDataUrl, conforme) => {
  const f = fechaDe(r.fechaEmision);
  return `
  <article class="hoja">
    <header class="membrete"><span class="ipmr">IPMR</span> <span class="razon">INGENIERIA Y PROYECTOS MORALES SA DE CV</span></header>
    ${cuerpo}
    <p class="fecha">San Salvador, <u>${f.dia}</u> de <u>${f.mes}</u> del <u>${f.anio}</u>.-</p>
    <p>${conforme}</p>
    <div class="firma-trab">${firmaDataUrl ? `<img src="${firmaDataUrl}" alt="Firma del trabajador">` : ''}</div>
    <p class="linea">F: ______________________________</p>
    <p class="linea">Nombre del trabajador: <u>${esc(r.nombre)}</u></p>
    ${r.cargo ? `<p class="linea">Cargo: <u>${esc(r.cargo)}</u></p>` : ''}
    <div class="autoriza">
      <img src="/firma-autoriza.png" alt="Firma Ing. José Othmaro Morales Urbina">
      <b>Ing. José Othmaro Morales Urbina</b><span>NIT: 0715-250560-002-1</span><i>Autoriza</i>
    </div>
    <footer class="pie">${esc(DIRECCION)}</footer>
  </article>`;
};

export const reciboHtml = (r, firmaDataUrl) => esConstancia(r)
  ? constanciaHtml(r, firmaDataUrl)
  : hoja(cuerpoRecibo(r), r, firmaDataUrl, 'Recibí conforme el pago detallado anteriormente.');

function cuerpoRecibo(r) {
  const d = datos(r);
  const filas = d.filas.map(f => f.vacia ? '<tr class="vacia"><td colspan="2"></td></tr>' : `
    <tr class="${f.total ? 'tot' : ''}">
      <td class="${f.menos || f.mas || f.sangria ? 'sang' : ''}">${f.menos || f.mas || f.sangria ? `<span class="menos">${f.menos ? '(-)' : f.mas ? '(+)' : ''}</span>` : ''}<span>${esc(f.label)}</span></td>
      <td class="num"><span>$${dinero(f.monto)}</span></td>
    </tr>`).join('');
  return `
    <h2 class="por">POR $ ${dinero(d.total)}</h2>
    <p class="cuerpo">Recibí de <b>INGENIERÍA Y PROYECTOS MORALES, S.A. DE C.V.</b>, la cantidad de <b>${esc(d.letras)} (US$${dinero(d.total)})</b>, en concepto de <b>SALARIO MÁS VIÁTICOS</b>, correspondientes del <b>${esc(d.periodo)}</b>; según el siguiente detalle.</p>
    <table class="detalle">${filas}</table>`;
}

function constanciaHtml(r, firmaDataUrl) {
  const lineas = lineasDe(r), total = calcular(r).total;
  const filas = lineas.map((l, i) => `
    <tr><td class="c">${i + 1}</td><td>${esc(l.concepto)}</td><td class="num">$${dinero(l.monto)}</td></tr>`).join('');
  const cuerpo = `
    <h2 class="titulo">CONSTANCIA DE RECIBO DE PAGOS</h2>
    <p class="subtitulo">(Planillas atrasadas / sin constancia previa)</p>
    <p class="cuerpo">Yo, <b><u>${esc(r.nombre)}</u></b>, con cargo de <u>${esc(r.cargo || '—')}</u> en el proyecto <u>${esc(r.proyecto)}</u>, hago constar que he recibido de <b>INGENIERÍA Y PROYECTOS MORALES, S.A. DE C.V.</b> la cantidad de <b>${esc(montoEnLetras(total))} (US$${dinero(total)})</b>, correspondiente al pago de <b>SALARIO Y VIÁTICOS</b> de las siguientes planillas/quincenas, ya trabajadas y pagadas con anterioridad, de las cuales no se tenía constancia firmada, según el siguiente detalle:</p>
    <table class="planillas">
      <thead><tr><th class="c">No.</th><th class="c">Planilla / Período</th><th class="c">Monto recibido</th></tr></thead>
      <tbody>${filas}</tbody>
      <tfoot><tr><td></td><td class="tot">TOTAL</td><td class="num tot">$${dinero(total)}</td></tr></tfoot>
    </table>
    <p class="cuerpo">Declaro que los montos anteriores me fueron pagados en su totalidad y que no tengo ningún reclamo pendiente relacionado con dichos períodos.</p>`;
  return hoja(cuerpo, r, firmaDataUrl, 'Recibí conforme los pagos detallados anteriormente.');
}

export const RECIBO_CSS = `
.hoja{background:#fff;color:#000;max-width:816px;margin:0 auto;padding:28px 22px;font:15px/1.45 Arial,Helvetica,sans-serif;box-shadow:0 1px 6px rgba(0,0,0,.15)}
.membrete{display:flex;flex-wrap:wrap;align-items:baseline;gap:0 8px;margin-bottom:22px}
.ipmr{color:#BD1003;font:bold clamp(38px,11vw,52px)/1 "Bookman Old Style",Georgia,"Times New Roman",serif}
.razon{font-weight:bold;font-size:clamp(11px,3.4vw,18px);text-decoration:underline;text-decoration-color:red;text-underline-offset:3px}
.por{text-align:center;text-decoration:underline;font-size:17px;margin:0 0 14px}
.titulo{text-align:center;text-decoration:underline;font-size:19px;margin:0 0 4px}
.subtitulo{text-align:center;font-style:italic;margin:0 0 16px}
.cuerpo{text-align:justify}
@media (max-width:600px){.cuerpo{text-align:left}}
.detalle{width:100%;border-collapse:collapse;margin:14px 0 26px}
.detalle td{padding:3px 0;vertical-align:top}
.detalle .num{text-align:right;white-space:nowrap;padding-left:12px}
.detalle .sang{padding-left:clamp(12px,5vw,38px)}
.detalle .menos{display:inline-block;width:2.2em}
.detalle .tot span{font-weight:bold;text-decoration:underline}
.detalle .vacia td{height:10px}
.planillas{width:100%;border-collapse:collapse;margin:16px 0 20px}
.planillas th,.planillas td{border:1px solid #999;padding:6px 8px;vertical-align:top}
.planillas th{font-weight:bold}
.planillas .c{text-align:center}
.planillas .num{text-align:right;white-space:nowrap}
.planillas td.tot{text-align:right;font-weight:bold}
.fecha{margin:0 0 18px}
.firma-trab{height:84px;display:flex;align-items:flex-end;padding-left:14px}
.firma-trab img{max-height:84px;max-width:240px}
.linea{margin:0 0 4px}
.autoriza{display:flex;flex-direction:column;margin-top:26px}
.autoriza img{width:96px;height:auto}
.pie{border-top:1.5px solid red;margin-top:30px;padding-top:6px;text-align:center;font-size:11px}
`;
