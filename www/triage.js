/* Cardio Alerta — lógica clínica pura (sin DOM, sin red).
 *
 * Contiene DOS modelos independientes que NUNCA deben combinarse:
 *
 *   1. TAMIZAJE CCHD  (>= 24 h de vida) — AAP + estratos ANDES-CHD.
 *      Los umbrales YA incluyen la corrección por altitud.
 *
 *   2. ADAPTACIÓN     (< 24 h de vida)  — curvas tipo Dawson (pre-ductal)
 *      desplazadas por altitud con un coeficiente lineal.
 *
 * Aplicar el coeficiente lineal del modelo 2 sobre los umbrales del modelo 1
 * los corregiría dos veces. A 3600 m el umbral crítico caería de 85 % a 77 %,
 * dejando pasar como normales a neonatos hipoxémicos. Por eso son dos
 * funciones separadas y ninguna llama a la otra.
 */
(function (root) {
  'use strict';

  // ===========================================================================
  // CALIBRACIÓN — editar solo al desplegar, con datos locales de la región.
  // No se expone en la interfaz: la app únicamente muestra estos valores en
  // modo lectura para auditoría.
  // ===========================================================================
  var CAL = {
    // % de SpO2 que se pierde por cada metro de altitud, en el modelo de
    // adaptación. 0.0035 es la estimación neonatal conservadora (3.5 puntos
    // por cada 1000 m). La literatura en adultos usa 0.0047; NO usar ese valor
    // en neonatos.
    K_ALT: 0.0035,

    // El umbral corregido nunca baja de aquí. La relación SpO2/PaO2 es
    // sigmoide: por debajo de ~90 % la extrapolación lineal se sale de la
    // curva y produce umbrales sin sentido clínico (a 3600 m y 1 min de vida
    // daría 42 %).
    SPO2_FLOOR: 50,

    // Lectura por debajo de este valor: sospechar artefacto (mala perfusión,
    // frío, movimiento) antes que hipoxemia real.
    UNRELIABLE_BELOW: 70,

    DIFF_MAX: 3,              // diferencial pre/post máximo para aprobar
    MAX_REPEATS: 3,           // 3.ª repetición consecutiva en CCHD => positivo

    // Ventana en la que dos zonas grises cuentan como consecutivas. Tres
    // repeticiones separadas por 60 min caben de sobra en 6 h; más allá se
    // trata de un episodio de tamizaje distinto y el contador vuelve a cero.
    // Sin esto, una zona gris de la semana pasada escalaría a positivo la
    // primera medición de hoy.
    REPEAT_WINDOW_MIN: 360,

    REPEAT_MIN_CCHD: 60,      // minutos de espera entre tamizajes CCHD
    REPEAT_MIN_ADAPT: 30,     // minutos de espera en modo adaptación
    RECHECK_MIN_PERFUSION: 10,// reverificación tras recalentar/reperfundir
    ALT_VALIDATED_MAX: 4500,  // techo del rango validado por ANDES-CHD
    ADAPT_MAX_MIN: 1440       // 24 h — frontera entre los dos modelos
  };

  // ===========================================================================
  // MODELO 1 — Tamizaje de cardiopatía congénita crítica (>= 24 h)
  // ===========================================================================

  // `critical`: por debajo => positivo directo.
  // `pass`: a partir de aquí (y con diferencial <= 3) => negativo.
  // Entre ambos, o con diferencial > 3 => repetición.
  var CCHD_STRATA = [
    { max: 1599,     critical: 90, pass: 95, label: '0–1599 msnm' },
    { max: 2499,     critical: 90, pass: 93, label: '1600–2499 msnm' },
    { max: 3599,     critical: 87, pass: 90, label: '2500–3599 msnm' },
    { max: 4500,     critical: 85, pass: 89, label: '3600–4500 msnm' },
    // Fuera del rango validado por ANDES-CHD. Se reutilizan los umbrales del
    // estrato más alto y se marca el registro para auditoría.
    { max: Infinity, critical: 85, pass: 89, label: '> 4500 msnm', unvalidated: true }
  ];

  function getStratum(altitude) {
    for (var i = 0; i < CCHD_STRATA.length; i++) {
      if (altitude <= CCHD_STRATA[i].max) return CCHD_STRATA[i];
    }
    return CCHD_STRATA[CCHD_STRATA.length - 1];
  }

  /* classifyCCHD({ pre, post, altitude, priorYellows, signs })
   *   pre, post   — SpO2 pre-ductal (mano/muñeca derecha) y post-ductal (pie)
   *   altitude    — msnm
   *   priorYellows— repeticiones consecutivas ya acumuladas en este paciente
   *   signs       — true si hay signos clínicos (cianosis, quejido, aleteo…)
   */
  function classifyCCHD(o) {
    var pre = Number(o.pre), post = Number(o.post);
    var stratum = getStratum(Number(o.altitude));
    var priorYellows = Number(o.priorYellows) || 0;
    var signs = !!o.signs;
    var min = Math.min(pre, post);
    var diff = Math.abs(pre - post);
    var attempt = priorYellows + 1;

    var level, reason;
    if (min < stratum.critical) {
      level = 'red';
      reason = 'critico';
    } else if (min >= stratum.pass && diff <= CAL.DIFF_MAX) {
      level = 'green';
      reason = 'normal';
    } else {
      level = 'yellow';
      reason = min < stratum.pass ? 'limitrofe' : 'diferencial';
    }

    // Tres repeticiones consecutivas equivalen a un tamizaje positivo.
    var escalated = false;
    if (level === 'yellow' && attempt >= CAL.MAX_REPEATS) {
      level = 'red';
      reason = 'escalado';
      escalated = true;
    }

    /* El tamizaje es un cribado, no un descarte: mide saturación y nada más.
     * Un recién nacido con signos clínicos necesita evaluación aunque sature
     * bien — es justo por donde se escapa una coartación de aorta con ductus
     * permeable. El nivel sigue siendo verde porque el resultado de saturación
     * ES negativo; lo que cambia es la conducta: no procede el alta.
     * Separar «lo que midió el algoritmo» de «lo que se puede hacer» es lo que
     * evita que la app empuje al alta a un niño sintomático. */
    var clinicalOverride = level === 'green' && signs;
    var dischargeBlocked = level !== 'green' || signs;

    return {
      model: 'cchd',
      level: level,
      reason: reason,
      escalated: escalated,
      signs: signs,
      clinicalOverride: clinicalOverride,
      dischargeBlocked: dischargeBlocked,
      attempt: attempt,
      maxAttempts: CAL.MAX_REPEATS,
      pre: pre,
      post: post,
      min: min,
      diff: diff,
      stratum: stratum,
      unvalidatedAltitude: !!stratum.unvalidated,
      unreliable: min < CAL.UNRELIABLE_BELOW,
      repeatMin: CAL.REPEAT_MIN_CCHD
    };
  }

  // ===========================================================================
  // MODELO 2 — Adaptación neonatal (< 24 h), pre-ductal
  // ===========================================================================

  // Referencia a nivel del mar por minuto de vida.
  // p3 y p50 provienen de la tabla entregada (curvas tipo Dawson).
  // p10 NO viene en la fuente: se deriva asumiendo normalidad, con
  //   p3 = μ − 1.881σ  y  p10 = μ − 1.282σ
  //   => p10 = p50 − 0.6815 × (p50 − p3)
  // Es una aproximación: validar con datos locales antes de uso clínico.
  var DAWSON_SEA_LEVEL = [
    { t: 1,    p3: 55, p10: 58, p50: 65 },
    { t: 5,    p3: 75, p10: 78, p50: 85 },
    { t: 10,   p3: 80, p10: 83, p50: 90 },
    { t: 60,   p3: 85, p10: 88, p50: 94 },
    { t: 1440, p3: 90, p10: 92, p50: 96 }
  ];

  // ponytail: interpolación lineal entre filas adyacentes. El tramo denso
  // (1–10 min) la tolera bien y el tramo 60–1440 min solo se mueve 5 puntos.
  // Si hiciera falta más fidelidad en la curva, interpolar en log(t).
  function adaptationRef(minutes) {
    var m = Number(minutes);
    var rows = DAWSON_SEA_LEVEL;
    if (!(m > rows[0].t)) return { p3: rows[0].p3, p10: rows[0].p10, p50: rows[0].p50 };
    var last = rows[rows.length - 1];
    if (m >= last.t) return { p3: last.p3, p10: last.p10, p50: last.p50 };

    for (var i = 0; i < rows.length - 1; i++) {
      var a = rows[i], b = rows[i + 1];
      if (m >= a.t && m <= b.t) {
        var f = (m - a.t) / (b.t - a.t);
        return {
          p3: a.p3 + f * (b.p3 - a.p3),
          p10: a.p10 + f * (b.p10 - a.p10),
          p50: a.p50 + f * (b.p50 - a.p50)
        };
      }
    }
    return { p3: last.p3, p10: last.p10, p50: last.p50 };
  }

  function adaptationThresholds(minutes, altitude) {
    var ref = adaptationRef(minutes);
    var delta = Number(altitude) * CAL.K_ALT;
    var floor = function (v) { return Math.max(v - delta, CAL.SPO2_FLOOR); };
    return {
      ref: ref,
      delta: delta,
      p3: floor(ref.p3),
      p10: floor(ref.p10),
      floored: (ref.p3 - delta) < CAL.SPO2_FLOOR
    };
  }

  /* classifyAdaptation({ spo2, minutes, altitude, signs })
   *   spo2     — SpO2 pre-ductal (mano/muñeca derecha)
   *   minutes  — minutos de vida en el instante de la medición
   *   altitude — msnm
   *   signs    — true si hay signos clínicos (quejido, aleteo, retracciones…)
   */
  function classifyAdaptation(o) {
    var spo2 = Number(o.spo2);
    var minutes = Number(o.minutes);
    var altitude = Number(o.altitude);
    var signs = !!o.signs;
    var th = adaptationThresholds(minutes, altitude);

    var level, reason, repeatMin;
    if (spo2 < th.p3) {
      level = 'red';
      // Sin signos clínicos, una lectura baja aislada suele ser mala perfusión
      // o frío antes que hipoxemia: recalentar y reverificar reduce falsos
      // positivos. Con signos, no se espera.
      reason = signs ? 'hipoxemia_con_signos' : 'verificar_perfusion';
      repeatMin = signs ? 0 : CAL.RECHECK_MIN_PERFUSION;
    } else if (spo2 < th.p10) {
      level = 'yellow';
      reason = 'vigilar';
      repeatMin = CAL.REPEAT_MIN_ADAPT;
    } else {
      level = 'green';
      reason = 'adaptacion_normal';
      repeatMin = 0;
    }

    return {
      model: 'adaptation',
      level: level,
      reason: reason,
      signs: signs,
      // Misma regla que en el tamizaje: una adaptación normal con signos
      // clínicos presentes no autoriza a seguir de largo.
      clinicalOverride: level === 'green' && signs,
      spo2: spo2,
      minutes: minutes,
      thresholds: th,
      attempt: (Number(o.priorYellows) || 0) + 1,
      unreliable: spo2 < CAL.UNRELIABLE_BELOW,
      repeatMin: repeatMin
    };
  }

  // ===========================================================================
  // Enrutado por edad — única frontera entre los dos modelos
  // ===========================================================================
  function modeForMinutes(minutes) {
    var m = Number(minutes);
    if (!isFinite(m) || m < 0) return null;          // fecha/hora inválida
    return m < CAL.ADAPT_MAX_MIN ? 'adaptation' : 'cchd';
  }

  var api = {
    CAL: CAL,
    CCHD_STRATA: CCHD_STRATA,
    DAWSON_SEA_LEVEL: DAWSON_SEA_LEVEL,
    getStratum: getStratum,
    classifyCCHD: classifyCCHD,
    adaptationRef: adaptationRef,
    adaptationThresholds: adaptationThresholds,
    classifyAdaptation: classifyAdaptation,
    modeForMinutes: modeForMinutes
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Triage = api;
})(typeof window !== 'undefined' ? window : globalThis);
