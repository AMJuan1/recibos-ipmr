// Traduce la salida del extractor de planillas (extractor/planillas.py) a los campos del recibo.
import { spawn } from 'node:child_process';
import { MESES, calcular } from './recibo.js';

const PYTHON = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');

export function extraerPlanilla(archivo, nombre) {
  return new Promise((ok, fail) => {
    const py = spawn(PYTHON, ['extraer.py', nombre], { cwd: 'extractor' });
    let salida = '', error = '';
    py.stdout.on('data', d => salida += d);
    py.stderr.on('data', d => error += d);
    py.on('error', e => fail(new Error(`No se pudo ejecutar ${PYTHON}: ${e.message}`)));
    py.on('close', code => {
      if (code !== 0) return fail(new Error(error.trim().split('\n').pop() || `El extractor falló (código ${code})`));
      try { ok(JSON.parse(salida)); } catch { fail(new Error('El extractor no devolvió JSON válido')); }
    });
    py.stdin.end(archivo);
  });
}

const proyectoDe = p => /CHANGALLO/i.test(p) ? 'Changallo' : /ITALIA/i.test(p) ? 'Italia' : 'Oficina';

// "2DA QUINCENA AGOSTO 2026" -> { diaInicio: 16, diaFin: 31, mes: 'AGOSTO', anio: 2026 }
export function periodoDe(texto = '') {
  const m = /(\d)\s*(?:RA|DA|NDA|ERA|º|°)?\s*QUINCENA\s+(?:DE\s+)?([A-ZÁÉÍÓÚÑ]+)\s+(\d{4})/i.exec(texto.normalize('NFC'));
  if (!m) return null;
  const mes = m[2].toUpperCase(), anio = Number(m[3]);
  if (!MESES.includes(mes)) return null;
  return m[1] === '1'
    ? { diaInicio: 1, diaFin: 15, mes, anio }
    : { diaInicio: 16, diaFin: new Date(anio, MESES.indexOf(mes) + 1, 0).getDate(), mes, anio };
}

// Las columnas cambian de nombre entre hojas ("RENTA" es del salario en unas y de viáticos en otras),
// así que se reparten por posición: lo que está antes de VIÁTICOS es del salario, lo de después es de viáticos.
export function montosDe(montos) {
  const claves = Object.keys(montos);
  const busca = re => claves.findIndex(k => re.test(k));
  const iViaticos = busca(/^VI[ÁA]TICOS/i);
  const rentas = claves.map((k, i) => [k, i]).filter(([k]) => /^RENTA/i.test(k));
  const monto = k => (k === undefined ? 0 : Number(montos[k]) || 0);
  const en = i => (i < 0 ? undefined : claves[i]);
  const antes = rentas.find(([, i]) => iViaticos < 0 || i < iViaticos);
  const despues = iViaticos < 0 ? undefined : rentas.find(([, i]) => i > iViaticos);
  return {
    salario: monto(en(busca(/^(SALARIO QUINCENAL|SERVICIOS PROFESIONALES)/i))),
    iva: monto(en(busca(/^(MAS\s+)?IVA/i))),
    descuento: monto(en(busca(/^DESC/i))),
    isss: monto(en(busca(/^ISSS/i))),
    afp: monto(en(busca(/^AFP/i))),
    rentaSalario: monto(antes?.[0]),
    viaticos: monto(en(iViaticos)),
    rentaViaticos: monto(despues?.[0]),
  };
}

export function mapear(datos) {
  const avisos = [];
  for (const p of datos.planillas || [])
    if (!p.cuadra) avisos.push(`La hoja "${p.seccion}" no cuadra con su total (${p.total} vs ${p.total_declarado}).`);

  const periodos = new Set();
  const trabajadores = (datos.personas || []).map(p => {
    periodos.add(p.periodo);
    const t = {
      nombre: p.empleado, proyecto: proyectoDe(p.proyecto), cargo: p.puesto || '',
      ...montosDe(p.montos || {}),
    };
    // El recibo no tiene línea de IVA ni de descuento personal: si la planilla las usa, el total no coincide.
    const total = calcular(t).total, pagado = Number(p.total_pagado) || 0;
    const centavos = Math.round((total - pagado) * 100);
    if (centavos) t.aviso = Math.abs(centavos) <= 2
      ? `Diferencia de redondeo de $${(Math.abs(centavos) / 100).toFixed(2)} contra la planilla ($${pagado.toFixed(2)}).`
      : `El total del recibo ($${total.toFixed(2)}) no coincide con la planilla ($${pagado.toFixed(2)}): revise IVA o descuentos.`;
    return t;
  });

  if (periodos.size > 1) avisos.push(`El archivo trae más de un período (${[...periodos].join(', ')}); se usó el primero.`);
  return { periodo: periodoDe([...periodos][0] || ''), trabajadores, avisos };
}
