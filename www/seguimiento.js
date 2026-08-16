/* Cardio Alerta — programación determinista de seguimiento.
 *
 * Este módulo solo calcula fechas. La demo ejecuta los envíos pendientes
 * mientras la aplicación está abierta o cuando vuelve a abrirse.
 */
(function (root) {
  'use strict';

  var FREQUENCIES = [
    { days: 1, label: 'Cada día' },
    { days: 2, label: 'Cada 2 días' },
    { days: 3, label: 'Cada 3 días' },
    { days: 7, label: 'Cada semana' }
  ];

  function frequencyLabel(days) {
    var n = Number(days);
    for (var i = 0; i < FREQUENCIES.length; i++) {
      if (FREQUENCIES[i].days === n) return FREQUENCIES[i].label;
    }
    return '';
  }

  function normalize(o) {
    o = o || {};
    var firstDate = String(o.firstDate || '');
    var startDays = Number(o.startDays);
    var everyDays = Number(o.everyDays);
    var count = Number(o.count);
    var time = String(o.time || '');
    var match = /^(\d{2}):(\d{2})$/.exec(time);
    if (firstDate) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(firstDate) || isNaN(new Date(firstDate + 'T00:00:00').getTime())) return null;
    } else if (!Number.isInteger(startDays) || startDays < 0 || startDays > 30) return null;
    if (!frequencyLabel(everyDays)) return null;
    if (!Number.isInteger(count) || count < 1 || count > 12) return null;
    if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return null;
    return {
      startDays: startDays,
      firstDate: firstDate,
      everyDays: everyDays,
      count: count,
      time: time,
      hour: Number(match[1]),
      minute: Number(match[2])
    };
  }

  function buildOccurrences(o) {
    var cfg = normalize(o);
    if (!cfg) return [];
    var first;
    if (cfg.firstDate) {
      first = new Date(cfg.firstDate + 'T' + cfg.time + ':00');
    } else {
      var dischargedAt = new Date(o && o.dischargedAt);
      if (isNaN(dischargedAt.getTime())) return [];
      first = new Date(dischargedAt);
      first.setDate(first.getDate() + cfg.startDays);
      first.setHours(cfg.hour, cfg.minute, 0, 0);
    }

    var out = [];
    for (var i = 0; i < cfg.count; i++) {
      var next = new Date(first);
      next.setDate(first.getDate() + i * cfg.everyDays);
      out.push(next.toISOString());
    }
    return out;
  }

  var api = {
    FREQUENCIES: FREQUENCIES,
    frequencyLabel: frequencyLabel,
    normalize: normalize,
    buildOccurrences: buildOccurrences
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Seguimiento = api;
})(typeof window !== 'undefined' ? window : globalThis);
