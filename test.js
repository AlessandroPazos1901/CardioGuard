/* Verificación de la lógica clínica.  Ejecutar:  node test.js
 * Sin framework a propósito: si esto pasa, los umbrales están bien.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const T = require('./www/triage.js');

let n = 0;
function check(name, fn) { fn(); n++; }

// Azúcar: clasifica CCHD y devuelve solo el nivel.
const cchd = (altitude, pre, post, priorYellows) =>
  T.classifyCCHD({ altitude, pre, post, priorYellows }).level;

// ============================================================================
// MODELO 1 — estratos CCHD.  Se prueban los bordes de cada banda, que es donde
// la tabla anterior estaba mal.
// ============================================================================

check('estrato 0–1599: pase 95 / crítico 90', () => {
  assert.strictEqual(cchd(0, 95, 95), 'green');
  assert.strictEqual(cchd(0, 96, 98), 'green');
  assert.strictEqual(cchd(0, 94, 95), 'yellow');   // min < pase
  assert.strictEqual(cchd(0, 90, 90), 'yellow');   // borde inferior de repetir
  assert.strictEqual(cchd(0, 89, 95), 'red');      // min < crítico
  assert.strictEqual(cchd(1599, 95, 95), 'green');
  // La sub-regla de 93 % NO debe filtrarse por debajo de 1600 m.
  assert.strictEqual(cchd(1599, 93, 93), 'yellow');
});

check('estrato 1600–2499: sub-regla de pase 93', () => {
  assert.strictEqual(cchd(1600, 93, 93), 'green');
  assert.strictEqual(cchd(2499, 93, 93), 'green');
  assert.strictEqual(cchd(1600, 92, 92), 'yellow');
  assert.strictEqual(cchd(1600, 89, 93), 'red');
  assert.strictEqual(cchd(2000, 90, 90), 'yellow'); // el estrato viejo lo aprobaba
});

check('estrato 2500–3599: pase 90 / crítico 87', () => {
  assert.strictEqual(cchd(2500, 90, 90), 'green');
  assert.strictEqual(cchd(3599, 90, 92), 'green');
  assert.strictEqual(cchd(2500, 89, 89), 'yellow');
  assert.strictEqual(cchd(2500, 87, 87), 'yellow');
  assert.strictEqual(cchd(2500, 86, 90), 'red');
  assert.strictEqual(cchd(3259, 88, 88), 'yellow'); // Huancayo
});

check('estrato 3600–4500: pase 89 / crítico 85', () => {
  assert.strictEqual(cchd(3600, 89, 89), 'green');
  assert.strictEqual(cchd(4500, 89, 90), 'green');
  assert.strictEqual(cchd(3600, 88, 88), 'yellow');
  assert.strictEqual(cchd(3600, 85, 85), 'yellow');
  assert.strictEqual(cchd(3600, 84, 90), 'red');
  assert.strictEqual(cchd(3827, 88, 89), 'yellow'); // Puno
});

check('> 4500 msnm reutiliza umbrales pero marca fuera de rango', () => {
  const r = T.classifyCCHD({ altitude: 4600, pre: 89, post: 89 });
  assert.strictEqual(r.level, 'green');
  assert.strictEqual(r.unvalidatedAltitude, true);
  assert.strictEqual(T.classifyCCHD({ altitude: 4000, pre: 89, post: 89 }).unvalidatedAltitude, false);
});

check('el diferencial > 3 impide el pase aunque ambas saturen bien', () => {
  assert.strictEqual(cchd(0, 99, 95), 'yellow');      // min 95 pero dif 4
  assert.strictEqual(cchd(0, 99, 96), 'green');       // dif 3 justo
  assert.strictEqual(cchd(3600, 95, 90), 'yellow');   // min 90 >= 89, dif 5
  assert.strictEqual(T.classifyCCHD({ altitude: 0, pre: 99, post: 95 }).reason, 'diferencial');
});

check('el crítico manda sobre el diferencial', () => {
  // min por debajo del crítico y además diferencial alto => rojo, no amarillo.
  assert.strictEqual(cchd(0, 98, 85), 'red');
});

check('pre y post son simétricos: da igual cuál venga bajo', () => {
  assert.strictEqual(cchd(2500, 86, 95), cchd(2500, 95, 86));
  assert.strictEqual(cchd(0, 89, 99), 'red');
});

check('3.ª repetición consecutiva escala a positivo', () => {
  assert.strictEqual(cchd(0, 92, 92, 0), 'yellow');   // intento 1
  assert.strictEqual(cchd(0, 92, 92, 1), 'yellow');   // intento 2
  const r = T.classifyCCHD({ altitude: 0, pre: 92, post: 92, priorYellows: 2 });
  assert.strictEqual(r.level, 'red');                 // intento 3
  assert.strictEqual(r.escalated, true);
  assert.strictEqual(r.reason, 'escalado');
  assert.strictEqual(r.attempt, 3);
});

check('la escalada no convierte un verde ni altera un rojo', () => {
  const verde = T.classifyCCHD({ altitude: 0, pre: 97, post: 97, priorYellows: 2 });
  assert.strictEqual(verde.level, 'green');
  assert.strictEqual(verde.escalated, false);
  const rojo = T.classifyCCHD({ altitude: 0, pre: 80, post: 80, priorYellows: 2 });
  assert.strictEqual(rojo.reason, 'critico');         // crítico real, no escalado
  assert.strictEqual(rojo.escalated, false);
});

check('un tamizaje negativo con signos clínicos NO autoriza el alta', () => {
  // El caso que se escapaba: saturación perfecta y un bebé cianótico.
  const conSignos = T.classifyCCHD({ altitude: 154, pre: 97, post: 96, signs: true });
  assert.strictEqual(conSignos.level, 'green');        // la saturación sí es normal
  assert.strictEqual(conSignos.clinicalOverride, true);
  assert.strictEqual(conSignos.dischargeBlocked, true); // pero el alta se bloquea

  const sinSignos = T.classifyCCHD({ altitude: 154, pre: 97, post: 96, signs: false });
  assert.strictEqual(sinSignos.clinicalOverride, false);
  assert.strictEqual(sinSignos.dischargeBlocked, false);
});

check('los signos no cambian el nivel, solo la conducta', () => {
  // Un cribado mide saturación: si el algoritmo dice negativo, dice negativo.
  const a = T.classifyCCHD({ altitude: 154, pre: 97, post: 96, signs: true });
  const b = T.classifyCCHD({ altitude: 154, pre: 97, post: 96, signs: false });
  assert.strictEqual(a.level, b.level);
  assert.strictEqual(a.reason, b.reason);
  // Y donde ya estaba bloqueado, sigue bloqueado con o sin signos.
  assert.strictEqual(T.classifyCCHD({ altitude: 154, pre: 92, post: 92 }).dischargeBlocked, true);
  assert.strictEqual(T.classifyCCHD({ altitude: 154, pre: 88, post: 95 }).dischargeBlocked, true);
  assert.strictEqual(T.classifyCCHD({ altitude: 154, pre: 88, post: 95, signs: true }).clinicalOverride, false);
});

check('la adaptación normal con signos tampoco pasa de largo', () => {
  // 3399 m, 10 min: p10 local = 71.1, así que 75 es verde.
  const con = T.classifyAdaptation({ altitude: 3399, minutes: 10, spo2: 75, signs: true });
  const sin = T.classifyAdaptation({ altitude: 3399, minutes: 10, spo2: 75, signs: false });
  assert.strictEqual(con.level, 'green');
  assert.strictEqual(con.clinicalOverride, true);
  assert.strictEqual(sin.clinicalOverride, false);
});

// ============================================================================
// MODELO 2 — adaptación (< 24 h)
// ============================================================================

const adapt = (altitude, minutes, spo2, signs) =>
  T.classifyAdaptation({ altitude, minutes, spo2, signs }).level;

check('a nivel del mar sigue la tabla sin desplazar', () => {
  // 10 min: p3 = 80, p10 = 83
  assert.strictEqual(adapt(0, 10, 85), 'green');
  assert.strictEqual(adapt(0, 10, 83), 'green');   // borde p10
  assert.strictEqual(adapt(0, 10, 81), 'yellow');
  assert.strictEqual(adapt(0, 10, 80), 'yellow');  // borde p3
  assert.strictEqual(adapt(0, 10, 79), 'red');
});

check('la altitud desplaza los umbrales hacia abajo', () => {
  // 3600 m => delta = 12.6 ; p3 = 67.4 , p10 = 70.4
  const th = T.adaptationThresholds(10, 3600);
  assert.ok(Math.abs(th.delta - 12.6) < 1e-9);
  assert.ok(Math.abs(th.p3 - 67.4) < 1e-9);
  assert.strictEqual(adapt(3600, 10, 72), 'green');
  assert.strictEqual(adapt(3600, 10, 68), 'yellow');
  assert.strictEqual(adapt(3600, 10, 66), 'red');
  // Una lectura que a nivel del mar sería roja, en altura puede ser normal.
  assert.strictEqual(adapt(0, 10, 72), 'red');
});

check('el piso impide umbrales sin sentido clínico', () => {
  // 5000 m y 1 min: 55 − 17.5 = 37.5 => se limita a 50
  const th = T.adaptationThresholds(1, 5000);
  assert.strictEqual(th.p3, T.CAL.SPO2_FLOOR);
  assert.strictEqual(th.floored, true);
  assert.strictEqual(T.adaptationThresholds(10, 0).floored, false);
});

check('interpolación entre filas de la tabla', () => {
  // 35 min está a la mitad entre 10 min (p3 80) y 60 min (p3 85)
  const th = T.adaptationRef(35);
  assert.ok(th.p3 > 80 && th.p3 < 85);
  assert.ok(Math.abs(th.p3 - 82.5) < 1e-9);
  // Fuera de rango se satura en los extremos.
  assert.strictEqual(T.adaptationRef(0).p3, 55);
  assert.strictEqual(T.adaptationRef(99999).p3, 90);
});

check('los signos clínicos cambian la conducta ante un rojo', () => {
  const conSignos = T.classifyAdaptation({ altitude: 0, minutes: 10, spo2: 70, signs: true });
  const sinSignos = T.classifyAdaptation({ altitude: 0, minutes: 10, spo2: 70, signs: false });
  assert.strictEqual(conSignos.level, 'red');
  assert.strictEqual(sinSignos.level, 'red');          // el nivel no cambia
  assert.strictEqual(conSignos.reason, 'hipoxemia_con_signos');
  assert.strictEqual(sinSignos.reason, 'verificar_perfusion');
  assert.strictEqual(conSignos.repeatMin, 0);          // no se espera
  assert.strictEqual(sinSignos.repeatMin, T.CAL.RECHECK_MIN_PERFUSION);
});

check('marca lecturas por debajo del rango fiable del oxímetro', () => {
  assert.strictEqual(T.classifyAdaptation({ altitude: 3600, minutes: 5, spo2: 65 }).unreliable, true);
  assert.strictEqual(T.classifyAdaptation({ altitude: 0, minutes: 60, spo2: 95 }).unreliable, false);
});

// ============================================================================
// La frontera entre modelos
// ============================================================================

check('el enrutado por edad elige un solo modelo', () => {
  assert.strictEqual(T.modeForMinutes(0), 'adaptation');
  assert.strictEqual(T.modeForMinutes(1439), 'adaptation');
  assert.strictEqual(T.modeForMinutes(1440), 'cchd');   // 24 h justas
  assert.strictEqual(T.modeForMinutes(5000), 'cchd');
  assert.strictEqual(T.modeForMinutes(-1), null);       // nacimiento en el futuro
  assert.strictEqual(T.modeForMinutes(NaN), null);
});

check('los modelos no se corrigen dos veces por altitud', () => {
  // Este es el error que se está evitando: a 3600 m el umbral crítico de CCHD
  // es 85 y el del modelo lineal a las 24 h sería 77.4. Si el tamizaje usara
  // el modelo lineal, un neonato al 80 % pasaría como normal.
  const stratum = T.getStratum(3600);
  assert.strictEqual(stratum.critical, 85);

  const lineal = T.adaptationThresholds(1440, 3600).p3;
  assert.ok(Math.abs(lineal - 77.4) < 1e-9);
  assert.ok(stratum.critical - lineal > 7);

  // El tamizaje CCHD debe seguir marcando rojo al 80 %.
  assert.strictEqual(cchd(3600, 80, 80), 'red');
});

check('los dos modelos coinciden a nivel del mar a las 24 h', () => {
  // Sanidad del modelo lineal: sin altitud, su p3 a 1440 min (90) cae justo en
  // el umbral crítico del estrato bajo (90). Es la razón por la que la
  // discrepancia de arriba se atribuye a la altitud y no a la tabla.
  assert.strictEqual(T.adaptationThresholds(1440, 0).p3, 90);
  assert.strictEqual(T.getStratum(0).critical, 90);
});

// ============================================================================
// ALMACENAMIENTO
// Node no trae localStorage, así que se sustituye por uno en memoria antes de
// cargar el módulo. Permite además simular la cuota llena.
// ============================================================================
class MemStorage {
  constructor(limit = Infinity) { this.map = new Map(); this.limit = limit; }
  _size(skipKey) {
    let n = 0;
    for (const [k, v] of this.map) if (k !== skipKey) n += k.length + v.length;
    return n;
  }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) {
    v = String(v);
    if (this._size(k) + k.length + v.length > this.limit) {
      const e = new Error('QuotaExceededError');
      e.name = 'QuotaExceededError';
      throw e;
    }
    this.map.set(k, v);
  }
  removeItem(k) { this.map.delete(k); }
  key(i) { return [...this.map.keys()][i]; }
  get length() { return this.map.size; }
}

globalThis.localStorage = new MemStorage();
const S = require('./www/store.js');

const CUI = 'RN-QUISPE';
const CUI2 = 'RN-HUAMAN';

const sampleEval = (over = {}) => Object.assign({
  cui: CUI, dniMadre: '12345678', birthDate: '2026-08-12', birthTime: '10:00',
  minutesOfLife: 1800, model: 'cchd', altitude: 3399, locationName: 'C.S. Cusco - Wanchaq',
  altitudeSource: 'GPS', pre: 86, post: 88, diff: 2, level: 'red', reason: 'critico',
  attempt: 1, escalated: false, passThreshold: 90, criticalThreshold: 87,
  stratumLabel: '2500–3599 msnm', signs: ['Cianosis'], hardware: 'neonatal',
  unvalidatedAltitude: false, unreliable: false, calibration: { K_ALT: 0.0035 }
}, over);

check('valida y normaliza el código RN-APELLIDO_PADRE', () => {
  assert.strictEqual(S.isValidPatientCode('RN-QUISPE'), true);
  assert.strictEqual(S.isValidPatientCode('RN-DE_LA_CRUZ'), true);
  assert.strictEqual(S.isValidPatientCode('rn-de la cruz'), true);
  assert.strictEqual(S.isValidPatientCode('RN-Q'), false);
  assert.strictEqual(S.isValidPatientCode('RN-QUISPE123'), false);
  assert.strictEqual(S.isValidCui(''), false);
  assert.strictEqual(S.isValidCui('ABC12345'), false);
  assert.strictEqual(S.normalizePatientCode(' rn-de la cruz '), 'RN-DE_LA_CRUZ');
  // Los identificadores numéricos anteriores siguen siendo legibles.
  assert.strictEqual(S.isValidCui('1234567890'), true);
});

check('genera un identificador corto que distingue recién nacidos con el mismo apellido', () => {
  S.clear();
  const first = S.generatePatientCode('Quispe', () => 0);
  assert.strictEqual(first, 'RN-QUISPE-AAAA');
  assert.strictEqual(S.RN_UNIQUE_CODE_PATTERN.test(first), true);
  S.upsertChild({ cui: first });
  const values = [0, 0, 0, 0, 0.5, 0.5, 0.5, 0.5];
  const second = S.generatePatientCode('RN-QUISPE', () => values.shift() || 0);
  assert.notStrictEqual(second, first);
  assert.strictEqual(S.RN_UNIQUE_CODE_PATTERN.test(second), true);
});

check('el DNI de la madre son 8 dígitos exactos', () => {
  assert.strictEqual(S.DNI_LENGTH, 8);
  assert.strictEqual(S.isValidDni('12345678'), true);
  assert.strictEqual(S.isValidDni('00123456'), true);   // puede empezar por cero
  assert.strictEqual(S.isValidDni('1234567'), false);   // corto
  assert.strictEqual(S.isValidDni('123456789'), false); // largo
  assert.strictEqual(S.isValidDni(''), false);
  assert.strictEqual(S.isValidDni('1234567A'), false);
  assert.strictEqual(S.normalizeDni('1234-5678'), '12345678');
  assert.strictEqual(S.normalizeDni('  123 456 78 '), '12345678');
});

check('normalizar no recorta códigos ni DNI', () => {
  assert.strictEqual(S.normalizeCui('123456789012345').length, 15);
  assert.strictEqual(S.isValidCui('123456789012345'), false);
  assert.strictEqual(S.normalizeDni('123456789').length, 9);
  assert.strictEqual(S.isValidDni('123456789'), false);
  assert.strictEqual(S.RN_CODE_MAX, 48);
});

check('el niño se crea una sola vez aunque se registre varias veces', () => {
  S.clear();
  const a = S.upsertChild({ cui: CUI, dniMadre: '12345678', birthDate: '2026-08-12', birthTime: '10:00' });
  assert.strictEqual(a.ok, true);
  assert.strictEqual(a.isNew, true);
  const b = S.upsertChild({ cui: CUI, dniMadre: '12345678' });
  assert.strictEqual(b.isNew, false);
  assert.strictEqual(S.allChildren().length, 1);
});

check('actualizar la ficha no borra los datos que ya tenía', () => {
  S.clear();
  S.upsertChild({ cui: CUI, dniMadre: '12345678', birthDate: '2026-08-12', birthTime: '10:00' });
  // Una evaluación posterior que no trae fecha de nacimiento no debe vaciarla.
  S.upsertChild({ cui: CUI, dniMadre: '', birthDate: '', birthTime: '' });
  const c = S.getChild(CUI);
  assert.strictEqual(c.birthDate, '2026-08-12');
  assert.strictEqual(c.birthTime, '10:00');
  assert.strictEqual(c.dniMadre, '12345678');
});

check('un código RN inválido no crea ficha ni evaluación', () => {
  S.clear();
  assert.strictEqual(S.upsertChild({ cui: 'XX' }).ok, false);
  assert.strictEqual(S.saveEvaluation(sampleEval({ cui: 'XX' })).ok, false);
  assert.strictEqual(S.allChildren().length, 0);
  assert.strictEqual(S.allEvaluations().length, 0);
});

check('un niño acumula varias evaluaciones numeradas en orden', () => {
  S.clear();
  S.upsertChild({ cui: CUI, dniMadre: '12345678' });
  S.saveEvaluation(sampleEval({ pre: 86 }));
  S.saveEvaluation(sampleEval({ pre: 88 }));
  S.saveEvaluation(sampleEval({ pre: 91 }));

  const evs = S.evaluationsFor(CUI);
  assert.strictEqual(evs.length, 3);
  assert.deepStrictEqual(evs.map(e => e.seq), [1, 2, 3]);
  assert.deepStrictEqual(evs.map(e => e.pre), [86, 88, 91]);
  assert.strictEqual(new Set(evs.map(e => e.id)).size, 3);
});

check('las evaluaciones de un niño no se mezclan con las de otro', () => {
  S.clear();
  S.upsertChild({ cui: CUI });
  S.upsertChild({ cui: CUI2 });
  S.saveEvaluation(sampleEval({ cui: CUI, pre: 86 }));
  S.saveEvaluation(sampleEval({ cui: CUI2, pre: 95 }));
  S.saveEvaluation(sampleEval({ cui: CUI, pre: 88 }));

  assert.strictEqual(S.evaluationsFor(CUI).length, 2);
  assert.strictEqual(S.evaluationsFor(CUI2).length, 1);
  // La numeración es por niño, no global.
  assert.deepStrictEqual(S.evaluationsFor(CUI).map(e => e.seq), [1, 2]);
  assert.deepStrictEqual(S.evaluationsFor(CUI2).map(e => e.seq), [1]);
});

check('la evaluación conserva copia de los datos del momento', () => {
  S.clear();
  S.upsertChild({ cui: CUI, dniMadre: '11111111' });
  S.saveEvaluation(sampleEval({ dniMadre: '11111111' }));
  // Se corrige el DNI de la madre más adelante.
  S.upsertChild({ cui: CUI, dniMadre: '22222222' });
  assert.strictEqual(S.getChild(CUI).dniMadre, '22222222');
  // El registro clínico anterior mantiene lo que se usó entonces.
  assert.strictEqual(S.evaluationsFor(CUI)[0].dniMadre, '11111111');
});

check('el resumen por niño cuenta y ordena por última evaluación', () => {
  S.clear();
  S.upsertChild({ cui: CUI });
  S.upsertChild({ cui: CUI2 });
  S.saveEvaluation(sampleEval({ cui: CUI, level: 'yellow' }));
  S.saveEvaluation(sampleEval({ cui: CUI, level: 'red' }));
  S.saveEvaluation(sampleEval({ cui: CUI2, level: 'green' }));

  const res = S.childSummaries();
  assert.strictEqual(res.length, 2);
  const uno = res.filter(r => r.child.cui === CUI)[0];
  assert.strictEqual(uno.count, 2);
  assert.strictEqual(uno.lastLevel, 'red');
  assert.strictEqual(uno.pending, 2);
});

check('borrar un niño arrastra sus evaluaciones y respeta las demás', () => {
  S.clear();
  S.upsertChild({ cui: CUI });
  S.upsertChild({ cui: CUI2 });
  S.saveEvaluation(sampleEval({ cui: CUI }));
  S.saveEvaluation(sampleEval({ cui: CUI2 }));

  S.removeChild(CUI);
  assert.strictEqual(S.allChildren().length, 1);
  assert.strictEqual(S.evaluationsFor(CUI).length, 0);
  assert.strictEqual(S.evaluationsFor(CUI2).length, 1);
});

check('exportar marca y separa pendientes de exportados', () => {
  S.clear();
  S.upsertChild({ cui: CUI });
  const a = S.saveEvaluation(sampleEval({ pre: 90 })).record;
  S.saveEvaluation(sampleEval({ pre: 91 }));
  assert.strictEqual(S.pending().length, 2);
  assert.strictEqual(S.exported().length, 0);

  S.markExported([a.id]);
  assert.strictEqual(S.pending().length, 1);
  assert.strictEqual(S.exported().length, 1);
  assert.strictEqual(S.exported()[0].pre, 90);

  // Volver a marcar no debe reescribir la fecha original.
  const stamp = S.exported()[0].exportedAt;
  S.markExported([a.id]);
  assert.strictEqual(S.exported()[0].exportedAt, stamp);
});

check('una cuota llena informa el fallo en vez de perder el registro', () => {
  const real = globalThis.localStorage;
  globalThis.localStorage = new MemStorage(200); // caben muy pocos bytes
  const res = S.saveEvaluation(sampleEval());
  assert.strictEqual(res.ok, false);
  assert.match(res.error, /lleno/);
  globalThis.localStorage = real;
});

check('un JSON corrupto no borra los datos: los aparta', () => {
  const real = globalThis.localStorage;
  const mem = new MemStorage();
  globalThis.localStorage = mem;
  mem.setItem(S.K_EVALS, '{esto no es json');
  assert.deepStrictEqual(S.allEvaluations(), []);   // no revienta
  const apartado = [...mem.map.keys()].find(k => k.includes('corrupt'));
  assert.ok(apartado, 'debe conservar una copia del valor corrupto');
  assert.strictEqual(mem.getItem(apartado), '{esto no es json');
  globalThis.localStorage = real;
});

check('sin almacenamiento disponible no lanza excepción', () => {
  const real = globalThis.localStorage;
  globalThis.localStorage = null;
  assert.strictEqual(S.available(), false);
  assert.deepStrictEqual(S.allEvaluations(), []);
  assert.deepStrictEqual(S.allChildren(), []);
  assert.strictEqual(S.saveEvaluation(sampleEval()).ok, false);
  globalThis.localStorage = real;
});

check('el CSV escapa comas, comillas y saltos de línea', () => {
  S.clear();
  S.upsertChild({ cui: CUI });
  S.saveEvaluation(sampleEval({ locationName: 'Puesto "El Alto", Puno' }));
  const csv = S.toCSV(S.allEvaluations());
  const lines = csv.split('\r\n');
  assert.ok(lines[0].startsWith('﻿' + 'codigo_recien_nacido,'), 'lleva BOM y empieza por el código RN');
  assert.ok(csv.includes('"Puesto ""El Alto"", Puno"'));
  // La fila no debe partirse: cabecera + 1 registro + línea final vacía.
  assert.strictEqual(lines.length, 3);
});

check('el CSV tiene una columna por cada campo declarado', () => {
  S.clear();
  S.upsertChild({ cui: CUI });
  S.saveEvaluation(sampleEval());
  const [head, row] = S.toCSV(S.allEvaluations()).split('\r\n');
  assert.strictEqual(head.split(',').length, S.COLUMNS.length);
  assert.strictEqual(row.split(',').length, S.COLUMNS.length);
});

check('el CSV distingue los dos modelos y trae el código RN', () => {
  S.clear();
  S.upsertChild({ cui: CUI });
  S.saveEvaluation(sampleEval({ model: 'cchd' }));
  S.saveEvaluation(sampleEval({ model: 'adaptation', post: null, diff: null, pre: 75 }));
  const csv = S.toCSV(S.allEvaluations());
  assert.ok(csv.includes('tamizaje_cchd'));
  assert.ok(csv.includes('adaptacion'));
  assert.ok(csv.includes(CUI));
});

S.clear();
// ============================================================================
// ESTABLECIMIENTOS Y DERIVACIÓN
// ============================================================================
const EE = require('./www/eess.js');

check('la distancia entre ciudades conocidas es plausible', () => {
  // Lima–Cusco son unos 570 km en línea recta.
  const limaCusco = EE.haversineKm(-12.046, -77.043, -13.532, -71.967);
  assert.ok(limaCusco > 520 && limaCusco < 620, 'Lima–Cusco fuera de rango: ' + limaCusco);
  // El mismo punto contra sí mismo es cero.
  assert.strictEqual(Math.round(EE.haversineKm(-12.046, -77.043, -12.046, -77.043)), 0);
  // Simétrica.
  assert.ok(Math.abs(
    EE.haversineKm(-12.046, -77.043, -15.840, -70.028) -
    EE.haversineKm(-15.840, -70.028, -12.046, -77.043)
  ) < 1e-9);
});

check('los centros de referencia se ordenan por cercanía real', () => {
  // Desde Cusco, lo más cercano debe ser de Cusco, no Lima.
  const desdeCusco = EE.nearest({ lat: -13.532, lon: -71.967, limit: 3 });
  assert.strictEqual(desdeCusco[0].eess.departamento, 'Cusco');
  assert.ok(desdeCusco[0].km < 20);
  // Y las distancias vienen en orden ascendente.
  for (let i = 1; i < desdeCusco.length; i++) {
    assert.ok(desdeCusco[i].km >= desdeCusco[i - 1].km);
  }
  // Desde Puno, el primero no puede ser de Lima.
  assert.notStrictEqual(EE.nearest({ lat: -15.840, lon: -70.028, limit: 1 })[0].eess.departamento, 'Lima');
});

check('la cardiología pediátrica se ofrece aunque quede lejísimos', () => {
  // Desde Cusco, los cinco más cercanos son todos de pediatría: si solo se
  // ordenara por distancia, el centro especializado no aparecería nunca.
  const soloDistancia = EE.nearest({ lat: -13.532, lon: -71.967, limit: 5 });
  assert.ok(!soloDistancia.some(r => r.cardioPed), 'premisa: por distancia no sale ninguno');

  const especializados = EE.nearest({ lat: -13.532, lon: -71.967, cap: 'cardio_ped', limit: 2 });
  assert.ok(especializados.length >= 1);
  assert.ok(especializados.every(r => r.cardioPed));

  // Y la lista de apoyo no repite los especializados.
  const cercanos = EE.nearest({ lat: -13.532, lon: -71.967, cap: 'pediatria', excludeCap: 'cardio_ped', limit: 3 });
  assert.ok(cercanos.every(r => !r.cardioPed));
  const nombresEsp = especializados.map(r => r.eess.nombre);
  assert.ok(cercanos.every(r => nombresEsp.indexOf(r.eess.nombre) === -1));
});

check('sin coordenadas no se inventa una distancia', () => {
  const sinGps = EE.nearest({ limit: 3 });
  assert.strictEqual(sinGps[0].km, null);
  // Sin ubicación, manda la referencia especializada.
  assert.strictEqual(sinGps[0].cardioPed, true);
  // Con departamento pero sin coordenadas, prioriza el propio departamento.
  const conDep = EE.nearest({ departamento: 'Puno', limit: 3 });
  assert.strictEqual(conDep[0].eess.departamento, 'Puno');
  assert.strictEqual(conDep[0].km, null);
});

check('la lista de derivación nunca ofrece un puesto de origen', () => {
  const todos = EE.nearest({ lat: -12.046, lon: -77.043, limit: 50 });
  todos.forEach(r => {
    assert.strictEqual(r.eess.capacidad.indexOf('origen'), -1,
      'un puesto de origen no puede ser destino de referencia: ' + r.eess.nombre);
  });
  // Y sí existen puestos de origen, para el selector de altitud.
  assert.ok(EE.origins().length > 0);
  EE.origins().forEach(e => assert.ok(typeof e.altitud === 'number' && typeof e.lat === 'number'));
});

check('hay al menos un centro con cardiología pediátrica y se puede resolver por código', () => {
  const cardio = EE.byCapacity('cardio_ped');
  assert.ok(cardio.length >= 1);
  const uno = EE.byCode(cardio[0].codigo);
  assert.strictEqual(uno.nombre, cardio[0].nombre);
  assert.strictEqual(EE.byCode('no-existe'), null);
});

check('ningún establecimiento lleva teléfono inventado', () => {
  // Un número falso en una app clínica es peor que ninguno.
  EE.EESS.forEach(e => {
    assert.strictEqual(e.telefono, null, e.nombre + ' tiene un teléfono sin verificar');
    assert.ok(e.codigo && e.nombre && e.departamento);
    assert.ok(typeof e.lat === 'number' && typeof e.lon === 'number');
  });
});

check('la solicitud de derivación se guarda contra su evaluación', () => {
  S.clear();
  S.upsertChild({ cui: CUI });
  const ev = S.saveEvaluation(sampleEval()).record;
  const res = S.updateEvaluation(ev.id, {
    derivacionTipo: 'referencia',
    derivacionDestino: 'Instituto Nacional de Salud del Niño – San Borja',
    derivacionEstado: 'pendiente_envio'
  });
  assert.strictEqual(res.ok, true);
  const guardada = S.evaluationsFor(CUI)[0];
  assert.strictEqual(guardada.derivacionTipo, 'referencia');
  assert.strictEqual(guardada.derivacionEstado, 'pendiente_envio');
  // El resto de la evaluación queda intacto.
  assert.strictEqual(guardada.pre, 86);
  assert.strictEqual(guardada.level, 'red');
  // Y aparece en el CSV.
  assert.ok(S.toCSV(S.allEvaluations()).includes('referencia'));
});

check('actualizar una evaluación inexistente falla en vez de crear basura', () => {
  S.clear();
  const res = S.updateEvaluation('id-que-no-existe', { derivacionTipo: 'referencia' });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(S.allEvaluations().length, 0);
});

// ============================================================================
// MENSAJES DE SEGUIMIENTO
// ============================================================================
const MSG = require('./www/mensajes.js');

check('valida celular peruano y tolera el código de país pegado', () => {
  assert.strictEqual(MSG.isValidPhone('987654321'), true);
  assert.strictEqual(MSG.isValidPhone('51987654321'), true);   // con código país
  assert.strictEqual(MSG.isValidPhone('+51 987 654 321'), true);
  assert.strictEqual(MSG.isValidPhone('887654321'), false);    // no empieza por 9
  assert.strictEqual(MSG.isValidPhone('98765432'), false);     // corto
  assert.strictEqual(MSG.isValidPhone(''), false);
  assert.strictEqual(MSG.normalizePhone('+51 987-654-321'), '987654321');
});

check('el enlace wa.me lleva código de país y texto escapado', () => {
  const link = MSG.waLink('987654321', 'hola mundo & cía');
  assert.ok(link.startsWith('https://wa.me/51987654321?text='));
  assert.ok(link.includes('%26'));           // el & va escapado
  assert.ok(!link.includes(' '));            // sin espacios crudos
  // Recuperable tal cual.
  assert.strictEqual(decodeURIComponent(link.split('?text=')[1]), 'hola mundo & cía');
});

check('el mensaje nunca lleva datos identificables del paciente', () => {
  // WhatsApp no es un canal seguro: la familia necesita saber qué hacer,
  // no la cifra de saturación ni el código del certificado.
  const texto = MSG.build({
    level: 'red', model: 'cchd', establecimiento: 'C.S. Cusco - Wanchaq',
    destino: 'Instituto Nacional de Salud del Niño – San Borja'
  });
  ['RN-QUISPE', '12345678', '86', '97 %', 'SpO2', 'CUI', 'DNI'].forEach(prohibido => {
    assert.ok(!texto.includes(prohibido), 'el mensaje no debe contener ' + prohibido);
  });
});

check('cada resultado produce la instrucción que corresponde', () => {
  const rojo = MSG.build({ level: 'red', model: 'cchd', destino: 'INSN San Borja' });
  assert.ok(rojo.includes('ALTERADO'));
  assert.ok(rojo.includes('no debe ser dado de alta'));
  assert.ok(rojo.includes('INSN San Borja'));

  const ambar = MSG.build({ level: 'yellow', model: 'cchd', repeatMin: 60 });
  assert.ok(ambar.includes('repetirse'));
  assert.ok(ambar.includes('NO se retire'));
  assert.ok(ambar.includes('no significa que su bebé esté enfermo'));

  const verde = MSG.build({ level: 'green', model: 'cchd' });
  assert.ok(verde.includes('NORMAL'));
  assert.ok(!verde.includes('NO se retire'));

  // Negativo con signos: normal, pero no se va.
  const conSignos = MSG.build({ level: 'green', model: 'cchd', clinicalOverride: true });
  assert.ok(conSignos.includes('NO se retire'));
  assert.ok(conSignos.includes('signos'));
});

check('todos los mensajes llevan los signos de alarma en lenguaje llano', () => {
  ['green', 'yellow', 'red'].forEach(level => {
    const t = MSG.build({ level, model: 'cchd' });
    assert.ok(t.includes('morado o azulado'));
    assert.ok(t.includes('al lactar'));
    // El insight de campo: la familia lo confunde con esto.
    assert.ok(t.includes('gases'));
    assert.ok(t.includes('soroche'));
    // Sin jerga médica.
    ['cianosis', 'taquipnea', 'hipoxemia', 'ductal', 'saturación'].forEach(jerga => {
      assert.ok(!t.toLowerCase().includes(jerga), 'jerga en el mensaje: ' + jerga);
    });
  });
});

check('la adaptación recuerda el tamizaje de las 24 h con fecha', () => {
  const nacimiento = new Date('2026-08-14T08:00:00');
  const t = MSG.build({
    level: 'green', model: 'adaptation',
    screeningAt: nacimiento.getTime() + 1440 * 60000
  });
  assert.ok(t.includes('24 horas de vida'));
  assert.ok(t.includes('15/08'));                 // el día siguiente
  assert.ok(t.includes('No se retire sin ese examen'));
  // El tamizaje sí lo recuerda; el modelo CCHD no tiene por qué.
  assert.ok(!MSG.build({ level: 'green', model: 'cchd' }).includes('24 horas de vida'));
});

check('sin datos opcionales el mensaje sigue siendo válido', () => {
  const t = MSG.build({ level: 'yellow', model: 'cchd' });
  assert.ok(t.length > 100);
  assert.ok(!t.includes('undefined'));
  assert.ok(!t.includes('null'));
  assert.ok(!t.includes('—'));
  // Y el enlace se construye aunque no haya teléfono válido.
  assert.ok(MSG.waLink('', t).startsWith('https://wa.me/?text='));
});

check('el seguimiento queda registrado en la evaluación y en el CSV', () => {
  S.clear();
  S.upsertChild({ cui: CUI, telefono: '987654321' });
  const ev = S.saveEvaluation(sampleEval()).record;
  S.updateEvaluation(ev.id, {
    seguimientoVia: 'whatsapp',
    seguimientoEnviadoEn: new Date().toISOString(),
    seguimientoDestino: '987654321'
  });
  assert.strictEqual(S.evaluationsFor(CUI)[0].seguimientoVia, 'whatsapp');
  assert.ok(S.toCSV(S.allEvaluations()).includes('whatsapp'));
  // El teléfono se guarda en la ficha del niño, para el siguiente control.
  assert.strictEqual(S.getChild(CUI).telefono, '987654321');
});

check('el mensaje periódico pregunta por el bienestar sin identificar al paciente', () => {
  const t = MSG.buildCheckIn({ establecimiento: 'C.S. Cusco - Wanchaq' });
  assert.ok(t.includes('cómo sigue su bebé'));
  assert.ok(t.includes('¿Cómo se encuentra hoy?'));
  assert.ok(t.includes('morado o azulado'));
  ['CUI', 'DNI', 'SpO2', '12345678'].forEach(prohibido => assert.ok(!t.includes(prohibido)));
});

// ============================================================================
// PROGRAMACIÓN DE SEGUIMIENTO
// ============================================================================
const F = require('./www/seguimiento.js');

check('programa una cantidad finita de envíos con la frecuencia elegida', () => {
  const dates = F.buildOccurrences({
    dischargedAt: '2026-08-15T16:30:00', startDays: 1, time: '09:00', everyDays: 2, count: 3
  }).map(x => new Date(x));
  assert.strictEqual(dates.length, 3);
  assert.strictEqual(dates[0].getHours(), 9);
  assert.strictEqual(dates[0].getMinutes(), 0);
  assert.strictEqual((dates[1] - dates[0]) / 86400000, 2);
  assert.strictEqual((dates[2] - dates[1]) / 86400000, 2);
});

check('rechaza programaciones incompletas, infinitas o fuera de rango', () => {
  assert.strictEqual(F.normalize({ startDays: -1, time: '09:00', everyDays: 1, count: 3 }), null);
  assert.strictEqual(F.normalize({ startDays: 1, time: '25:00', everyDays: 1, count: 3 }), null);
  assert.strictEqual(F.normalize({ startDays: 1, time: '09:00', everyDays: 5, count: 3 }), null);
  assert.strictEqual(F.normalize({ startDays: 1, time: '09:00', everyDays: 1, count: 99 }), null);
});

check('permite programar el primer envío para una fecha y minuto concretos', () => {
  const dates = F.buildOccurrences({
    firstDate: '2026-08-15', time: '14:02', everyDays: 1, count: 2
  }).map(x => new Date(x));
  assert.strictEqual(dates.length, 2);
  assert.strictEqual(dates[0].getFullYear(), 2026);
  assert.strictEqual(dates[0].getMonth(), 7);
  assert.strictEqual(dates[0].getDate(), 15);
  assert.strictEqual(dates[0].getHours(), 14);
  assert.strictEqual(dates[0].getMinutes(), 2);
});

check('la programación de alta queda trazable en la evaluación y el CSV', () => {
  S.clear();
  S.upsertChild({ cui: CUI });
  assert.strictEqual(S.getChild(CUI).telefono, '');
  const ev = S.saveEvaluation(sampleEval()).record;
  const envios = F.buildOccurrences({
    dischargedAt: '2026-08-15T16:30:00', startDays: 1, time: '09:00', everyDays: 1, count: 3
  });
  S.updateEvaluation(ev.id, {
    altaEn: '2026-08-15T16:30:00',
    seguimientoProgramadoEstado: 'pendiente_servicio',
    seguimientoProgramadoDestino: '987654321',
    seguimientoProgramadoInicioDias: 1,
    seguimientoProgramadoHora: '09:00',
    seguimientoProgramadoCadaDias: 1,
    seguimientoProgramadoCantidad: 3,
    seguimientoProgramadoEnvios: envios
  });
  // El celular se incorpora recién al cerrar el alta y programar el seguimiento.
  S.upsertChild({ cui: CUI, telefono: '987654321' });
  const stored = S.evaluationsFor(CUI)[0];
  assert.strictEqual(stored.seguimientoProgramadoCantidad, 3);
  assert.strictEqual(stored.seguimientoProgramadoEnvios.length, 3);
  const csv = S.toCSV([stored]);
  assert.ok(csv.includes('pendiente_servicio'));
  assert.ok(csv.includes('seguimiento_programado_hora'));
  assert.strictEqual(S.getChild(CUI).telefono, '987654321');
});

check('el resultado verde conduce solo al alta y no al flujo manual wa.me', () => {
  const source = fs.readFileSync('./www/app.js', 'utf8');
  assert.ok(!source.includes('openFollowup'));
  assert.ok(!source.includes('followupScreen'));
  assert.ok(!source.includes('Mensaje en lenguaje llano'));
  const result = source.slice(source.indexOf('function cchdResult'), source.indexOf('function adaptationResult'));
  const alta = result.indexOf('data-action="openDischargeSchedule">Dar de alta');
  assert.ok(alta >= 0, 'el resultado CCHD verde debe mostrar Dar de alta');
  assert.ok(result.indexOf('referralBlock()', alta) > alta, 'Dar de alta debe preceder las acciones secundarias');
});

check('la hora del seguimiento no usa el selector nativo que se cerraba al repintar', () => {
  const source = fs.readFileSync('./www/app.js', 'utf8');
  const schedule = source.slice(source.indexOf('function scheduleScreen'), source.indexOf('function referralBlock'));
  assert.ok(!schedule.includes('type="time"'), 'la agenda no debe usar input time nativo');
  assert.ok(source.includes('id="schedule-hour" class="field-input" type="text"'));
  assert.ok(source.includes('id="schedule-minute" class="field-input" type="text"'));
  assert.ok(source.includes('data-bind="scheduleHour"'));
  assert.ok(source.includes('data-bind="scheduleMinute"'));
  assert.ok(!source.includes('data-time-bind'));
});

check('la demo frontend usa directamente el endpoint de texto de Meta', () => {
  const app = fs.readFileSync('./www/app.js', 'utf8');
  const config = fs.readFileSync('./www/config.js', 'utf8');
  assert.ok(app.includes("'https://graph.facebook.com/'"));
  assert.ok(app.includes("Authorization: 'Bearer ' + C.META_WHATSAPP_ACCESS_TOKEN"));
  assert.ok(app.includes("type: 'text'"));
  assert.ok(app.includes("text: { preview_url: false, body: body }"));
  assert.ok(app.includes('setInterval(processDueFollowups, 10000)'));
  assert.ok(app.includes('type="date"'));
  assert.ok(config.includes("META_GRAPH_API_VERSION: 'v23.0'"));
});

check('la derivación registra y exporta los antecedentes prenatales', () => {
  S.clear();
  S.upsertChild({ cui: CUI });
  const ev = S.saveEvaluation(sampleEval()).record;
  S.updateEvaluation(ev.id, {
    derivacionTipo: 'teleconsulta',
    antecedentesPrenatales: ['Síndrome de Down / trisomía 21', 'Diabetes materna pregestacional o gestacional'],
    antecedentesPrenatalesOtros: 'Ecografía fetal con hallazgo por confirmar'
  });
  const stored = S.evaluationsFor(CUI)[0];
  assert.strictEqual(stored.antecedentesPrenatales.length, 2);
  const csv = S.toCSV([stored]);
  assert.ok(csv.includes('antecedentes_prenatales'));
  assert.ok(csv.includes('Síndrome de Down'));
  assert.ok(csv.includes('hallazgo por confirmar'));
});

check('los antecedentes aparecen en el flujo de teleconsulta y referencia', () => {
  const source = fs.readFileSync('./www/app.js', 'utf8');
  const referral = source.slice(source.indexOf('function referralScreen'), source.indexOf('function cchdGreenWithSigns'));
  assert.ok(referral.includes('Antecedentes prenatales'));
  assert.ok(referral.includes('togglePrenatalHistory'));
  assert.ok(referral.includes('data-bind="prenatalOther"'));
  assert.ok(source.includes('antecedentesPrenatales: req.antecedentesPrenatales'));
});

check('el instructivo de prostaglandina se limita a resultados críticos', () => {
  const source = fs.readFileSync('./www/app.js', 'utf8');
  const guide = source.slice(source.indexOf('function prostaglandinGuide'), source.indexOf('function referralScreen'));
  assert.ok(guide.includes("ev.level !== 'red'"));
  assert.ok(guide.includes('No es una indicación automática'));
  assert.ok(guide.includes('0,01 µg/kg/min'));
  assert.ok(guide.includes('peso (kg) × 3 mL'));
  assert.ok(guide.includes('No administrar en bolo'));
  assert.ok(guide.includes('capacidad inmediata de ventilación/intubación'));
});

S.clear();
console.log('ok — ' + n + ' bloques de verificación');
