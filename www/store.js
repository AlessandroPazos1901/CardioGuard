/* Cardio Alerta — persistencia local.
 *
 * Dos colecciones:
 *   children    — un registro por recién nacido, indexado por un código local
 *                 con formato RN-APELLIDO_PADRE-CÓDIGO. Es la identidad operativa y
 *                 permite reconocerlo en visitas posteriores.
 *   evaluations — todas las evaluaciones, cada una apuntando a ese código. Un niño
 *                 acumula tantas como se le hagan a lo largo del tiempo.
 *
 * Las evaluaciones guardan copia de los datos del paciente y de los umbrales
 * aplicados. Es deliberado: un registro clínico debe reflejar lo que se sabía
 * en ese momento, aunque después se corrija la ficha del niño.
 *
 * localStorage a propósito: API nativa, síncrona, idéntica en el navegador y
 * dentro del APK.
 * ponytail: el límite ronda 5 MB (~10 000 evaluaciones). Si un puesto se
 * acercara, migrar a IndexedDB conservando esta interfaz.
 */
(function (root) {
  'use strict';

  var K_CHILDREN = 'cardioalerta.v1.children';
  var K_EVALS = 'cardioalerta.v1.evaluations';

  // Los CUI numéricos anteriores se siguen reconociendo para no volver
  // inaccesibles registros ya guardados, pero toda ficha nueva usa RN-APELLIDO.
  var CUI_MIN = 8;
  var CUI_MAX = 14;
  var CUI_PATTERN = new RegExp('^\\d{' + CUI_MIN + ',' + CUI_MAX + '}$');
  var RN_CODE_MAX = 48;
  var RN_LEGACY_CODE_PATTERN = /^RN-[A-ZÁÉÍÓÚÜÑ]{2,32}(?:_[A-ZÁÉÍÓÚÜÑ]{2,32})*$/;
  var RN_UNIQUE_CODE_PATTERN = /^RN-[A-ZÁÉÍÓÚÜÑ]{2,32}(?:_[A-ZÁÉÍÓÚÜÑ]{2,32})*-[A-Z0-9]{4}$/;
  var RN_CODE_PATTERN = /^(?:RN-[A-ZÁÉÍÓÚÜÑ]{2,32}(?:_[A-ZÁÉÍÓÚÜÑ]{2,32})*)(?:-[A-Z0-9]{4})?$/;

  // DNI peruano: exactamente 8 dígitos, y puede empezar por cero. Por eso los
  // identificadores se manejan como texto y nunca como número.
  var DNI_LENGTH = 8;

  function backend() {
    try { return root.localStorage || null; } catch (e) { return null; }
  }
  function newId() {
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }
  function onlyDigits(v) {
    return String(v == null ? '' : v).replace(/\D/g, '');
  }
  function normalizePatientCode(code) {
    var raw = String(code == null ? '' : code).trim();
    // Compatibilidad de lectura con fichas creadas antes del cambio de formato.
    if (/^\d+$/.test(raw)) return raw;
    return raw.toUpperCase().replace(/\s+/g, '_').replace(/_+/g, '_');
  }
  function isValidPatientCode(code) {
    var normalized = normalizePatientCode(code);
    return RN_CODE_PATTERN.test(normalized) || CUI_PATTERN.test(normalized);
  }
  function generatePatientCode(value, randomFn) {
    var raw = normalizePatientCode(value).replace(/^RN-/, '');
    raw = raw.replace(/-[A-Z0-9]{4}$/, '').replace(/[^A-ZÁÉÍÓÚÜÑ_]/g, '').replace(/_+/g, '_');
    if (!/^[A-ZÁÉÍÓÚÜÑ]{2,32}(?:_[A-ZÁÉÍÓÚÜÑ]{2,32})*$/.test(raw)) return '';
    var alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    var random = randomFn || Math.random;
    for (var attempt = 0; attempt < 30; attempt++) {
      var suffix = '';
      for (var i = 0; i < 4; i++) suffix += alphabet[Math.floor(random() * alphabet.length) % alphabet.length];
      var code = 'RN-' + raw + '-' + suffix;
      if (!getChild(code)) return code;
    }
    return '';
  }
  // Alias históricos: el almacenamiento conserva la propiedad `cui` para no
  // requerir una migración destructiva de los datos existentes.
  function normalizeCui(cui) { return normalizePatientCode(cui); }
  function isValidCui(cui) { return isValidPatientCode(cui); }

  function normalizeDni(dni) { return onlyDigits(dni); }
  function isValidDni(dni) { return normalizeDni(dni).length === DNI_LENGTH; }

  function readList(key) {
    var ls = backend();
    if (!ls) return [];
    var raw = ls.getItem(key);
    if (!raw) return [];
    try {
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      // Nunca se descarta en silencio: se aparta para recuperarla a mano.
      try { ls.setItem(key + '.corrupt.' + Date.now(), raw); ls.removeItem(key); } catch (e2) { /* sin espacio */ }
      return [];
    }
  }

  function writeList(key, list) {
    var ls = backend();
    if (!ls) return { ok: false, error: 'sin almacenamiento disponible' };
    try {
      ls.setItem(key, JSON.stringify(list));
      return { ok: true };
    } catch (e) {
      // Cuota llena: no se guardó nada y quien llama tiene que avisarlo.
      return { ok: false, error: 'almacenamiento lleno' };
    }
  }

  // ------------------------------------------------------------------- niños
  function allChildren() { return readList(K_CHILDREN); }

  function getChild(cui) {
    var id = normalizeCui(cui);
    if (!id) return null;
    var found = allChildren().filter(function (c) { return c.cui === id; });
    return found.length ? found[0] : null;
  }

  /* Crea o actualiza la ficha del niño. Solo sobrescribe los campos que vengan
   * con valor, para que una evaluación posterior sin fecha de nacimiento no
   * borre la que ya estaba registrada. */
  function upsertChild(data) {
    var id = normalizeCui(data.cui);
    if (!isValidCui(id)) return { ok: false, error: 'código de recién nacido inválido' };

    var children = allChildren();
    var now = new Date().toISOString();
    var idx = -1;
    for (var i = 0; i < children.length; i++) {
      if (children[i].cui === id) { idx = i; break; }
    }

    var next;
    if (idx === -1) {
      next = {
        cui: id,
        dniMadre: data.dniMadre || '',
        telefono: data.telefono || '',
        birthDate: data.birthDate || '',
        birthTime: data.birthTime || '',
        createdAt: now,
        updatedAt: now
      };
      children.push(next);
    } else {
      next = Object.assign({}, children[idx]);
      ['dniMadre', 'telefono', 'birthDate', 'birthTime'].forEach(function (f) {
        if (data[f]) next[f] = data[f];
      });
      next.updatedAt = now;
      children[idx] = next;
    }

    var res = writeList(K_CHILDREN, children);
    return res.ok ? { ok: true, child: next, isNew: idx === -1 } : res;
  }

  // ------------------------------------------------------------ evaluaciones
  function allEvaluations() { return readList(K_EVALS); }

  function evaluationsFor(cui) {
    var id = normalizeCui(cui);
    return allEvaluations().filter(function (e) { return e.cui === id; });
  }

  function saveEvaluation(record) {
    var id = normalizeCui(record.cui);
    if (!isValidCui(id)) return { ok: false, error: 'código de recién nacido inválido' };

    var rec = Object.assign({}, record, { cui: id });
    if (!rec.id) rec.id = newId();
    if (!rec.createdAt) rec.createdAt = new Date().toISOString();
    if (rec.exportedAt === undefined) rec.exportedAt = null;
    // Número de evaluación de este niño, para leer el historial de un vistazo.
    rec.seq = evaluationsFor(id).length + 1;

    var evals = allEvaluations();
    evals.push(rec);
    var res = writeList(K_EVALS, evals);
    return res.ok ? { ok: true, record: rec, total: evals.length } : res;
  }

  /* Añade campos a una evaluación ya guardada — se usa para registrar la
   * solicitud de teleconsulta o referencia después de haber evaluado. */
  function updateEvaluation(id, patch) {
    var found = false;
    var next = allEvaluations().map(function (e) {
      if (e.id !== id) return e;
      found = true;
      return Object.assign({}, e, patch);
    });
    if (!found) return { ok: false, error: 'evaluación no encontrada' };
    var res = writeList(K_EVALS, next);
    return res.ok ? { ok: true } : res;
  }

  function removeEvaluations(ids) {
    var drop = {};
    (Array.isArray(ids) ? ids : [ids]).forEach(function (i) { drop[i] = true; });
    var kept = allEvaluations().filter(function (e) { return !drop[e.id]; });
    var res = writeList(K_EVALS, kept);
    return res.ok ? { ok: true, remaining: kept.length } : res;
  }

  /* Borra al niño y, en cascada, todas sus evaluaciones: dejarlas huérfanas
   * produciría registros clínicos sin paciente. */
  function removeChild(cui) {
    var id = normalizeCui(cui);
    var kept = allChildren().filter(function (c) { return c.cui !== id; });
    var keptEvals = allEvaluations().filter(function (e) { return e.cui !== id; });
    var a = writeList(K_CHILDREN, kept);
    if (!a.ok) return a;
    return writeList(K_EVALS, keptEvals);
  }

  function markExported(ids) {
    var mark = {};
    (Array.isArray(ids) ? ids : [ids]).forEach(function (i) { mark[i] = true; });
    var stamp = new Date().toISOString();
    var next = allEvaluations().map(function (e) {
      return mark[e.id] && !e.exportedAt ? Object.assign({}, e, { exportedAt: stamp }) : e;
    });
    var res = writeList(K_EVALS, next);
    return res.ok ? { ok: true } : res;
  }

  function exported() { return allEvaluations().filter(function (e) { return !!e.exportedAt; }); }
  function pending() { return allEvaluations().filter(function (e) { return !e.exportedAt; }); }

  /* Resumen por niño para la pantalla de historial: cuántas evaluaciones tiene,
   * cuándo fue la última y con qué resultado. */
  function childSummaries() {
    var byCui = {};
    allEvaluations().forEach(function (e) {
      var b = byCui[e.cui] || (byCui[e.cui] = { count: 0, last: null, pending: 0 });
      b.count += 1;
      if (!e.exportedAt) b.pending += 1;
      // Dos evaluaciones pueden caer en el mismo milisegundo; `seq` desempata,
      // porque siempre crece dentro de un mismo niño.
      if (!b.last ||
          e.createdAt > b.last.createdAt ||
          (e.createdAt === b.last.createdAt && (e.seq || 0) >= (b.last.seq || 0))) {
        b.last = e;
      }
    });
    return allChildren().map(function (c) {
      var b = byCui[c.cui] || { count: 0, last: null, pending: 0 };
      return {
        child: c,
        count: b.count,
        pending: b.pending,
        lastLevel: b.last ? b.last.level : null,
        lastAt: b.last ? b.last.createdAt : c.createdAt,
        lastModel: b.last ? b.last.model : null
      };
    }).sort(function (a, b) { return a.lastAt < b.lastAt ? 1 : -1; });
  }

  function clear() {
    var a = writeList(K_CHILDREN, []);
    if (!a.ok) return a;
    return writeList(K_EVALS, []);
  }

  // --------------------------------------------------------------------- CSV
  var COLUMNS = [
    ['codigo_recien_nacido', function (r) { return r.cui; }],
    ['evaluacion_n', function (r) { return r.seq; }],
    ['fecha_hora', function (r) { return r.createdAt; }],
    ['dni_madre', function (r) { return r.dniMadre; }],
    ['nacimiento', function (r) { return (r.birthDate || '') + ' ' + (r.birthTime || ''); }],
    ['minutos_vida', function (r) { return r.minutesOfLife; }],
    ['tipo_evaluacion', function (r) { return r.model === 'cchd' ? 'tamizaje_cchd' : 'adaptacion'; }],
    ['altitud_msnm', function (r) { return r.altitude; }],
    ['lugar', function (r) { return r.locationName; }],
    ['origen_altitud', function (r) { return r.altitudeSource; }],
    ['spo2_preductal', function (r) { return r.pre; }],
    ['spo2_postductal', function (r) { return r.post; }],
    ['diferencial', function (r) { return r.diff; }],
    ['resultado', function (r) { return r.level; }],
    ['motivo', function (r) { return r.reason; }],
    ['intento', function (r) { return r.attempt; }],
    ['escalado', function (r) { return r.escalated ? 'si' : 'no'; }],
    ['umbral_pase', function (r) { return r.passThreshold; }],
    ['umbral_critico', function (r) { return r.criticalThreshold; }],
    ['estrato', function (r) { return r.stratumLabel; }],
    ['signos_clinicos', function (r) { return (r.signs || []).join(' / '); }],
    ['sensor', function (r) { return r.hardware; }],
    ['baja_confianza', function (r) { return r.hardware === 'adult' ? 'si' : 'no'; }],
    ['altitud_fuera_de_rango', function (r) { return r.unvalidatedAltitude ? 'si' : 'no'; }],
    ['lectura_poco_fiable', function (r) { return r.unreliable ? 'si' : 'no'; }],
    ['coef_altitud', function (r) { return r.calibration && r.calibration.K_ALT; }],
    ['derivacion_tipo', function (r) { return r.derivacionTipo || ''; }],
    ['derivacion_destino', function (r) { return r.derivacionDestino || ''; }],
    ['derivacion_fecha', function (r) { return r.derivacionSolicitadaEn || ''; }],
    ['antecedentes_prenatales', function (r) { return (r.antecedentesPrenatales || []).join(' / '); }],
    ['antecedentes_prenatales_otros', function (r) { return r.antecedentesPrenatalesOtros || ''; }],
    ['seguimiento_via', function (r) { return r.seguimientoVia || ''; }],
    ['seguimiento_fecha', function (r) { return r.seguimientoEnviadoEn || ''; }],
    ['alta_fecha', function (r) { return r.altaEn || ''; }],
    ['seguimiento_programado_estado', function (r) { return r.seguimientoProgramadoEstado || ''; }],
    ['seguimiento_programado_destino', function (r) { return r.seguimientoProgramadoDestino || ''; }],
    ['seguimiento_programado_inicio_dias', function (r) { return r.seguimientoProgramadoInicioDias || ''; }],
    ['seguimiento_programado_fecha', function (r) { return r.seguimientoProgramadoFecha || ''; }],
    ['seguimiento_programado_hora', function (r) { return r.seguimientoProgramadoHora || ''; }],
    ['seguimiento_programado_cada_dias', function (r) { return r.seguimientoProgramadoCadaDias || ''; }],
    ['seguimiento_programado_cantidad', function (r) { return r.seguimientoProgramadoCantidad || ''; }],
    ['seguimiento_programado_envios', function (r) { return (r.seguimientoProgramadoEnvios || []).join(' / '); }],
    ['seguimiento_programado_entregas', function (r) { return JSON.stringify(r.seguimientoProgramadoEntregas || []); }],
    ['seguimiento_programado_id_servidor', function (r) { return r.seguimientoSchedulerId || ''; }],
    ['seguimiento_mensaje_id', function (r) { return r.seguimientoMensajeId || ''; }],
    ['seguimiento_programado_error', function (r) { return r.seguimientoProgramadoError || ''; }],
    ['exportado', function (r) { return r.exportedAt || ''; }]
  ];

  function cell(v) {
    if (v === null || v === undefined) return '';
    var s = String(v);
    return /[",;\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function toCSV(records) {
    var head = COLUMNS.map(function (c) { return c[0]; }).join(',');
    var rows = (records || []).map(function (r) {
      return COLUMNS.map(function (c) { return cell(c[1](r)); }).join(',');
    });
    // BOM para que Excel reconozca UTF-8 y no rompa las tildes.
    return '﻿' + [head].concat(rows).join('\r\n') + '\r\n';
  }

  var api = {
    K_CHILDREN: K_CHILDREN,
    K_EVALS: K_EVALS,
    CUI_PATTERN: CUI_PATTERN,
    CUI_MIN: CUI_MIN,
    CUI_MAX: CUI_MAX,
    RN_CODE_MAX: RN_CODE_MAX,
    RN_CODE_PATTERN: RN_CODE_PATTERN,
    RN_UNIQUE_CODE_PATTERN: RN_UNIQUE_CODE_PATTERN,
    DNI_LENGTH: DNI_LENGTH,
    COLUMNS: COLUMNS,
    available: function () { return backend() != null; },
    normalizeCui: normalizeCui,
    isValidCui: isValidCui,
    normalizePatientCode: normalizePatientCode,
    isValidPatientCode: isValidPatientCode,
    generatePatientCode: generatePatientCode,
    normalizeDni: normalizeDni,
    isValidDni: isValidDni,
    allChildren: allChildren,
    getChild: getChild,
    upsertChild: upsertChild,
    removeChild: removeChild,
    allEvaluations: allEvaluations,
    evaluationsFor: evaluationsFor,
    saveEvaluation: saveEvaluation,
    updateEvaluation: updateEvaluation,
    removeEvaluations: removeEvaluations,
    markExported: markExported,
    exported: exported,
    pending: pending,
    childSummaries: childSummaries,
    clear: clear,
    toCSV: toCSV
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Store = api;
})(typeof window !== 'undefined' ? window : globalThis);
