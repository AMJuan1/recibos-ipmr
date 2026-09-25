// Autoverificación: node test.js  (escribe muestra.pdf para revisión visual)
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync } from 'node:fs';
import { montoEnLetras, calcular, generarPdf } from './recibo.js';
import { montosDe, periodoDe, mapear, constanciasDe } from './planilla.js';
import { MESES as MESES_TEST } from './recibo.js';

const paginas = pdf => (pdf.toString('latin1').match(/\/Type \/Page\b/g) || []).length;

// Período: 1RA = 1 al 15; 2DA = 16 al último día del mes.
assert.deepEqual(periodoDe('1RA QUINCENA SEPTIEMBRE 2026'), { diaInicio: 1, diaFin: 15, mes: 'SEPTIEMBRE', anio: 2026 });
assert.deepEqual(periodoDe('2DA  QUINCENA AGOSTO 2026'), { diaInicio: 16, diaFin: 31, mes: 'AGOSTO', anio: 2026 });
assert.deepEqual(periodoDe('2NDA QUINCENA FEBRERO 2028'), { diaInicio: 16, diaFin: 29, mes: 'FEBRERO', anio: 2028 });
assert.equal(periodoDe('PLANILLA SIN FECHA'), null);

// Las columnas cambian de nombre entre hojas: lo que va antes de VIÁTICOS es renta de salario, lo de después de viáticos.
assert.deepEqual(montosDe({ 'SALARIO QUINCENAL': 1000, 'ISSS 3%': 15, 'AFP 7,25%': 72.5, RENTA: 122.98, 'DESC. PERSONAL': 0, 'SALARIO LIQUIDO': 789.52, 'VIÁTICOS': 500, RENTA_2: 50, 'TOTAL A PAGAR': 1239.52 }),
  { salario: 1000, iva: 0, descuento: 0, isss: 15, afp: 72.5, rentaSalario: 122.98, viaticos: 500, rentaViaticos: 50 });
assert.deepEqual(montosDe({ 'SERVICIOS PROFESIONALES': 500, 'MAS IVA': 65, RENTA: 50, 'DESCUENTO PERSONAL': 0, 'TOTAL A PAGAR': 515, VIATICOS: 80, RENTA_2: 8, 'TOTAL A PAGAR_2': 72 }),
  { salario: 500, iva: 65, descuento: 0, isss: 0, afp: 0, rentaSalario: 50, viaticos: 80, rentaViaticos: 8 });
assert.deepEqual(montosDe({ 'SALARIO QUINCENAL': 900, 'ISSS 3%': 15, 'AFP 7,25%': 65.25, 'RENTA SUELDO': 104.43, 'SALARIO LIQUIDO': 715.32, 'VIÁTICOS': 0, RENTA: 0, 'TOTAL A PAGAR': 715.32 }),
  { salario: 900, iva: 0, descuento: 0, isss: 15, afp: 65.25, rentaSalario: 104.43, viaticos: 0, rentaViaticos: 0 });

// mapear: proyecto por nombre de hoja y aviso cuando el total no coincide (IVA, descuentos).
const mapeado = mapear({
  planillas: [{ seccion: 'GRAL.', proyecto: 'PLANILLA GENERAL', periodo: '1RA QUINCENA SEPTIEMBRE 2026', cuadra: true }],
  personas: [
    { proyecto: 'PROYECTO EL CHANGALLO', periodo: '1RA QUINCENA SEPTIEMBRE 2026', empleado: 'ANA', puesto: 'ING.',
      montos: { 'SERVICIOS PROFESIONALES': 500, 'MAS IVA': 65, RENTA: 50 }, total_pagado: 515 },
    { proyecto: 'PROYECTO COMUNIDAD ITALIA', periodo: '1RA QUINCENA SEPTIEMBRE 2026', empleado: 'WUILLIAN', puesto: 'ING.',
      montos: { 'SALARIO QUINCENAL': 900, 'ISSS 3%': 15, 'AFP 7,25%': 65.25, 'RENTA SUELDO': 104.43, 'DESC. PERSONAL': 150 }, total_pagado: 565.32 },
    { proyecto: 'CONTRATO MOPT 126 /2026 COMUNIDAD ITALIA', periodo: '1RA QUINCENA SEPTIEMBRE 2026', empleado: 'LUIS', puesto: 'ING.',
      montos: { 'SALARIO QUINCENAL': 900, 'ISSS 3%': 15, 'AFP 7,25%': 65.25, 'RENTA SUELDO': 104.43 }, total_pagado: 715.32 },
  ],
});
assert.deepEqual(mapeado.periodo, { diaInicio: 1, diaFin: 15, mes: 'SEPTIEMBRE', anio: 2026 });
// El total del recibo tiene que ser el de la planilla, aunque las líneas impresas sumen un centavo menos.
const redondeo = mapear({ planillas: [], personas: [{ proyecto: 'PLANILLA GENERAL', periodo: '1RA QUINCENA SEPTIEMBRE 2026',
  empleado: 'ANGELICA', puesto: 'GTE.',
  montos: { 'SALARIO QUINCENAL': 450, 'ISSS 3%': 13.5, 'AFP 7,25%': 32.63, RENTA: 15.05, 'SALARIO LIQUIDO': 388.83,
            'VIÁTICOS': 200, RENTA_2: 20, 'TOTAL MENOS DESCUENTO': 180, 'TOTAL A PAGAR': 568.83 }, total_pagado: 568.83 }] }).trabajadores[0];
