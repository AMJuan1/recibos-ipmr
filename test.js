// Autoverificación: node test.js  (escribe muestra.pdf para revisión visual)
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync } from 'node:fs';
import { montoEnLetras, calcular, generarPdf } from './recibo.js';

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

const firma = readFileSync(new URL('./public/firma-autoriza.png', import.meta.url));
const pdf = await generarPdf({ ...r, firma });
assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
assert.equal((pdf.toString('latin1').match(/\/Type \/Page\b/g) || []).length, 1, 'el recibo debe ocupar una sola página');
writeFileSync('muestra.pdf', pdf);
console.log('ok');
