/* Cardio Alerta — interfaz.
 * La lógica clínica vive en triage.js y la persistencia en store.js. */
(function () {
  'use strict';

  var T = window.Triage;
  var S = window.Store;
  var E = window.Eess;
  var M = window.Mensajes;
  var F = window.Seguimiento;
  var C = window.CARDIO_CONFIG || {};

  // Los puestos donde se mide salen del mismo registro que los centros de
  // referencia: una sola lista, marcada por capacidad. Elegir uno rellena la
  // altitud y, de paso, da las coordenadas para calcular la derivación.
  var HEALTH_POSTS = E.origins();

  var SIGNS = [
    { key: 'cianosis', label: 'Cianosis' },
    { key: 'quejido', label: 'Quejido' },
    { key: 'aleteo', label: 'Aleteo nasal' },
    { key: 'retracciones', label: 'Retracciones' }
  ];

  /* Antecedentes relevantes para la orientación del especialista. No cambian
   * por sí solos el resultado del tamizaje: se adjuntan a la teleconsulta o
   * referencia para dar contexto clínico. */
  var PRENATAL_HISTORY = [
    { key: 'down', label: 'Síndrome de Down / trisomía 21' },
    { key: 'otherGenetic', label: 'Otra condición genética o malformación conocida' },
    { key: 'maternalDiabetes', label: 'Diabetes materna pregestacional o gestacional' },
    { key: 'maternalObesity', label: 'Obesidad materna' },
    { key: 'maternalInfection', label: 'Infección durante el embarazo (rubéola, sífilis, Zika u otra)' },
    { key: 'teratogens', label: 'Medicamentos, alcohol, tabaco u otras sustancias de riesgo' },
    { key: 'familyHistory', label: 'Antecedente familiar de cardiopatía congénita' },
    { key: 'fetalFinding', label: 'Ecografía o ecocardiografía fetal anormal' },
    { key: 'consanguinity', label: 'Consanguinidad parental' },
    { key: 'maternalAge', label: 'Edad materna de 35 años o más' }
  ];

  var LEVEL_TEXT = { green: 'Normal', yellow: 'Repetir', red: 'Alerta' };

  /* Campos que solo admiten dígitos, con su longitud máxima.
   * Ninguno es <input type="number">: en ese tipo el navegador prohíbe leer
   * selectionStart, así que al repintar no se puede devolver el cursor a su
   * sitio y las cifras terminan invertidas ("145" se convierte en "541").
   * Con type="text" e inputmode numérico se conserva el teclado del teléfono
   * y el cursor se comporta. */
  var DIGIT_FIELDS = {
    dniMadre: S.DNI_LENGTH,
    telefono: M.PHONE_LENGTH,
    altitude: 4,
    preSpo2: 3,
    postSpo2: 3,
    scheduleCount: 2,
    scheduleHour: 2,
    scheduleMinute: 2
  };

  function escAttr(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }
  function escText(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  }
  /* Fecha local en formato YYYY-MM-DD. No sirve toISOString(): convierte a UTC
   * y en Perú (UTC−5) devolvería el día siguiente durante toda la tarde. */
  function todayISO() {
    var d = new Date();
    var p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  function fmtDateTime(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: '2-digit' }) +
      ' ' + d.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });
  }

  // La configuración real (token, número) vive en el servidor. Aquí solo se
  // sabe si hay un endpoint al que preguntar; si el servidor no tiene las
  // variables de entorno puestas, el error llega recién al intentar enviar.
  function followupConfigured() {
    return !!String(C.WHATSAPP_API_ENDPOINT || '').trim();
  }

  function safeServiceError(error) {
    return String(error && error.message || 'No se pudo conectar con el servicio.').slice(0, 250);
  }

  async function sendWhatsAppText(to, body) {
    if (!followupConfigured()) throw new Error('El envío de WhatsApp no está configurado.');
    var response = await fetch(C.WHATSAPP_API_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: M.normalizePhone(to), body: body })
    });
    var result;
    try { result = await response.json(); } catch (_) { result = {}; }
    if (!response.ok) throw new Error(result.error || ('WhatsApp respondió HTTP ' + response.status + '.'));
    if (!result.id) throw new Error('WhatsApp no devolvió el identificador del mensaje.');
    return { id: result.id };
  }

  var followupRunnerBusy = false;
  async function processDueFollowups() {
    if (followupRunnerBusy || !followupConfigured() || !S.available()) return;
    followupRunnerBusy = true;
    try {
      var records = S.allEvaluations();
      for (var i = 0; i < records.length; i++) {
        var record = records[i];
        var deliveries = record.seguimientoProgramadoEntregas || [];
        for (var j = 0; j < deliveries.length; j++) {
          var delivery = deliveries[j];
          var dueAt = delivery.nextAttemptAt || delivery.scheduledAt;
          if (delivery.status !== 'pending' || new Date(dueAt).getTime() > Date.now()) continue;
          delivery.status = 'sending';
          S.updateEvaluation(record.id, { seguimientoProgramadoEntregas: deliveries });
          try {
            var sent = await sendWhatsAppText(record.seguimientoProgramadoDestino, record.seguimientoProgramadoMensaje);
            delivery.status = 'accepted';
            delivery.messageId = sent.id;
            delivery.acceptedAt = new Date().toISOString();
            delete delivery.lastError;
            delete delivery.nextAttemptAt;
            toast('Mensaje de seguimiento enviado.');
          } catch (error) {
            delivery.status = 'pending';
            delivery.lastError = safeServiceError(error);
            delivery.nextAttemptAt = new Date(Date.now() + 60000).toISOString();
            toast('No se pudo enviar el seguimiento: ' + delivery.lastError);
          }
          S.updateEvaluation(record.id, {
            seguimientoProgramadoEntregas: deliveries,
            seguimientoProgramadoUltimoError: delivery.lastError || '',
            seguimientoProgramadoUltimoEnvio: delivery.acceptedAt || ''
          });
        }
      }
    } finally {
      followupRunnerBusy = false;
    }
  }

  function initialState() {
    return {
      screen: 'login',
      pin: '',
      cui: '',
      lastLookup: '',
      knownChild: null,
      dniMadre: '',
      telefono: '',
      dischargeAt: null,
      scheduleDate: todayISO(),
      scheduleHour: '09',
      scheduleMinute: '00',
      scheduleEveryDays: '1',
      scheduleCount: '3',
      scheduleSaved: null,
      // La fecha se rellena con hoy porque casi todo registro es del día. La
      // HORA se deja vacía a propósito: ponerla por defecto afirmaría que el
      // niño acaba de nacer, y de ahí salen los minutos de vida que eligen el
      // modelo y los umbrales.
      birthDate: todayISO(),
      birthTime: '',
      altitude: '',
      locationName: '',
      altitudeSource: '',
      originLat: null,
      originLon: null,
      departamento: '',
      gpsDetecting: false,
      gpsError: '',
      showPostPicker: false,
      lastEvalId: null,
      referralSent: null,
      prenatalHistory: {},
      prenatalOther: '',
      signs: {},
      preSpo2: '', preQuality: false,
      postSpo2: '', postQuality: false,
      hardware: null,
      evaluation: null,
      showSensorGuide: false,
      memYellows: 0,
      sessionHistory: [],
      countdownSec: 0,
      countdownTotal: 0,
      viewCui: '',
      confirmDelete: false,
      toastMsg: null
    };
  }

  var state = initialState();
  var timer = null;
  var toastTimer = null;
  var root = document.getElementById('root');

  function setState(patch) {
    Object.assign(state, patch);
    render();
  }
  function toast(msg) {
    state.toastMsg = msg;
    render();
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { setState({ toastMsg: null }); }, 3500);
  }

  // ---------------------------------------------------------------- derivados
  function birthTimestamp() {
    if (!state.birthDate || !state.birthTime) return null;
    var born = new Date(state.birthDate + 'T' + state.birthTime);
    return isNaN(born.getTime()) ? null : born.getTime();
  }
  function minutesOfLife() {
    var born = birthTimestamp();
    return born == null ? null : Math.floor((Date.now() - born) / 60000);
  }
  function ageLabel() {
    var m = minutesOfLife();
    if (m == null) return '—';
    if (m < 0) return 'fecha futura';
    return Math.floor(m / 60) + ' h ' + (m % 60) + ' min';
  }
  function currentMode() { return T.modeForMinutes(minutesOfLife()); }
  function altitudeValue() {
    if (state.altitude === '') return null;
    var v = Number(state.altitude);
    // Solo dígitos, así que no hay negativos: el punto más bajo del Perú es el mar.
    return isFinite(v) && v >= 0 && v <= 9000 ? v : null;
  }
  function anySign() { return SIGNS.some(function (s) { return !!state.signs[s.key]; }); }
  function signList() {
    return SIGNS.filter(function (s) { return state.signs[s.key]; }).map(function (s) { return s.label; });
  }
  function prenatalHistoryList() {
    if (state.prenatalHistory.noneKnown) return ['Sin antecedentes prenatales conocidos'];
    return PRENATAL_HISTORY.filter(function (item) {
      return !!state.prenatalHistory[item.key];
    }).map(function (item) { return item.label; });
  }
  function cuiOk() {
    var code = S.normalizePatientCode(state.cui);
    return S.RN_UNIQUE_CODE_PATTERN.test(code) || !!S.getChild(code);
  }
  function dniOk() { return S.isValidDni(state.dniMadre); }
  function canProceedPatient() {
    return cuiOk() && dniOk() && currentMode() != null && altitudeValue() != null;
  }

  /* Mientras el código va a medias se muestra cuánto falta, en tono neutro.
   * Marcarlo en rojo desde el primer dígito sería regañar al que teclea. */
  function digitsCounter(value, min, max) {
    var n = value.length;
    if (n === 0 || (n >= min && n <= max)) return '';
    return '<div class="field-counter">' + n + ' de ' +
      (min === max ? min : min + ' a ' + max) + ' dígitos</div>';
  }
  function spo2Ok(v) {
    if (v === '') return false;
    var n = Number(v);
    return isFinite(n) && n >= 0 && n <= 100;
  }

  /* Repeticiones consecutivas para este niño y este modelo.
   * Sale del almacenamiento, no de la memoria: si la app se cierra entre
   * repeticiones, la escalada a positivo tiene que seguir contando. */
  function priorYellows() {
    if (!S.available() || !cuiOk()) return state.memYellows;
    var mode = currentMode();
    var cutoff = Date.now() - T.CAL.REPEAT_WINDOW_MIN * 60000;
    var evs = S.evaluationsFor(state.cui).filter(function (e) { return e.model === mode; });
    var count = 0;
    for (var i = evs.length - 1; i >= 0; i--) {
      if (new Date(evs[i].createdAt).getTime() < cutoff) break;
      if (evs[i].level !== 'yellow') break;
      count++;
    }
    return count;
  }

  // ------------------------------------------------------------------ acciones
  var actions = {
    pressDigit: function (d) {
      if (state.pin.length >= 4) return;
      state.pin += d;
      render();
      if (state.pin.length === 4) {
        setTimeout(function () { setState({ screen: 'patient', pin: '' }); }, 350);
      }
    },
    backspace: function () { setState({ pin: state.pin.slice(0, -1) }); },

    toggleSign: function (key) {
      state.signs[key] = !state.signs[key];
      render();
    },

    togglePrenatalHistory: function (key) {
      if (key === 'noneKnown') {
        state.prenatalHistory = state.prenatalHistory.noneKnown ? {} : { noneKnown: true };
      } else {
        state.prenatalHistory.noneKnown = false;
        state.prenatalHistory[key] = !state.prenatalHistory[key];
      }
      render();
    },

    detectAltitude: function () {
      setState({ gpsDetecting: true, gpsError: '' });
      getPosition().then(function (pos) {
        var alt = pos && pos.coords ? pos.coords.altitude : null;
        if (alt == null) {
          setState({ gpsDetecting: false, gpsError: 'El GPS no reportó altitud en este equipo. Ingrésela manualmente.' });
          return;
        }
        setState({
          gpsDetecting: false, altitude: String(Math.round(alt)),
          altitudeSource: 'GPS', locationName: '', gpsError: '',
          // Latitud y longitud no se usan para el tamizaje, pero son las que
          // permiten ordenar los centros de referencia por cercanía.
          originLat: pos.coords.latitude, originLon: pos.coords.longitude
        });
      }).catch(function (err) {
        setState({
          gpsDetecting: false,
          gpsError: 'No se pudo obtener la ubicación (' + (err && err.message ? err.message : 'permiso denegado') + '). Ingrésela manualmente.'
        });
      });
    },
    togglePostPicker: function () { setState({ showPostPicker: !state.showPostPicker }); },
    selectPost: function (idx) {
      if (idx === '') return;
      var p = HEALTH_POSTS[Number(idx)];
      setState({
        altitude: String(p.altitud), locationName: p.nombre,
        altitudeSource: 'Puesto de salud', gpsError: '',
        originLat: p.lat, originLon: p.lon, departamento: p.departamento
      });
    },

    goPatientNext: function () {
      if (!canProceedPatient()) return;
      setState({ screen: currentMode() === 'adaptation' ? 'measure' : 'stepA' });
    },

    togglePreQuality: function () { setState({ preQuality: !state.preQuality }); },
    togglePostQuality: function () { setState({ postQuality: !state.postQuality }); },
    toggleSensorGuide: function () { setState({ showSensorGuide: !state.showSensorGuide }); },
    goStepB: function () { if (spo2Ok(state.preSpo2) && state.preQuality) setState({ screen: 'stepB' }); },
    goStepC: function () { if (spo2Ok(state.postSpo2) && state.postQuality) setState({ screen: 'stepC' }); },
    selectNeonatal: function () { setState({ hardware: 'neonatal' }); },
    selectAdult: function () { setState({ hardware: 'adult' }); },

    evaluateAdaptation: function () {
      if (!(spo2Ok(state.preSpo2) && state.preQuality)) return;
      finish(T.classifyAdaptation({
        spo2: Number(state.preSpo2),
        minutes: minutesOfLife(),   // congelado en el instante de evaluar
        altitude: altitudeValue(),
        signs: anySign(),
        priorYellows: priorYellows()
      }));
    },
    evaluateCCHD: function () {
      if (state.hardware == null) return;
      finish(T.classifyCCHD({
        pre: Number(state.preSpo2),
        post: Number(state.postSpo2),
        altitude: altitudeValue(),
        signs: anySign(),
        priorYellows: priorYellows()
      }));
    },

    skipCountdown: function () { clearCountdown(); setState({ countdownSec: 0 }); },
    repeatMeasurement: function () {
      if (state.countdownSec > 0) return;
      clearCountdown();
      setState({
        screen: currentMode() === 'adaptation' ? 'measure' : 'stepA',
        preSpo2: '', preQuality: false, postSpo2: '', postQuality: false,
        hardware: null, evaluation: null, showSensorGuide: false,
        countdownSec: 0, countdownTotal: 0
      });
    },
    finishPatient: function () { newPatient(); },

    generateRnCode: function () {
      var code = S.generatePatientCode(state.cui);
      if (!code) {
        toast('Escriba primero el apellido paterno del recién nacido.');
        return;
      }
      state.cui = code;
      state.lastLookup = '';
      lookupChild();
      render();
    },

    // ---- alta y programación de seguimiento ----
    openDischargeSchedule: function () {
      var ev = state.evaluation;
      // La adaptación no decide alta; tampoco un resultado amarillo, rojo o
      // verde con signos clínicos puede abrir este flujo.
      if (!ev || ev.model !== 'cchd' || ev.level !== 'green' || ev.clinicalOverride) return;
      var stamp = new Date().toISOString();
      if (state.lastEvalId) {
        var saved = S.updateEvaluation(state.lastEvalId, { altaEn: stamp, altaEstado: 'registrada' });
        if (!saved.ok) toast('No se pudo registrar el alta (' + saved.error + ').');
      }
      setState({ screen: 'schedule', dischargeAt: stamp, scheduleSaved: null });
    },

    saveFollowupSchedule: function () {
      if (!followupConfigured()) {
        toast('El envío de WhatsApp no está configurado en esta demo.');
        return;
      }
      var cfg = F.normalize({
        firstDate: state.scheduleDate,
        time: scheduleTimeValue(),
        everyDays: state.scheduleEveryDays,
        count: state.scheduleCount
      });
      if (!M.isValidPhone(state.telefono)) {
        toast('Ingrese un celular peruano válido para programar los mensajes.');
        return;
      }
      if (!cfg || !state.dischargeAt) {
        toast('Revise la fecha, la hora, la frecuencia y la cantidad de envíos.');
        return;
      }
      if (!state.lastEvalId) {
        toast('No se puede programar: la evaluación no quedó guardada.');
        return;
      }

      var occurrences = F.buildOccurrences(cfg);
      if (!occurrences.length || new Date(occurrences[0]).getTime() < Date.now() - 60000) {
        toast('La fecha y hora del primer mensaje no pueden estar en el pasado.');
        return;
      }
      var programmedAt = new Date().toISOString();
      var schedule = {
        estado: 'programado_local',
        destino: M.normalizePhone(state.telefono),
        firstDate: cfg.firstDate,
        time: cfg.time,
        everyDays: cfg.everyDays,
        count: cfg.count,
        occurrences: occurrences,
        deliveries: occurrences.map(function (scheduledAt) {
          return { scheduledAt: scheduledAt, status: 'pending' };
        }),
        programmedAt: programmedAt,
        message: M.buildCheckIn({ establecimiento: state.locationName })
      };
      var res = S.updateEvaluation(state.lastEvalId, {
        seguimientoProgramadoEstado: schedule.estado,
        seguimientoProgramadoDestino: schedule.destino,
        seguimientoProgramadoFecha: schedule.firstDate,
        seguimientoProgramadoHora: schedule.time,
        seguimientoProgramadoCadaDias: schedule.everyDays,
        seguimientoProgramadoCantidad: schedule.count,
        seguimientoProgramadoEnvios: schedule.occurrences,
        seguimientoProgramadoEntregas: schedule.deliveries,
        seguimientoProgramadoEn: schedule.programmedAt,
        seguimientoProgramadoMensaje: schedule.message
      });
      if (!res.ok) { toast('No se pudo guardar la programación (' + res.error + ').'); return; }
      S.upsertChild({ cui: state.cui, telefono: state.telefono });
      setState({ scheduleSaved: schedule });
      processDueFollowups();
      toast('Seguimiento programado correctamente.');
    },

    editFollowupSchedule: function () {
      setState({ scheduleSaved: null });
    },

    skipFollowupSchedule: function () {
      if (state.lastEvalId) {
        S.updateEvaluation(state.lastEvalId, { seguimientoProgramadoEstado: 'omitido' });
      }
      newPatient();
    },

    // ---- derivación ----
    openReferral: function () { setState({ screen: 'referral' }); },
    closeReferral: function () { setState({ screen: 'result' }); },

    /* Registra la solicitud contra la evaluación que la motivó. Queda como
     * pendiente de envío: sin servidor todavía, pero con la traza de quién
     * pidió qué, a dónde y cuándo. */
    requestHelp: function (arg) {
      var parts = String(arg || '').split('|');
      var tipo = parts[0], codigo = parts[1];
      var eess = E.byCode(codigo);
      if (!eess || !state.lastEvalId) return;

      var req = {
        tipo: tipo,                       // 'teleconsulta' | 'referencia'
        eessCodigo: eess.codigo,
        eessNombre: eess.nombre,
        solicitadoEn: new Date().toISOString(),
        estado: 'pendiente_envio',
        antecedentesPrenatales: prenatalHistoryList(),
        antecedentesPrenatalesOtros: state.prenatalOther.trim()
      };
      var res = S.updateEvaluation(state.lastEvalId, {
        derivacionTipo: tipo,
        derivacionDestino: eess.nombre,
        derivacionSolicitadaEn: req.solicitadoEn,
        derivacionEstado: req.estado,
        antecedentesPrenatales: req.antecedentesPrenatales,
        antecedentesPrenatalesOtros: req.antecedentesPrenatalesOtros
      });
      if (!res.ok) { toast('No se pudo registrar la solicitud (' + res.error + ').'); return; }
      setState({ referralSent: req, screen: 'result' });
      toast((tipo === 'teleconsulta' ? 'Teleconsulta' : 'Referencia') + ' solicitada a ' + eess.nombre + '.');
    },

    // ---- historial ----
    openHistory: function () { setState({ screen: 'history', confirmDelete: false }); },
    closeHistory: function () { setState({ screen: state.evaluation ? 'result' : 'patient' }); },
    openChild: function (cui) { setState({ screen: 'child', viewCui: cui }); },
    backToHistory: function () { setState({ screen: 'history', viewCui: '' }); },

    followUp: function (cui) {
      var child = S.getChild(cui);
      if (!child) return;
      var fresh = initialState();
      fresh.screen = 'patient';
      fresh.cui = child.cui;
      fresh.lastLookup = child.cui;
      fresh.knownChild = child;
      fresh.dniMadre = child.dniMadre || '';
      fresh.telefono = child.telefono || '';
      fresh.birthDate = child.birthDate || fresh.birthDate;
      fresh.birthTime = child.birthTime || '';
      clearCountdown();
      state = fresh;
      render();
    },

    exportCSV: function () {
      var evals = S.allEvaluations();
      if (!evals.length) { toast('No hay registros para exportar.'); return; }
      var csv = S.toCSV(evals);
      var name = 'cardio-alerta-' + new Date().toISOString().slice(0, 10) + '.csv';
      saveFile(name, csv).then(function (where) {
        // Solo se marca como exportado si el archivo se escribió de verdad.
        S.markExported(evals.map(function (e) { return e.id; }));
        toast(evals.length + ' registros exportados a ' + where + '.');
      }).catch(function (err) {
        toast('No se pudo exportar: ' + (err && err.message ? err.message : 'error desconocido'));
      });
    },

    armDelete: function () { setState({ confirmDelete: true }); },
    cancelDelete: function () { setState({ confirmDelete: false }); },
    deleteExported: function () {
      var ids = S.exported().map(function (e) { return e.id; });
      if (!ids.length) { setState({ confirmDelete: false }); return; }
      var res = S.removeEvaluations(ids);
      setState({ confirmDelete: false });
      toast(res.ok ? ids.length + ' registros exportados eliminados.' : 'No se pudieron eliminar.');
    }
  };

  // El plugin nativo de Capacitor entrega la altitud del GPS; el API del
  // navegador la deja en null en la mayoría de equipos de escritorio.
  // ponytail: coords.altitude es altura elipsoidal WGS84. En los Andes el
  // geoide está unos 30–50 m por debajo, lo que a 0.0035 %/m mueve el umbral
  // menos de 0.2 puntos. Si alguna vez importa, restar la ondulación aquí.
  function getPosition() {
    var cap = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Geolocation;
    if (cap) return cap.getCurrentPosition({ enableHighAccuracy: true, timeout: 15000 });
    if (!navigator.geolocation) return Promise.reject(new Error('sin soporte de GPS'));
    return new Promise(function (resolve, reject) {
      navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 15000 });
    });
  }

  /* En el APK, un <a download> dentro del WebView no descarga nada: hay que
   * escribir el archivo con Filesystem y ofrecerlo por el menú de compartir. */
  function saveFile(name, text) {
    var P = window.Capacitor && window.Capacitor.Plugins;
    if (P && P.Filesystem) {
      return P.Filesystem.writeFile({
        path: name, data: text, directory: 'DOCUMENTS', encoding: 'utf8'
      }).then(function (res) {
        if (!P.Share) return 'Documentos';
        return P.Share.share({ title: 'Registros Cardio Alerta', url: res.uri })
          .then(function () { return 'Documentos'; })
          .catch(function () { return 'Documentos'; }); // el usuario canceló el menú
      });
    }
    return new Promise(function (resolve, reject) {
      try {
        var blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 0);
        resolve('descargas');
      } catch (e) { reject(e); }
    });
  }

  function buildRecord(ev) {
    var rec = {
      cui: state.cui,
      dniMadre: state.dniMadre,
      birthDate: state.birthDate,
      birthTime: state.birthTime,
      minutesOfLife: ev.model === 'adaptation' ? ev.minutes : minutesOfLife(),
      model: ev.model,
      level: ev.level,
      reason: ev.reason,
      attempt: ev.attempt,
      escalated: !!ev.escalated,
      altitude: altitudeValue(),
      locationName: state.locationName,
      altitudeSource: state.altitudeSource,
      signs: signList(),
      unreliable: !!ev.unreliable,
      unvalidatedAltitude: !!ev.unvalidatedAltitude,
      calibration: { K_ALT: T.CAL.K_ALT, DIFF_MAX: T.CAL.DIFF_MAX, MAX_REPEATS: T.CAL.MAX_REPEATS }
    };
    if (ev.model === 'cchd') {
      rec.pre = ev.pre;
      rec.post = ev.post;
      rec.diff = ev.diff;
      rec.hardware = state.hardware;
      rec.stratumLabel = ev.stratum.label;
      rec.passThreshold = ev.stratum.pass;
      rec.criticalThreshold = ev.stratum.critical;
    } else {
      rec.pre = ev.spo2;
      rec.post = null;
      rec.diff = null;
      rec.passThreshold = Number(ev.thresholds.p10.toFixed(1));
      rec.criticalThreshold = Number(ev.thresholds.p3.toFixed(1));
      rec.stratumLabel = 'adaptación · Δ' + ev.thresholds.delta.toFixed(1);
    }
    return rec;
  }

  function finish(evaluation) {
    state.evaluation = evaluation;
    state.screen = 'result';
    if (evaluation.level === 'yellow') state.memYellows += 1;
    state.sessionHistory = state.sessionHistory.concat([{
      n: state.sessionHistory.length + 1,
      level: evaluation.level,
      pre: evaluation.model === 'cchd' ? evaluation.pre : evaluation.spo2,
      post: evaluation.model === 'cchd' ? evaluation.post : null,
      at: new Date()
    }]);

    if (evaluation.repeatMin > 0) startCountdown(evaluation.repeatMin * 60);
    else { clearCountdown(); state.countdownSec = 0; state.countdownTotal = 0; }

    S.upsertChild({
      cui: state.cui, dniMadre: state.dniMadre, telefono: state.telefono,
      birthDate: state.birthDate, birthTime: state.birthTime
    });
    var res = S.saveEvaluation(buildRecord(evaluation));
    state.lastEvalId = res.ok ? res.record.id : null;
    state.referralSent = null;

    render();
    // Un fallo al guardar no puede pasar desapercibido: el registro clínico
    // se habría perdido.
    if (res.ok) toast('Registro guardado en el equipo.');
    else toast('ATENCIÓN: no se guardó el registro (' + res.error + ').');
  }

  function startCountdown(seconds) {
    clearCountdown();
    state.countdownSec = seconds;
    state.countdownTotal = seconds;
    timer = setInterval(function () {
      state.countdownSec = Math.max(0, state.countdownSec - 1);
      if (state.countdownSec === 0) clearCountdown();
      render();
    }, 1000);
  }
  function clearCountdown() { if (timer) { clearInterval(timer); timer = null; } }

  function newPatient() {
    clearCountdown();
    state = initialState();
    state.screen = 'patient';
    render();
  }

  // ------------------------------------------------------------------- render
  function header() {
    if (state.screen === 'login') return '';
    var showId = ['measure', 'stepA', 'stepB', 'stepC', 'result', 'referral', 'schedule'].indexOf(state.screen) !== -1;
    var pend = S.available() ? S.pending().length : 0;
    return '<div class="header"><div>' +
      '<div class="header-title">Cardio Alerta</div>' +
      (showId && cuiOk() ? '<div class="header-sub">RN ' + escText(state.cui) + '</div>' : '') +
      '</div>' +
      '<button type="button" class="hist-btn" data-action="openHistory">Historial' +
      (pend ? '<span class="badge">' + pend + '</span>' : '') + '</button>' +
      '</div>';
  }

  function checkbox(label, checked, action, arg, tone) {
    return '<button type="button" class="checkbox-row' + (tone ? ' ' + tone : '') + '" data-action="' + action + '"' +
      (arg != null ? ' data-arg="' + escAttr(arg) + '"' : '') + '>' +
      '<span class="checkbox-box' + (checked ? ' checked' : '') + '"></span>' +
      '<span>' + escText(label) + '</span></button>';
  }

  function loginScreen() {
    var keys = '';
    for (var i = 1; i <= 9; i++) {
      keys += '<button type="button" class="key" data-action="pressDigit" data-arg="' + i + '">' + i + '</button>';
    }
    keys += '<span class="key blank"></span>';
    keys += '<button type="button" class="key" data-action="pressDigit" data-arg="0">0</button>';
    keys += '<button type="button" class="key back" data-action="backspace">Borrar</button>';
    var dots = [0, 1, 2, 3].map(function (i) {
      return '<span class="pin-dot' + (state.pin.length > i ? ' filled' : '') + '"></span>';
    }).join('');
    return '<div class="login-screen">' +
      '<div class="login-title"><div class="brand">Cardio Alerta</div>' +
      '<div class="sub">Monitoreo cardiopulmonar neonatal</div></div>' +
      '<div class="pin-dots">' + dots + '</div>' +
      '<div class="keypad">' + keys + '</div>' +
      '<div class="login-hint">PIN de 4 dígitos · acceso rápido para emergencias</div></div>';
  }

  function modeBanner() {
    var mode = currentMode();
    if (minutesOfLife() == null) {
      return '<div class="mode-banner neutral">Ingrese fecha y hora de nacimiento para determinar la evaluación aplicable.</div>';
    }
    if (mode == null) {
      return '<div class="mode-banner danger">La hora de nacimiento está en el futuro. Corríjala para continuar.</div>';
    }
    if (mode === 'adaptation') {
      return '<div class="mode-banner amber"><strong>Evaluación de adaptación</strong>' +
        '<span>Menos de 24 h de vida. Se compara contra percentiles por minuto de vida corregidos por altitud. ' +
        'Esto <strong>no</strong> es un tamizaje de cardiopatía: ese debe hacerse a partir de las 24 h.</span></div>';
    }
    var st = altitudeValue() != null ? T.getStratum(altitudeValue()) : null;
    return '<div class="mode-banner teal"><strong>Tamizaje de cardiopatía congénita crítica</strong>' +
      '<span>24 h de vida o más. Requiere medición pre-ductal y post-ductal.' +
      (st ? ' Estrato ' + escText(st.label) + ': pase ≥ ' + st.pass + ' %, crítico &lt; ' + st.critical + ' %.' : '') +
      '</span></div>';
  }

  function cuiBlock() {
    var known = state.knownChild;
    var prev = known ? S.evaluationsFor(known.cui) : [];
    return '<div><label class="field-label" for="cui-input">Identificador del recién nacido</label>' +
      '<div class="alt-row"><input id="cui-input" class="field-input mono rn-code-input" type="text" ' +
      'autocomplete="off" autocapitalize="characters" maxlength="' + S.RN_CODE_MAX + '" data-bind="cui" ' +
      'value="' + escAttr(state.cui) + '" placeholder="Apellido paterno" />' +
      '<button type="button" class="detect-btn" data-action="generateRnCode">Generar</button></div>' +
      (state.cui && !cuiOk()
        ? '<div class="field-counter">Escriba el apellido y pulse Generar.</div>' : '') +
      '<div class="field-hint">Ejemplo: RN-QUISPE-A7K4. El código final distingue a niños con el mismo apellido.</div>' +
      (known
        ? '<div class="known-child">Paciente ya registrado · ' + prev.length +
          (prev.length === 1 ? ' evaluación previa' : ' evaluaciones previas') +
          (prev.length ? '<button type="button" class="link" data-action="openChild" data-arg="' + escAttr(known.cui) + '">Ver historial</button>' : '') +
          '</div>'
        : '') +
      '</div>';
  }

  function altitudeBlock() {
    var posts = HEALTH_POSTS.map(function (p, i) {
      return '<option value="' + i + '"' + (state.locationName === p.nombre ? ' selected' : '') + '>' +
        escText(p.nombre + ' — ' + p.altitud + ' msnm') + '</option>';
    }).join('');
    return '<div><label class="field-label" for="alt-input">Altitud del lugar de medición (msnm)</label>' +
      '<div class="alt-row">' +
      '<input id="alt-input" class="field-input" type="text" inputmode="numeric" pattern="[0-9]*" ' +
      'maxlength="4" autocomplete="off" ' +
      'data-bind="altitude" value="' + escAttr(state.altitude) + '" placeholder="Ej. 3399" />' +
      '<button type="button" class="detect-btn" data-action="detectAltitude"' + (state.gpsDetecting ? ' disabled' : '') + '>' +
      (state.gpsDetecting ? 'Buscando…' : 'GPS') + '</button></div>' +
      (state.locationName ? '<div class="field-hint">' + escText(state.locationName) + '</div>' : '') +
      (state.altitudeSource && !state.locationName ? '<div class="field-hint">Origen: ' + escText(state.altitudeSource) + '</div>' : '') +
      (state.gpsError ? '<div class="field-error">' + escText(state.gpsError) + '</div>' : '') +
      (altitudeValue() != null && altitudeValue() > T.CAL.ALT_VALIDATED_MAX
        ? '<div class="field-error">Por encima de ' + T.CAL.ALT_VALIDATED_MAX + ' msnm, fuera del rango validado. Se aplican los umbrales del estrato más alto y el registro queda marcado.</div>' : '') +
      '<button type="button" class="link manual-toggle" data-action="togglePostPicker">' +
      (state.showPostPicker ? 'Ocultar puestos de salud' : 'Elegir un puesto de salud') + '</button>' +
      (state.showPostPicker
        ? '<select class="manual-select" data-bind-change="selectPost"><option value="">Seleccionar…</option>' + posts + '</select>'
        : '') + '</div>';
  }

  function patientScreen() {
    return '<div class="screen">' +
      '<div><div class="step-title">Nueva evaluación</div>' +
      '<div class="screen-sub">Identificación del paciente</div></div>' +
      cuiBlock() +
      '<div><label class="field-label" for="dni-input">DNI de la madre</label>' +
      '<input id="dni-input" class="field-input mono" type="text" inputmode="numeric" ' +
      'pattern="[0-9]*" autocomplete="off" maxlength="' + S.DNI_LENGTH + '" data-bind="dniMadre" ' +
      'value="' + escAttr(state.dniMadre) + '" placeholder="' + S.DNI_LENGTH + ' dígitos" />' +
      digitsCounter(state.dniMadre, S.DNI_LENGTH, S.DNI_LENGTH) + '</div>' +

      '<div class="two-col">' +
      '<div><label class="field-label" for="birthdate-input">Fecha de nacimiento</label>' +
      '<input id="birthdate-input" type="date" class="field-input small" data-bind-change="birthDate" value="' + escAttr(state.birthDate) + '" /></div>' +
      '<div><label class="field-label" for="birthtime-input">Hora de nacimiento</label>' +
      '<input id="birthtime-input" type="time" class="field-input small" data-bind-change="birthTime" value="' + escAttr(state.birthTime) + '" /></div>' +
      '</div>' +
      '<div class="hours-label">Tiempo de vida: ' + escText(ageLabel()) + '</div>' +
      modeBanner() +
      '<div><label class="field-label">Signos clínicos presentes</label>' +
      '<div class="signs-grid">' +
      SIGNS.map(function (s) { return checkbox(s.label, !!state.signs[s.key], 'toggleSign', s.key); }).join('') +
      '</div></div>' +
      altitudeBlock() +
      '<div class="spacer"></div>' +
      '<button type="button" class="btn-primary" data-action="goPatientNext"' + (canProceedPatient() ? '' : ' disabled') + '>Continuar</button>' +
      '</div>';
  }

  function spo2Field(id, bindKey, value) {
    return '<div><label class="spo2-label" for="' + id + '">SpO₂ (%)</label>' +
      '<input id="' + id + '" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="3" ' +
      'autocomplete="off" class="spo2-input" ' +
      'data-bind="' + bindKey + '" value="' + escAttr(value) + '" placeholder="—" /></div>';
  }

  var QUALITY_TEXT = 'Confirmo que la curva del oxímetro es simétrica y estable.';

  /* Una sola guía sirve para mano/muñeca derecha y pie. La imagen no pretende
   * "calibrar" el equipo: ayuda a reconocer una señal utilizable antes de
   * aceptar el número mostrado por el oxímetro. */
  function sensorGuideCard() {
    return '<section class="sensor-guide" aria-label="Cómo verificar la señal del oxímetro">' +
      '<div class="sensor-guide-head"><strong>Antes de confirmar la lectura</strong>' +
      '<span>Observe la curva, no solo el número.</span></div>' +
      '<img src="assets/guia-curva-oximetro.png" ' +
      'alt="Comparación entre un sensor flojo con una curva irregular y un sensor bien ajustado con una curva regular y estable" />' +
      '<div class="sensor-guide-legend" aria-hidden="true"><span>Señal inestable</span><span>Señal confiable</span></div>' +
      '<ul><li>Mantenga al bebé quieto y la extremidad tibia.</li>' +
      '<li>Ajuste el sensor sin comprimir; emisor y receptor deben quedar enfrentados.</li>' +
      '<li>Espere una curva regular y un valor estable antes de marcar la casilla.</li></ul>' +
      '</section>';
  }

  function resultSensorGuide() {
    return '<div class="sensor-guide-result">' +
      '<button type="button" class="sensor-guide-toggle" data-action="toggleSensorGuide" ' +
      'aria-expanded="' + (state.showSensorGuide ? 'true' : 'false') + '">' +
      (state.showSensorGuide ? 'Ocultar guía de verificación' : 'Ver qué hacer y verificar la lectura') +
      '<span aria-hidden="true">' + (state.showSensorGuide ? '−' : '+') + '</span></button>' +
      (state.showSensorGuide ? sensorGuideCard() : '') + '</div>';
  }

  function measureScreen() {
    var ready = spo2Ok(state.preSpo2) && state.preQuality;
    return '<div class="screen screen-gap-20">' +
      '<div class="step-label">Adaptación · medición única</div>' +
      '<div class="step-title">Saturación pre-ductal</div>' +
      '<div class="step-instruction">Coloque el sensor en la mano o muñeca derecha</div>' +
      spo2Field('prespo2-input', 'preSpo2', state.preSpo2) +
      checkbox(QUALITY_TEXT, state.preQuality, 'togglePreQuality', null, 'quality') +
      sensorGuideCard() +
      '<div class="spacer"></div>' +
      '<button type="button" class="btn-primary" data-action="evaluateAdaptation"' + (ready ? '' : ' disabled') + '>Evaluar adaptación</button>' +
      '</div>';
  }

  function stepAScreen() {
    var ready = spo2Ok(state.preSpo2) && state.preQuality;
    return '<div class="screen screen-gap-20">' +
      '<div class="step-label">Paso 1 de 3</div>' +
      '<div class="step-title">Medición pre-ductal</div>' +
      '<div class="step-instruction">Coloque el sensor en la mano o muñeca derecha</div>' +
      spo2Field('prespo2-input', 'preSpo2', state.preSpo2) +
      checkbox(QUALITY_TEXT, state.preQuality, 'togglePreQuality', null, 'quality') +
      sensorGuideCard() +
      '<div class="spacer"></div>' +
      '<button type="button" class="btn-primary" data-action="goStepB"' + (ready ? '' : ' disabled') + '>Continuar a paso 2</button>' +
      '</div>';
  }

  function stepBScreen() {
    var ready = spo2Ok(state.postSpo2) && state.postQuality;
    return '<div class="screen screen-gap-20">' +
      '<div class="step-label">Paso 2 de 3</div>' +
      '<div class="step-title">Medición post-ductal</div>' +
      '<div class="step-instruction">Coloque el sensor en cualquiera de los pies</div>' +
      spo2Field('postspo2-input', 'postSpo2', state.postSpo2) +
      checkbox(QUALITY_TEXT, state.postQuality, 'togglePostQuality', null, 'quality') +
      sensorGuideCard() +
      '<div class="spacer"></div>' +
      '<button type="button" class="btn-primary" data-action="goStepC"' + (ready ? '' : ' disabled') + '>Continuar a paso 3</button>' +
      '</div>';
  }

  function stepCScreen() {
    return '<div class="screen">' +
      '<div class="step-label">Paso 3 de 3</div>' +
      '<div class="step-title">Tipo de sensor utilizado</div>' +
      '<button type="button" class="hw-btn' + (state.hardware === 'neonatal' ? ' selected' : '') + '" data-action="selectNeonatal">' +
      '<span class="hw-title">Sensor Neonatal (Envoltura)</span>' +
      '<span class="hw-sub">Recomendado para recién nacidos</span></button>' +
      '<button type="button" class="hw-btn' + (state.hardware === 'adult' ? ' selected' : '') + '" data-action="selectAdult">' +
      '<span class="hw-title">Sensor de Adulto (Pinza)</span>' +
      '<span class="hw-sub">Se registrará como baja confianza para auditoría</span></button>' +
      (state.hardware === 'adult' ? '<span class="low-confidence-note">low_confidence · auditoría</span>' : '') +
      '<div class="spacer"></div>' +
      '<button type="button" class="btn-primary" data-action="evaluateCCHD"' + (state.hardware != null ? '' : ' disabled') + '>Evaluar</button>' +
      '</div>';
  }

  function row(label, value) {
    return '<div class="summary-row"><span class="label">' + escText(label) + '</span>' +
      '<span class="value">' + escText(value) + '</span></div>';
  }

  function summaryCard(ev) {
    var out = '<div class="summary-card">';
    out += row('Código del recién nacido', state.cui);
    if (ev.model === 'cchd') {
      out += row('Pre-ductal (mano)', ev.pre + ' %');
      out += row('Post-ductal (pie)', ev.post + ' %');
      out += row('Diferencia', ev.diff + ' pts');
      out += row('Estrato', ev.stratum.label);
      out += row('Umbrales', 'pase ≥ ' + ev.stratum.pass + ' % · crítico < ' + ev.stratum.critical + ' %');
      out += row('Sensor', state.hardware === 'adult' ? 'Adulto (Pinza)' : 'Neonatal (Envoltura)');
    } else {
      out += row('Pre-ductal (mano)', ev.spo2 + ' %');
      out += row('Tiempo de vida', Math.floor(ev.minutes / 60) + ' h ' + (ev.minutes % 60) + ' min');
      out += row('Esperado (p50)', ev.thresholds.ref.p50.toFixed(1) + ' % a nivel del mar');
      out += row('Corrección altitud', '−' + ev.thresholds.delta.toFixed(1) + ' pts');
      out += row('Umbrales locales', 'vigilar < ' + ev.thresholds.p10.toFixed(1) + ' % · alerta < ' + ev.thresholds.p3.toFixed(1) + ' %');
    }
    out += row('Altitud', altitudeValue() + ' msnm' + (state.locationName ? ' · ' + state.locationName : ''));
    out += row('Signos clínicos', signList().length ? signList().join(', ') : 'Ninguno');
    return out + '</div>';
  }

  function sessionHistoryBlock() {
    if (state.sessionHistory.length < 2) return '';
    return '<div class="history"><div class="history-title">Mediciones de esta sesión</div>' +
      state.sessionHistory.map(function (h) {
        var v = h.post != null ? h.pre + ' / ' + h.post + ' %' : h.pre + ' %';
        return '<div class="history-row"><span class="hist-dot ' + h.level + '"></span>' +
          '<span>Intento ' + h.n + '</span><span class="hist-val">' + escText(v) + '</span>' +
          '<span class="hist-time">' + h.at.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' }) + '</span></div>';
      }).join('') + '</div>';
  }

  function calibrationBlock(ev) {
    var rows = row('Coef. altitud (K)', T.CAL.K_ALT + ' %/m') +
      row('Diferencial máximo', T.CAL.DIFF_MAX + ' pts') +
      row('Repeticiones máximas', T.CAL.MAX_REPEATS) +
      row('Piso de umbral', T.CAL.SPO2_FLOOR + ' %');
    return '<details class="calib"><summary>Parámetros de calibración aplicados</summary>' +
      '<div class="summary-card flat">' + rows +
      (ev.unvalidatedAltitude ? row('Aviso', 'altitud fuera del rango validado') : '') +
      '</div></details>';
  }

  function countdownBlock() {
    if (state.countdownTotal === 0) return '';
    var cd = state.countdownSec;
    var mm = String(Math.floor(cd / 60)).padStart(2, '0');
    var ss = String(cd % 60).padStart(2, '0');
    return '<div class="countdown"><div class="countdown-value">' + mm + ':' + ss + '</div>' +
      '<div class="countdown-caption">' +
      (cd === 0 ? 'Tiempo cumplido — puede repetir la medición.' : 'Tiempo restante para repetir la medición') +
      '</div>' +
      (cd > 0 ? '<button type="button" class="link" data-action="skipCountdown">Adelantar tiempo (demo)</button>' : '') +
      '</div>';
  }

  function unreliableNote(ev) {
    if (!ev.unreliable) return '';
    return '<div class="warn-inline">Lectura por debajo de ' + T.CAL.UNRELIABLE_BELOW +
      ' %: verifique posición del sensor, perfusión y temperatura antes de asumir hipoxemia.</div>';
  }

  function storedNote() {
    var n = S.available() ? S.pending().length : 0;
    return '<div class="sync-note">' + (S.available()
      ? 'Guardado en este equipo · ' + n + ' sin exportar.'
      : 'Sin almacenamiento disponible: este registro no se guardó.') + '</div>';
  }

  function schedulePreview(occurrences) {
    if (!occurrences.length) return '<div class="schedule-empty">Complete una programación válida para ver los envíos.</div>';
    return '<div class="schedule-timeline">' + occurrences.slice(0, 4).map(function (iso, i) {
      return '<div class="schedule-occurrence"><span>' + (i + 1) + '</span><strong>' + escText(fmtDateTime(iso)) + '</strong></div>';
    }).join('') + (occurrences.length > 4
      ? '<div class="schedule-more">+' + (occurrences.length - 4) + ' envíos con la misma frecuencia</div>' : '') + '</div>';
  }

  function scheduleTimeValue() {
    var hour = Number(state.scheduleHour);
    var minute = Number(state.scheduleMinute);
    if (!/^\d{1,2}$/.test(state.scheduleHour) || hour < 0 || hour > 23) return '';
    if (!/^\d{1,2}$/.test(state.scheduleMinute) || minute < 0 || minute > 59) return '';
    return String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0');
  }

  /* Campos de texto separados: los selectores y el reloj nativo se cerraban al
   * instante en algunos WebView Android. Aquí el personal escribe directamente. */
  function scheduleTimeControl() {
    return '<div class="schedule-time-parts">' +
      '<input id="schedule-hour" class="field-input" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="2" ' +
      'aria-label="Hora" data-bind="scheduleHour" value="' + escAttr(state.scheduleHour) + '" placeholder="HH" />' +
      '<span aria-hidden="true">:</span>' +
      '<input id="schedule-minute" class="field-input" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="2" ' +
      'aria-label="Minutos" data-bind="scheduleMinute" value="' + escAttr(state.scheduleMinute) + '" placeholder="MM" /></div>';
  }

  function scheduleScreen() {
    var cfg = F.normalize({
      firstDate: state.scheduleDate,
      time: scheduleTimeValue(),
      everyDays: state.scheduleEveryDays,
      count: state.scheduleCount
    });
    var occurrences = cfg ? F.buildOccurrences(cfg) : [];
    var phoneOk = M.isValidPhone(state.telefono);
    var freqOptions = F.FREQUENCIES.map(function (f) {
      return '<option value="' + f.days + '"' + (Number(state.scheduleEveryDays) === f.days ? ' selected' : '') + '>' +
        escText(f.label) + '</option>';
    }).join('');

    if (state.scheduleSaved) {
      return '<div class="screen schedule-screen">' +
        '<div class="discharge-mark" aria-hidden="true">✓</div>' +
        '<div class="step-title">Seguimiento programado</div>' +
        '<div class="screen-sub">Alta registrada · ' + escText(state.telefono) + '</div>' +
        '<div class="schedule-status"><strong>Seguimiento programado correctamente</strong>' +
        '<span>El primer mensaje se enviará en la fecha y hora indicadas.</span></div>' +
        schedulePreview(state.scheduleSaved.occurrences) +
        '<div class="msg-preview">' + escText(state.scheduleSaved.message) + '</div>' +
        '<div class="spacer"></div>' +
        '<button type="button" class="btn-primary btn-green" data-action="finishPatient">Finalizar</button></div>';
    }

    return '<div class="screen schedule-screen">' +
      '<div class="discharge-mark" aria-hidden="true">✓</div>' +
      '<div><div class="step-title">Alta registrada</div>' +
      '<div class="screen-sub">Programe mensajes para preguntar cómo sigue el recién nacido.</div></div>' +
      '<div class="schedule-note"><strong>Mensajes de seguimiento</strong>' +
      '<span>La familia recibirá una consulta de bienestar en cada fecha programada.</span></div>' +
      '<div><label class="field-label" for="schedule-phone">Celular del cuidador</label>' +
      '<input id="schedule-phone" class="field-input mono" type="text" inputmode="numeric" pattern="[0-9]*" ' +
      'maxlength="' + M.PHONE_LENGTH + '" data-bind="telefono" value="' + escAttr(state.telefono) + '" placeholder="9XXXXXXXX" />' +
      (!phoneOk && state.telefono ? '<div class="field-error">Ingrese 9 dígitos empezando por 9.</div>' : '') + '</div>' +
      '<div class="schedule-grid">' +
      '<div><label class="field-label" for="schedule-date">Fecha del primer mensaje</label>' +
      '<input id="schedule-date" class="field-input" type="date" min="' + todayISO() + '" ' +
      'data-bind-change="scheduleDate" value="' + escAttr(state.scheduleDate) + '" /></div>' +
      '<div><label class="field-label" for="schedule-hour">Hora y minutos</label>' + scheduleTimeControl() + '</div>' +
      '<div><label class="field-label" for="schedule-frequency">Frecuencia</label>' +
      '<select id="schedule-frequency" class="field-input" data-bind-change="scheduleEveryDays">' + freqOptions + '</select></div>' +
      '<div><label class="field-label" for="schedule-count">Cantidad de envíos</label>' +
      '<div class="unit-input"><input id="schedule-count" class="field-input" type="text" inputmode="numeric" maxlength="2" ' +
      'data-bind="scheduleCount" value="' + escAttr(state.scheduleCount) + '" /><span>máx. 12</span></div></div>' +
      '</div>' +
      '<div><div class="group-title">Próximos envíos</div>' + schedulePreview(occurrences) + '</div>' +
      '<details class="schedule-message"><summary>Ver mensaje que recibirá la familia</summary>' +
      '<div class="msg-preview">' + escText(M.buildCheckIn({ establecimiento: state.locationName })) + '</div></details>' +
      (followupConfigured()
        ? '<div class="schedule-pending">Los mensajes se enviarán al llegar cada fecha y hora programada.</div>'
        : '<div class="field-error">El envío de WhatsApp no está configurado para esta demo.</div>') +
      '<div class="spacer"></div>' +
      '<button type="button" class="btn-primary btn-green" data-action="saveFollowupSchedule"' +
      (cfg && phoneOk && followupConfigured() ? '' : ' disabled') + '>Programar seguimiento</button>' +
      '<button type="button" class="link schedule-skip" data-action="skipFollowupSchedule">Finalizar sin programar</button>' +
      '</div>';
  }

  /* Botón de ayuda. Aparece en todos los resultados: el personal puede querer
   * consultar aunque el tamizaje salga negativo. Si ya se solicitó algo, en su
   * lugar se muestra el acuse. */
  function referralBlock() {
    if (state.referralSent) {
      var r = state.referralSent;
      return '<div class="referral-done">' +
        '<div class="rd-title">' +
        (r.tipo === 'teleconsulta' ? 'Teleconsulta solicitada' : 'Referencia iniciada') + '</div>' +
        '<div class="rd-meta">' + escText(r.eessNombre) + '</div>' +
        '<div class="rd-state">Pendiente de envío · se transmitirá al recuperar conexión</div>' +
        '</div>';
    }
    return '<button type="button" class="btn-help" data-action="openReferral">' +
      'Pedir ayuda o derivar</button>';
  }

  /* Ayuda de estabilización para resultados críticos. La alerta de la app no
   * equivale a una indicación de PGE1: esa decisión requiere sospecha de una
   * cardiopatía ductus-dependiente y evaluación médica. */
  function prostaglandinGuide(ev) {
    if (!ev || ev.level !== 'red') return '';
    return '<details class="pge-guide" open><summary>Instructivo clínico: prostaglandina E1</summary>' +
      '<div class="pge-alert"><strong>No es una indicación automática.</strong> Usar alprostadil solo ante sospecha de ' +
      'cardiopatía ductus-dependiente, por personal médico entrenado, mientras se coordina la referencia urgente. ' +
      'No retrasar el traslado.</div>' +
      '<div class="pge-section"><strong>Antes de iniciar</strong><ul>' +
      '<li>Confirmar la indicación con neonatología o cardiología pediátrica.</li>' +
      '<li>Disponer de bomba de infusión, monitorización continua y capacidad inmediata de ventilación/intubación.</li>' +
      '<li>Revisar la presentación y concentración del medicamento disponible. No administrar en bolo.</li>' +
      '<li>Si se sospecha obstrucción del retorno venoso pulmonar, consultar de inmediato antes de iniciarla.</li>' +
      '</ul></div>' +
      '<div class="pge-dose"><span>Dosis inicial protocolar</span><strong>0,01 µg/kg/min</strong>' +
      '<small>Rango de la guía INSN-SB: 0,01–0,1 µg/kg/min. Titular solo por indicación especializada; para dosis mayores de 0,02 µg/kg/min, consultar al especialista.</small></div>' +
      '<div class="pge-section"><strong>Preparación de referencia (ampolla 500 µg/mL)</strong><ol>' +
      '<li>Diluir 1 ampolla de 1 mL en 49 mL de NaCl 0,9 %: solución base de 10 µg/mL.</li>' +
      '<li>Tomar <strong>peso (kg) × 3 mL</strong> de la solución base y completar a 50 mL con NaCl 0,9 % o dextrosa 5 %.</li>' +
      '<li>Con esa preparación, <strong>1 mL/h aporta 0,01 µg/kg/min</strong>. Administrar por infusión IV continua en vía exclusiva; comprobar el cálculo de forma independiente.</li>' +
      '</ol></div>' +
      '<div class="pge-section"><strong>Vigilancia continua</strong><ul>' +
      '<li>Frecuencia y esfuerzo respiratorio, SpO₂, presión arterial, frecuencia cardiaca y temperatura.</li>' +
      '<li>Perfusión, pulsos, diuresis, acidosis y lactato cuando estén disponibles.</li>' +
      '<li>Vigilar apnea, hipotensión, fiebre y extravasación; esta última puede causar lesión tisular.</li>' +
      '</ul></div>' +
      '<div class="pge-foot">Referencia rápida: guía adaptada del INSN San Borja (2022), ficha DIGEMID y Queensland Neonatal Medicines. Aplicar el protocolo institucional vigente.</div>' +
      '</details>';
  }

  function referralScreen() {
    var ev = state.evaluation;
    var sinUbicacion = state.originLat == null;
    var loc = {
      lat: state.originLat, lon: state.originLon, departamento: state.departamento
    };
    // Dos listas a propósito: la especializada, que casi nunca es la más
    // cercana, y la de apoyo inmediato.
    var especializados = E.nearest(Object.assign({ cap: 'cardio_ped', limit: 2 }, loc));
    var cercanos = E.nearest(Object.assign({ cap: 'pediatria', excludeCap: 'cardio_ped', limit: 3 }, loc));
    var prenatalChecks = checkbox(
      'Sin antecedentes prenatales conocidos',
      !!state.prenatalHistory.noneKnown,
      'togglePrenatalHistory', 'noneKnown'
    ) + PRENATAL_HISTORY.map(function (item) {
      return checkbox(item.label, !!state.prenatalHistory[item.key], 'togglePrenatalHistory', item.key);
    }).join('');

    var card = function (r) {
      var e = r.eess;
      var caps = e.capacidad.map(function (c) {
        return '<span class="cap ' + c + '">' + escText(E.CAP_LABEL[c] || c) + '</span>';
      }).join('');
      return '<div class="eess-card">' +
        '<div class="eess-name">' + escText(e.nombre) + '</div>' +
        '<div class="eess-meta">' + escText(e.institucion + ' · ' + e.categoria + ' · ' +
          e.distrito + ', ' + e.departamento) + '</div>' +
        '<div class="caps">' + caps +
        (r.km != null ? '<span class="km">' + Math.round(r.km) + ' km</span>' : '') +
        '</div>' +
        (e.nota ? '<div class="eess-note">' + escText(e.nota) + '</div>' : '') +
        '<div class="eess-actions">' +
        '<button type="button" class="btn-tele" data-action="requestHelp" data-arg="teleconsulta|' + escAttr(e.codigo) + '">Teleconsulta</button>' +
        '<button type="button" class="btn-ref" data-action="requestHelp" data-arg="referencia|' + escAttr(e.codigo) + '">Iniciar referencia</button>' +
        '</div></div>';
    };

    return '<div class="screen">' +
      '<div class="screen-head">' +
      '<button type="button" class="link" data-action="closeReferral">← Volver al resultado</button>' +
      '<div class="step-title">Pedir ayuda</div>' +
      '<div class="screen-sub">Teleconsulta u orientación con un especialista, o inicio de la referencia</div></div>' +

      '<div class="case-strip">' +
      '<span class="hist-dot ' + ev.level + '"></span>' +
      '<span>' + escText(state.cui) + '</span>' +
      '<span class="case-val">' +
      (ev.model === 'cchd' ? ev.pre + ' / ' + ev.post + ' %' : ev.spo2 + ' %') +
      ' · ' + altitudeValue() + ' msnm</span></div>' +

      prostaglandinGuide(ev) +

      '<div class="prenatal-card"><div class="group-title">Antecedentes prenatales</div>' +
      '<div class="group-sub">Seleccione los conocidos. Se guardarán con esta evaluación y se incluirán en la solicitud.</div>' +
      '<div class="prenatal-list">' + prenatalChecks + '</div>' +
      '<label class="field-label" for="prenatal-other">Otro antecedente o detalle relevante</label>' +
      '<textarea id="prenatal-other" class="field-input prenatal-other" maxlength="300" data-bind="prenatalOther" ' +
      'placeholder="Ej. hallazgo fetal, tratamiento materno o complicación del embarazo">' +
      escText(state.prenatalOther) + '</textarea></div>' +

      (sinUbicacion
        ? '<div class="warn-inline">Sin coordenadas del punto de medición: las listas no están ordenadas por cercanía. ' +
          'Use el GPS o elija un puesto de salud para ordenarlas.</div>'
        : '') +

      '<div class="eess-group"><div class="group-title">Cardiología pediátrica</div>' +
      '<div class="group-sub">Referencia especializada. Rara vez es la más cercana.</div>' +
      '<div class="child-list">' + especializados.map(card).join('') + '</div></div>' +

      '<div class="eess-group"><div class="group-title">Pediatría más cercana</div>' +
      '<div class="group-sub">Apoyo inmediato y estabilización antes del traslado.</div>' +
      '<div class="child-list">' + cercanos.map(card).join('') + '</div></div>' +

      '<div class="field-hint">Datos semilla del prototipo. El registro definitivo se toma de RENIPRESS (SUSALUD). ' +
      'Las distancias son en línea recta, no tiempo de traslado.</div>' +
      '<div class="spacer"></div></div>';
  }

  /* Tamizaje negativo pero con signos clínicos: el algoritmo acertó al decir
   * que la saturación es normal, y aun así el niño no puede irse de alta. */
  function cchdGreenWithSigns(ev) {
    return '<div class="result-screen result-yellow">' +
      '<div class="result-title">Tamizaje negativo con signos clínicos</div>' +
      '<div class="result-message">La saturación es normal para ' + escText(ev.stratum.label) +
      ', pero hay signos presentes: <strong>' + escText(signList().join(', ')) + '</strong>. ' +
      'Un tamizaje negativo no descarta una cardiopatía ni explica esos signos.</div>' +
      '<div class="attempt-badge">No procede el alta sin evaluación médica.</div>' +
      summaryCard(ev) + sessionHistoryBlock() + unreliableNote(ev) +
      '<div class="actions-card"><div class="actions-title">Conducta sugerida</div><ul>' +
      '<li>Evaluación médica antes del alta.</li>' +
      '<li>Buscar otras causas de los signos: respiratoria, infecciosa, metabólica.</li>' +
      '<li>Considerar teleconsulta con cardiología pediátrica.</li>' +
      '<li>Recordar que la oximetría no detecta todas las cardiopatías críticas.</li>' +
      '</ul></div>' + calibrationBlock(ev) +
      '<div class="spacer"></div>' + referralBlock() +
      '<button type="button" class="btn-outline-red" data-action="finishPatient">Registrar otro paciente</button>' +
      storedNote() + '</div>';
  }

  function cchdResult(ev) {
    if (ev.clinicalOverride) return cchdGreenWithSigns(ev);
    if (ev.level === 'green') {
      return '<div class="result-screen result-green">' +
        '<div class="result-title">Alta segura</div>' +
        '<div class="result-message">Tamizaje negativo: probabilidad extremadamente baja de cardiopatía congénita crítica. ' +
        'Continúe con los controles de rutina del recién nacido.</div>' +
        summaryCard(ev) + sessionHistoryBlock() + unreliableNote(ev) + calibrationBlock(ev) +
        '<div class="spacer"></div>' +
        '<button type="button" class="btn-primary btn-green" data-action="openDischargeSchedule">Dar de alta</button>' +
        '<div class="discharge-followup-hint">Al dar de alta registrará el celular y programará el seguimiento.</div>' +
        referralBlock() +
        storedNote() + '</div>';
    }
    if (ev.level === 'yellow') {
      return '<div class="result-screen result-yellow">' +
        '<div class="result-title">Zona gris</div>' +
        '<div class="result-message">' +
        (ev.reason === 'diferencial'
          ? 'Diferencia pre/post-ductal de ' + ev.diff + ' puntos (máximo ' + T.CAL.DIFF_MAX + '). '
          : 'Saturación limítrofe para ' + ev.stratum.label + '. ') +
        'Repetir la prueba en ' + ev.repeatMin + ' minutos.</div>' +
        '<div class="attempt-badge">Intento ' + ev.attempt + ' de ' + ev.maxAttempts +
        ' · una tercera repetición consecutiva se registra como tamizaje positivo</div>' +
        resultSensorGuide() +
        summaryCard(ev) + sessionHistoryBlock() + unreliableNote(ev) + countdownBlock() + calibrationBlock(ev) +
        '<div class="spacer"></div>' + referralBlock() +
        '<button type="button" class="btn-primary btn-warn" data-action="repeatMeasurement"' +
        (state.countdownSec > 0 ? ' disabled' : '') + '>Repetir medición</button>' +
        storedNote() + '</div>';
    }
    return '<div class="result-screen result-red">' +
      '<div class="result-title">Alerta de cardiopatía</div>' +
      '<div class="result-message">' +
      (ev.escalated
        ? 'Tres mediciones consecutivas en zona gris. Se registra como tamizaje positivo.'
        : 'Saturación por debajo del umbral crítico (' + ev.stratum.critical + ' %) para ' + ev.stratum.label + '.') +
      ' <strong>El recién nacido no debe ser dado de alta.</strong></div>' +
      resultSensorGuide() +
      summaryCard(ev) + sessionHistoryBlock() + unreliableNote(ev) +
      '<div class="actions-card"><div class="actions-title">Conducta sugerida</div><ul>' +
      '<li>Evaluación médica inmediata.</li>' +
      '<li>Evaluación por cardiología pediátrica.</li>' +
      '<li>Radiografía de tórax.</li>' +
      '<li>Ecocardiograma para descartar cortocircuitos.</li>' +
      '<li>Descartar sepsis como causa alternativa.</li>' +
      '</ul></div>' + prostaglandinGuide(ev) + calibrationBlock(ev) +
      '<div class="spacer"></div>' + referralBlock() +
      '<button type="button" class="btn-outline-red" data-action="finishPatient">Registrar otro paciente</button>' +
      storedNote() + '</div>';
  }

  var ADAPT_DISCLAIMER = '<div class="disclaimer">Evaluación de adaptación, <strong>no</strong> es un tamizaje de ' +
    'cardiopatía congénita. Esta pantalla no habilita el alta. Programe el tamizaje pre y post-ductal ' +
    'a partir de las 24 h de vida.</div>';

  function adaptationResult(ev) {
    if (ev.clinicalOverride) {
      return '<div class="result-screen result-yellow">' +
        '<div class="result-title">Adaptación normal con signos clínicos</div>' +
        '<div class="result-message">La saturación es la esperada para ' + ev.minutes +
        ' minutos de vida a ' + altitudeValue() + ' msnm, pero hay signos presentes: <strong>' +
        escText(signList().join(', ')) + '</strong>. La saturación normal no los explica.</div>' +
        '<div class="attempt-badge">Requiere evaluación médica aunque la oximetría sea normal.</div>' +
        summaryCard(ev) + sessionHistoryBlock() + unreliableNote(ev) + ADAPT_DISCLAIMER + calibrationBlock(ev) +
        '<div class="spacer"></div>' + referralBlock() +
        '<button type="button" class="btn-outline-red" data-action="finishPatient">Registrar otro paciente</button>' +
        storedNote() + '</div>';
    }
    if (ev.level === 'green') {
      return '<div class="result-screen result-green">' +
        '<div class="result-title">Adaptación normal</div>' +
        '<div class="result-message">La saturación está dentro de lo esperado para ' + ev.minutes +
        ' minutos de vida a ' + altitudeValue() + ' msnm. Continúe con los cuidados de rutina.</div>' +
        summaryCard(ev) + sessionHistoryBlock() + unreliableNote(ev) + ADAPT_DISCLAIMER + calibrationBlock(ev) +
        '<div class="spacer"></div>' + referralBlock() +
        '<button type="button" class="btn-primary btn-green" data-action="finishPatient">Registrar otro paciente</button>' +
        storedNote() + '</div>';
    }
    if (ev.level === 'yellow') {
      return '<div class="result-screen result-yellow">' +
        '<div class="result-title">Vigilar</div>' +
        '<div class="result-message">Saturación entre el percentil 3 y el 10 para su tiempo de vida y altitud. ' +
        'Mantener vigilancia y repetir en ' + ev.repeatMin + ' minutos.</div>' +
        (ev.attempt >= T.CAL.MAX_REPEATS
          ? '<div class="attempt-badge">' + ev.attempt + ' mediciones consecutivas en vigilancia: considere evaluación médica.</div>'
          : '') +
        resultSensorGuide() +
        summaryCard(ev) + sessionHistoryBlock() + unreliableNote(ev) + countdownBlock() + ADAPT_DISCLAIMER + calibrationBlock(ev) +
        '<div class="spacer"></div>' + referralBlock() +
        '<button type="button" class="btn-primary btn-warn" data-action="repeatMeasurement"' +
        (state.countdownSec > 0 ? ' disabled' : '') + '>Repetir medición</button>' +
        storedNote() + '</div>';
    }
    var conSignos = ev.reason === 'hipoxemia_con_signos';
    return '<div class="result-screen result-red">' +
      '<div class="result-title">' + (conSignos ? 'Hipoxemia probable' : 'Saturación baja sin signos') + '</div>' +
      '<div class="result-message">Saturación por debajo del percentil 3 (' + ev.thresholds.p3.toFixed(1) +
      ' %) para ' + ev.minutes + ' minutos de vida a ' + altitudeValue() + ' msnm.</div>' +
      resultSensorGuide() +
      summaryCard(ev) + sessionHistoryBlock() + unreliableNote(ev) +
      '<div class="actions-card"><div class="actions-title">Conducta sugerida</div><ul>' +
      (conSignos
        ? '<li>Hay signos clínicos asociados: <strong>no demorar</strong>.</li>' +
          '<li>Iniciar oxígeno suplementario.</li>' +
          '<li>Coordinar traslado a establecimiento de mayor capacidad resolutiva.</li>' +
          '<li>Evaluación médica inmediata.</li>'
        : '<li>Sin signos clínicos: primero descartar causa técnica.</li>' +
          '<li>Verificar perfusión y recalentar al recién nacido.</li>' +
          '<li>Revisar posición y ajuste del sensor.</li>' +
          '<li>Repetir la medición en ' + T.CAL.RECHECK_MIN_PERFUSION + ' minutos antes de intervenir.</li>') +
      '</ul></div>' + prostaglandinGuide(ev) + countdownBlock() + ADAPT_DISCLAIMER + calibrationBlock(ev) +
      '<div class="spacer"></div>' + referralBlock() +
      (conSignos
        ? '<button type="button" class="btn-outline-red" data-action="finishPatient">Registrar otro paciente</button>'
        : '<button type="button" class="btn-primary btn-warn" data-action="repeatMeasurement"' +
          (state.countdownSec > 0 ? ' disabled' : '') + '>Repetir medición</button>') +
      storedNote() + '</div>';
  }

  function resultScreen() {
    var ev = state.evaluation;
    if (!ev) return '';
    return ev.model === 'cchd' ? cchdResult(ev) : adaptationResult(ev);
  }

  // ---------------------------------------------------------------- historial
  function historyScreen() {
    var summaries = S.childSummaries();
    var evals = S.allEvaluations();
    var exportedCount = S.exported().length;

    var list = summaries.length
      ? summaries.map(function (s) {
          return '<button type="button" class="child-card" data-action="openChild" data-arg="' + escAttr(s.child.cui) + '">' +
            '<span class="child-head"><span class="hist-dot ' + (s.lastLevel || 'none') + '"></span>' +
            '<span class="child-cui">' + escText(s.child.cui) + '</span>' +
            '<span class="child-count">' + s.count + (s.count === 1 ? ' eval.' : ' evals.') + '</span></span>' +
            '<span class="child-meta">DNI madre ' + escText(s.child.dniMadre || '—') +
            ' · última ' + escText(fmtDateTime(s.lastAt)) +
            (s.pending ? ' · ' + s.pending + ' sin exportar' : '') + '</span>' +
            '</button>';
        }).join('')
      : '<div class="empty">Todavía no hay pacientes registrados.</div>';

    return '<div class="screen">' +
      '<div class="screen-head">' +
      '<button type="button" class="link" data-action="closeHistory">← Volver</button>' +
      '<div class="step-title">Historial</div>' +
      '<div class="screen-sub">' + summaries.length + (summaries.length === 1 ? ' paciente · ' : ' pacientes · ') +
      evals.length + (evals.length === 1 ? ' evaluación · ' : ' evaluaciones · ') +
      S.pending().length + ' sin exportar</div></div>' +

      '<div class="export-row">' +
      '<button type="button" class="detect-btn wide" data-action="exportCSV">Exportar CSV</button>' +
      (exportedCount
        ? (state.confirmDelete
            ? '<button type="button" class="btn-danger-sm" data-action="deleteExported">Confirmar borrar ' + exportedCount + '</button>' +
              '<button type="button" class="link" data-action="cancelDelete">Cancelar</button>'
            : '<button type="button" class="detect-btn wide" data-action="armDelete">Borrar exportados (' + exportedCount + ')</button>')
        : '') +
      '</div>' +
      '<div class="field-hint">Solo se pueden borrar los registros ya exportados.</div>' +

      '<div class="child-list">' + list + '</div>' +
      '<div class="spacer"></div></div>';
  }

  function childScreen() {
    var child = S.getChild(state.viewCui);
    if (!child) return '<div class="screen"><div class="empty">Paciente no encontrado.</div>' +
      '<button type="button" class="link" data-action="backToHistory">← Volver</button></div>';

    var evs = S.evaluationsFor(child.cui).slice().reverse();
    var rows = evs.length ? evs.map(function (e) {
      var val = e.post != null ? e.pre + ' / ' + e.post + ' %' : e.pre + ' %';
      return '<div class="eval-card">' +
        '<div class="eval-head"><span class="hist-dot ' + e.level + '"></span>' +
        '<span class="eval-n">#' + e.seq + '</span>' +
        '<span class="eval-kind">' + (e.model === 'cchd' ? 'Tamizaje CCHD' : 'Adaptación') + '</span>' +
        '<span class="eval-level ' + e.level + '">' + (LEVEL_TEXT[e.level] || e.level) + '</span></div>' +
        '<div class="eval-meta">' + escText(fmtDateTime(e.createdAt)) + ' · ' + escText(val) +
        ' · ' + escText(e.altitude + ' msnm') +
        (e.escalated ? ' · escalado' : '') +
        (e.exportedAt ? '' : ' · sin exportar') + '</div>' +
        (e.signs && e.signs.length ? '<div class="eval-meta">Signos: ' + escText(e.signs.join(', ')) + '</div>' : '') +
        (e.seguimientoProgramadoEstado
          ? '<div class="eval-meta">Seguimiento: ' + escText(e.seguimientoProgramadoEstado === 'pendiente_servicio'
            ? 'programado · pendiente de servicio' : e.seguimientoProgramadoEstado) + '</div>' : '') +
        '</div>';
    }).join('') : '<div class="empty">Sin evaluaciones registradas.</div>';

    return '<div class="screen">' +
      '<div class="screen-head">' +
      '<button type="button" class="link" data-action="backToHistory">← Historial</button>' +
      '<div class="step-title mono">' + escText(child.cui) + '</div>' +
      '<div class="screen-sub">DNI madre ' + escText(child.dniMadre || '—') +
      (child.birthDate ? ' · nac. ' + escText(child.birthDate + ' ' + child.birthTime) : '') + '</div></div>' +
      '<button type="button" class="btn-primary" data-action="followUp" data-arg="' + escAttr(child.cui) + '">Nueva evaluación para este niño</button>' +
      '<div class="child-list">' + rows + '</div>' +
      '<div class="spacer"></div></div>';
  }

  function screenHtml() {
    switch (state.screen) {
      case 'login': return loginScreen();
      case 'patient': return patientScreen();
      case 'measure': return measureScreen();
      case 'stepA': return stepAScreen();
      case 'stepB': return stepBScreen();
      case 'stepC': return stepCScreen();
      case 'result': return resultScreen();
      case 'referral': return referralScreen();
      case 'schedule': return scheduleScreen();
      case 'history': return historyScreen();
      case 'child': return childScreen();
      default: return '';
    }
  }

  function render() {
    var active = document.activeElement;
    var activeId = active && active.id;
    var selStart = null, selEnd = null;
    if (activeId && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) {
      try { selStart = active.selectionStart; selEnd = active.selectionEnd; } catch (e) { /* type sin selección */ }
    }
    var openCalib = !!(root.querySelector('details.calib') || {}).open;

    root.innerHTML = '<div class="phone">' + header() + screenHtml() +
      (state.toastMsg ? '<div class="toast">' + escText(state.toastMsg) + '</div>' : '') + '</div>';

    if (openCalib) {
      var d = root.querySelector('details.calib');
      if (d) d.open = true;
    }
    if (activeId) {
      var el = document.getElementById(activeId);
      if (el) {
        el.focus();
        if (selStart != null && el.setSelectionRange) {
          try { el.setSelectionRange(selStart, selEnd); } catch (e) { /* date/time no lo soportan */ }
        }
      }
    }
  }

  /* Al teclear un código ya registrado se recuperan sus datos, para no volver a
   * pedirlos en cada control del mismo niño. */
  function lookupChild() {
    if (!cuiOk()) {
      if (state.knownChild) { state.knownChild = null; state.lastLookup = ''; }
      return;
    }
    if (state.lastLookup === state.cui) return;
    state.lastLookup = state.cui;
    var child = S.getChild(state.cui);
    state.knownChild = child;
    if (child) {
      if (child.dniMadre) state.dniMadre = child.dniMadre;
      if (child.telefono) state.telefono = child.telefono;
      if (child.birthDate) state.birthDate = child.birthDate;
      if (child.birthTime) state.birthTime = child.birthTime;
    }
  }

  // ------------------------------------------------------------------ eventos
  root.addEventListener('click', function (e) {
    var el = e.target.closest('[data-action]');
    if (!el || el.disabled) return;
    var fn = actions[el.dataset.action];
    if (fn) fn(el.dataset.arg);
  });

  root.addEventListener('input', function (e) {
    var key = e.target.dataset.bind;
    if (!key) return;
    var v = e.target.value;
    // maxlength no protege de un pegado ni de teclados que ignoran inputmode:
    // el filtro real está aquí.
    var cap = DIGIT_FIELDS[key];
    if (cap) v = v.replace(/\D/g, '').slice(0, cap);
    if (key === 'cui') v = S.normalizePatientCode(v).slice(0, S.RN_CODE_MAX);
    state[key] = v;
    if (key === 'cui') lookupChild();
    render();
  });

  root.addEventListener('change', function (e) {
    var el = e.target;
    if (el.dataset.bindChange === 'selectPost') { actions.selectPost(el.value); return; }
    if (el.dataset.bindChange) {
      state[el.dataset.bindChange] = el.value;
      render();
    }
  });

  render();
  processDueFollowups();
  setInterval(processDueFollowups, 10000);
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) processDueFollowups();
  });
})();
