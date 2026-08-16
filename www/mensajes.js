/* Cardio Alerta — mensajes de seguimiento para la familia.
 *
 * El texto se genera de forma determinista y la demo lo transmite directamente
 * como mensaje simple de servicio de WhatsApp.
 */
(function (root) {
  'use strict';

  // Los signos que el Insight 3 del trabajo de campo describe como invisibles
  // para la familia: se confunden con gases, frío o soroche. Van en lenguaje
  // llano, sin una sola palabra médica.
  var SIGNOS_ALARMA = [
    'Se pone morado o azulado en labios, lengua o uñas',
    'Se cansa, suda o se queda dormido al lactar',
    'Respira muy rápido o se le hunden las costillas',
    'Se ve decaído o no despierta para lactar'
  ];

  var CIERRE_SIGNOS =
    'Estos signos NO son gases, frío ni soroche. Si ve alguno, lleve a su bebé ' +
    'al establecimiento de salud más cercano de inmediato.';

  // Celular peruano: 9 dígitos que empiezan por 9. wa.me necesita el código de
  // país pegado y sin el signo +.
  var COUNTRY_CODE = '51';
  var PHONE_LENGTH = 9;

  function normalizePhone(v) {
    var d = String(v == null ? '' : v).replace(/\D/g, '');
    // Tolera que peguen el número con el código de país delante.
    if (d.length === PHONE_LENGTH + COUNTRY_CODE.length && d.indexOf(COUNTRY_CODE) === 0) {
      d = d.slice(COUNTRY_CODE.length);
    }
    return d;
  }
  function isValidPhone(v) {
    var d = normalizePhone(v);
    return d.length === PHONE_LENGTH && d.charAt(0) === '9';
  }
  function waLink(phone, text) {
    var d = normalizePhone(phone);
    var base = 'https://wa.me/' + (isValidPhone(d) ? COUNTRY_CODE + d : '');
    return base + '?text=' + encodeURIComponent(text);
  }

  function bullets(items) {
    return items.map(function (s) { return '• ' + s; }).join('\n');
  }
  function hhmm(date) {
    if (!date) return null;
    var d = new Date(date);
    if (isNaN(d.getTime())) return null;
    var p = function (n) { return String(n).padStart(2, '0'); };
    return p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function fecha(date) {
    if (!date) return null;
    var d = new Date(date);
    if (isNaN(d.getTime())) return null;
    var p = function (n) { return String(n).padStart(2, '0'); };
    return p(d.getDate()) + '/' + p(d.getMonth() + 1) + ' a las ' + hhmm(d);
  }

  /* build({ level, model, clinicalOverride, establecimiento, destino,
   *         repeatAt, screeningAt, repeatMin })
   * Devuelve el texto completo del mensaje. Sin datos del paciente por
   * WhatsApp: ni CUI ni DNI ni saturaciones. El canal no es seguro y la
   * familia no necesita la cifra, necesita saber qué hacer.
   */
  function build(o) {
    o = o || {};
    var partes = [];
    var cabecera = 'Cardio Alerta';
    if (o.establecimiento) cabecera += ' — ' + o.establecimiento;
    partes.push(cabecera);

    var cuerpo;
    if (o.clinicalOverride) {
      cuerpo = 'Hola. El examen del corazón de su bebé salió normal, pero el personal ' +
        'observó signos que necesitan ser revisados por un médico.\n\n' +
        'Por favor NO se retire del establecimiento hasta que lo evalúen.';
    } else if (o.level === 'red') {
      cuerpo = 'Hola. El examen del corazón de su bebé salió ALTERADO.\n\n' +
        'Su bebé no debe ser dado de alta todavía. El personal de salud está ' +
        'coordinando su atención' +
        (o.destino ? ' con ' + o.destino : '') + '.\n\n' +
        'Acompañe a su bebé y siga las indicaciones del personal.';
    } else if (o.level === 'yellow') {
      var cuando = hhmm(o.repeatAt);
      cuerpo = 'Hola. El examen del corazón de su bebé necesita repetirse antes del alta.\n\n' +
        'Esto es normal y no significa que su bebé esté enfermo.\n\n' +
        (cuando
          ? 'La siguiente medición es alrededor de las ' + cuando + '. Por favor NO se retire.'
          : 'Se repetirá en ' + (o.repeatMin || 60) + ' minutos. Por favor NO se retire.');
    } else {
      cuerpo = 'Hola. El examen del corazón de su bebé salió NORMAL.\n\n' +
        'Continúe con sus controles de rutina.';
    }
    partes.push(cuerpo);

    // El tamizaje de adaptación no reemplaza al de cardiopatía: si el bebé
    // aún no tiene 24 h, lo que hay que asegurar es que vuelva a las 24 h.
    if (o.model === 'adaptation') {
      var f = fecha(o.screeningAt);
      partes.push('IMPORTANTE: el examen del corazón se hace cuando el bebé cumple ' +
        '24 horas de vida' + (f ? ', alrededor del ' + f : '') +
        '. No se retire sin ese examen.');
    }

    partes.push('Vigile a su bebé. Busque atención si:\n' + bullets(SIGNOS_ALARMA));
    partes.push(CIERRE_SIGNOS);

    return partes.join('\n\n');
  }

  /* Mensaje periódico posterior al alta. Es deliberadamente abierto: no hay
   * bot ni interpretación automática de la respuesta. La conversación llega
   * al número del establecimiento que se conectará al servicio de WhatsApp. */
  function buildCheckIn(o) {
    o = o || {};
    var partes = [];
    var cabecera = 'Cardio Alerta';
    if (o.establecimiento) cabecera += ' — ' + o.establecimiento;
    partes.push(cabecera);
    partes.push('Hola. Queremos saber cómo sigue su bebé después del alta.\n\n' +
      '¿Cómo se encuentra hoy? Puede responder a este mensaje y contarnos si está lactando, ' +
      'respirando y despertando con normalidad.');
    partes.push('Busque atención de inmediato si:\n' + bullets(SIGNOS_ALARMA));
    partes.push(CIERRE_SIGNOS);
    return partes.join('\n\n');
  }

  var api = {
    SIGNOS_ALARMA: SIGNOS_ALARMA,
    COUNTRY_CODE: COUNTRY_CODE,
    PHONE_LENGTH: PHONE_LENGTH,
    normalizePhone: normalizePhone,
    isValidPhone: isValidPhone,
    waLink: waLink,
    build: build,
    buildCheckIn: buildCheckIn
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Mensajes = api;
})(typeof window !== 'undefined' ? window : globalThis);
