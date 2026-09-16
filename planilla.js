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

// La planilla manda: Excel calcula con más decimales de los que imprime (AFP 32.625 -> 32.63),
// así que los subtotales se toman de sus columnas y no se recalculan. Solo se usan si suman el total de la hoja.
export function subtotalesDe(montos, lineas, totalPlanilla) {
  const clave = re => Object.keys(montos).find(k => re.test(k));
  const valor = k => (k === undefined ? null : Number(montos[k]) || 0);
  const subViaticos = valor(clave(/^TOTAL MENOS DESCUENTO/i))
    ?? Math.round((lineas.viaticos - lineas.rentaViaticos) * 100) / 100;
  const subSalario = valor(clave(/^SALARIO L[IÍ]QUIDO/i))
    ?? Math.round((totalPlanilla - subViaticos) * 100) / 100;
  const cuadra = Math.round((subSalario + subViaticos - totalPlanilla) * 100) === 0;
  return cuadra ? { subSalarioPlanilla: subSalario, subViaticosPlanilla: subViaticos } : null;
}

export function mapear(datos) {
  const avisos = [];
  for (const p of datos.planillas || [])
    if (!p.cuadra) avisos.push(`La hoja "${p.seccion}" no cuadra con su total (${p.total} vs ${p.total_declarado}).`);

  const periodos = new Set();
  const trabajadores = (datos.personas || []).map(p => {
    periodos.add(p.periodo);
    const lineas = montosDe(p.montos || {});
    const pagado = Number(p.total_pagado) || 0;
    const t = {
      nombre: p.empleado, proyecto: proyectoDe(p.proyecto), cargo: p.puesto || '',
      ...lineas, ...subtotalesDe(p.montos || {}, lineas, pagado),
    };
    // Si las líneas del recibo no llegan al total de la planilla, hay una columna que el recibo no contempla.
    const total = calcular(t).total, sinSubtotales = calcular({ ...t, subSalarioPlanilla: null, subViaticosPlanilla: null }).total;
    if (Math.round((total - pagado) * 100))
      t.aviso = `El total del recibo ($${total.toFixed(2)}) no coincide con la planilla ($${pagado.toFixed(2)}): revise las columnas de esa fila.`;
    else if (Math.abs(Math.round((sinSubtotales - pagado) * 100)) > 2)
      t.aviso = `Las líneas suman $${sinSubtotales.toFixed(2)} pero la planilla paga $${pagado.toFixed(2)}: revise las columnas de esa fila.`;
    return t;
  });

  if (periodos.size > 1) avisos.push(`El archivo trae más de un período (${[...periodos].join(', ')}); se usó el primero.`);
  return { periodo: periodoDe([...periodos][0] || ''), trabajadores, avisos };
}