assert.equal(calcular(redondeo).total, 568.83);
assert.equal(calcular(redondeo).subSalario, 388.83);
assert.equal(redondeo.aviso, undefined);
// Si se edita un monto (sin subtotales de la planilla) se recalcula con las líneas.
assert.equal(calcular({ ...redondeo, subSalarioPlanilla: null, subViaticosPlanilla: null }).total, 568.82);
assert.equal(mapeado.trabajadores[0].proyecto, 'Changallo');
assert.equal(mapeado.trabajadores[0].aviso, undefined); // el IVA ya va como línea del recibo
assert.equal(mapeado.trabajadores[0].iva, 65);
assert.equal(mapeado.trabajadores[1].descuento, 150); // descuento personal también
assert.equal(mapeado.trabajadores[1].proyecto, 'Italia');
assert.equal(mapeado.trabajadores[1].aviso, undefined);
assert.equal(mapeado.trabajadores[2].aviso, undefined);

assert.equal(montoEnLetras(1500), 'UN MIL QUINIENTOS 00/100 DÓLARES');
assert.equal(montoEnLetras(1239.52), 'UN MIL DOSCIENTOS TREINTA Y NUEVE 52/100 DÓLARES');
assert.equal(montoEnLetras(100), 'CIEN 00/100 DÓLARES');
assert.equal(montoEnLetras(121.05), 'CIENTO VEINTIÚN 05/100 DÓLARES');
assert.equal(montoEnLetras(21000), 'VEINTIÚN MIL 00/100 DÓLARES');
assert.equal(montoEnLetras(0.5), 'CERO 50/100 DÓLARES');
assert.equal(montoEnLetras(2000001), 'DOS MILLONES UN 00/100 DÓLARES');

const r = {
  nombre: 'JOSÉ OTHMARO MORALES URBINA', proyecto: 'Oficina', cargo: 'GERENTE GENERAL',
  salario: 1000, isss: 15, afp: 72.5, rentaSalario: 122.98, viaticos: 500, rentaViaticos: 50,
  diaInicio: 16, diaFin: 31, mes: 'AGOSTO', anio: 2026, fechaEmision: '2026-08-31',
};
assert.deepEqual(calcular(r), { subSalario: 789.52, subViaticos: 450, total: 1239.52 });
// Con IVA y descuento personal (las dos líneas opcionales del recibo)
assert.deepEqual(calcular({ ...r, salario: 500, iva: 65, descuento: 0, isss: 0, afp: 0, rentaSalario: 50, viaticos: 0, rentaViaticos: 0 }),
  { subSalario: 515, subViaticos: 0, total: 515 });
assert.deepEqual(calcular({ ...r, salario: 900, isss: 15, afp: 65.25, rentaSalario: 104.43, descuento: 150, viaticos: 0, rentaViaticos: 0 }),
  { subSalario: 565.32, subViaticos: 0, total: 565.32 });

const firma = readFileSync(new URL('./public/firma-autoriza.png', import.meta.url));
const pdf = await generarPdf({ ...r, firma });
assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
assert.equal((pdf.toString('latin1').match(/\/Type \/Page\b/g) || []).length, 1, 'el recibo debe ocupar una sola página');
writeFileSync('muestra.pdf', pdf);

// El recibo más largo (con IVA y descuento personal) también debe caber en una página.
const pdfLargo = await generarPdf({ ...r, iva: 65, descuento: 150, firma });
assert.equal((pdfLargo.toString('latin1').match(/\/Type \/Page\b/g) || []).length, 1, 'el recibo con IVA y descuento debe caber en una página');
writeFileSync('muestra-completa.pdf', pdfLargo);
// ---------- constancias de varias planillas ----------
const planilla = (periodo, proyecto, gente) => ({
  personas: gente.map(([empleado, puesto, total]) => ({ empleado, puesto, proyecto, periodo, montos: {}, total_pagado: total })),
});
const agrupadas = constanciasDe([
  { nombre: 'agosto.xlsx', datos: planilla('2DA QUINCENA AGOSTO 2026', 'PROYECTO EL CHANGALLO', [['LUIS ARMANDO VAQUERO ALAS', 'TEC. AMBIENTAL', 450]]) },
  { nombre: 'agosto.xlsx', datos: planilla('2DA QUINCENA AGOSTO 2026', 'PROYECTO COMUNIDAD ITALIA', [['LUIS ARMANDO VAQUERO ALAS', 'TEC. AMBIENTAL', 450]]) },
  { nombre: 'julio.xlsx', datos: planilla('1RA QUINCENA JULIO 2026', 'PROYECTO EL CHANGALLO', [['LUIS ARMANDO VAQUERO ALAS', 'TEC. AMBIENTAL', 400]]) },
]);
// Una persona en dos proyectos -> dos constancias, cada una con lo suyo y en orden cronológico.
assert.equal(agrupadas.length, 2);
const changallo = agrupadas.find(p => p.proyecto === 'Changallo');
assert.deepEqual(changallo.lineas.map(l => l.concepto), ['1RA QUINCENA JULIO 2026', '2DA QUINCENA AGOSTO 2026']);
assert.equal(calcular({ tipo: 'constancia', lineas: changallo.lineas }).total, 850);
assert.equal(agrupadas.find(p => p.proyecto === 'Italia').lineas.length, 1);

// Dos hojas del mismo proyecto y período se distinguen en el texto de la fila.
const mismoPeriodo = constanciasDe([
  { nombre: 'sept.xlsx', datos: planilla('1RA QUINCENA SEPTIEMBRE 2026', 'PROYECTO COMUNIDAD ITALIA', [['ANA', 'ING.', 100]]) },
  { nombre: 'sept.xlsx', datos: planilla('1RA QUINCENA SEPTIEMBRE 2026', 'CONTRATO MOPT 126 /2026 COMUNIDAD ITALIA', [['ANA', 'ING.', 200]]) },
]);
assert.equal(mismoPeriodo.length, 1);
assert.match(mismoPeriodo[0].lineas[1].concepto, /CONTRATO MOPT/);

const constancia = {
  tipo: 'constancia', nombre: 'LUIS ARMANDO VAQUERO ALAS', cargo: 'TEC. AMBIENTAL', proyecto: 'Changallo',
  fechaEmision: '2026-09-25', lineas: changallo.lineas,
};
const pdfCon = await generarPdf({ ...constancia, firma });
assert.equal(pdfCon.subarray(0, 5).toString(), '%PDF-');
assert.equal(paginas(pdfCon), 1, 'una constancia corta cabe en una página');
writeFileSync('muestra-constancia.pdf', pdfCon);

// Con muchas planillas la tabla sigue en otra página, sin cortar el bloque de firmas.
const muchas = Array.from({ length: 26 }, (_, i) => ({ concepto: `${i % 2 ? '2DA' : '1RA'} QUINCENA ${MESES_TEST[i % 12]} 2025`, monto: 450 + i }));
const pdfLargoCon = await generarPdf({ ...constancia, lineas: muchas, firma });
assert.ok(paginas(pdfLargoCon) >= 2, 'con 26 planillas la constancia usa más de una página');
assert.equal(calcular({ tipo: 'constancia', lineas: muchas }).total, muchas.reduce((s, l) => s + l.monto, 0));
writeFileSync('muestra-constancia-larga.pdf', pdfLargoCon);

console.log('ok');
