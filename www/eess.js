/* Cardio Alerta — establecimientos de salud (EESS).
 *
 * DATOS SEMILLA PARA EL PROTOTIPO. Reemplazar por un extracto de RENIPRESS:
 *   https://www.datosabiertos.gob.pe/dataset/registro-nacional-de-ipress-renipress
 *   http://datos.susalud.gob.pe/group/renipress
 *
 * Se descarga una vez, se filtra y se empaqueta aquí. NUNCA se consulta en
 * línea: la app tiene que poder derivar justo donde no hay señal, y una
 * llamada de red en el camino crítico rompería exactamente ese caso. El
 * buscador SIGEPS del SIS no sirve como fuente — es solo una interfaz de
 * consulta, sin API, sin descarga masiva y sin coordenadas.
 *
 * Salvedades de estos datos semilla, a corregir con RENIPRESS:
 *   · Las coordenadas son del centro de la ciudad o distrito, no del predio.
 *     Bastan para ordenar por cercanía y decidir a qué ciudad se deriva, que
 *     es la decisión que se está apoyando.
 *   · `capacidad` es una clasificación conservadora por categoría y rol
 *     conocido del establecimiento. RENIPRESS permite filtrar por especialidad;
 *     hay que verificarla antes de cualquier uso real.
 *   · Sin teléfonos: un número inventado en una app clínica es peor que
 *     ninguno. Se completan desde RENIPRESS.
 */
(function (root) {
  'use strict';

  // capacidad: 'cardio_ped' = cardiología o cirugía cardiovascular pediátrica
  //            'pediatria'  = pediatría / neonatología con capacidad resolutiva
  //            'origen'     = establecimiento donde se toma la medición
  var EESS = [
    // --- Referencia especializada -------------------------------------------
    { codigo: '00006213', nombre: 'Instituto Nacional de Salud del Niño – San Borja',
      institucion: 'MINSA', categoria: 'III-E', departamento: 'Lima', provincia: 'Lima',
      distrito: 'San Borja', lat: -12.108, lon: -77.000, altitud: 154,
      capacidad: ['cardio_ped', 'pediatria'], telefono: null,
      nota: 'Centro nacional de referencia en cardiopatías congénitas' },

    { codigo: '00006214', nombre: 'Instituto Nacional de Salud del Niño – Breña',
      institucion: 'MINSA', categoria: 'III-E', departamento: 'Lima', provincia: 'Lima',
      distrito: 'Breña', lat: -12.058, lon: -77.049, altitud: 154,
      capacidad: ['cardio_ped', 'pediatria'], telefono: null },

    { codigo: '00006215', nombre: 'Instituto Nacional Cardiovascular – INCOR',
      institucion: 'EsSalud', categoria: 'III-E', departamento: 'Lima', provincia: 'Lima',
      distrito: 'Jesús María', lat: -12.074, lon: -77.049, altitud: 154,
      capacidad: ['cardio_ped'], telefono: null },

    // --- Hospitales con pediatría / neonatología ----------------------------
    { codigo: '00000306', nombre: 'Hospital Nacional Cayetano Heredia',
      institucion: 'MINSA', categoria: 'III-1', departamento: 'Lima', provincia: 'Lima',
      distrito: 'San Martín de Porres', lat: -12.020, lon: -77.085, altitud: 154,
      capacidad: ['pediatria'], telefono: null },

    { codigo: '00000633', nombre: 'Hospital Regional del Cusco',
      institucion: 'MINSA', categoria: 'III-1', departamento: 'Cusco', provincia: 'Cusco',
      distrito: 'Cusco', lat: -13.532, lon: -71.967, altitud: 3399,
      capacidad: ['pediatria'], telefono: null },

    { codigo: '00000634', nombre: 'Hospital Nacional Adolfo Guevara Velasco',
      institucion: 'EsSalud', categoria: 'III-1', departamento: 'Cusco', provincia: 'Cusco',
      distrito: 'Wanchaq', lat: -13.527, lon: -71.958, altitud: 3399,
      capacidad: ['pediatria'], telefono: null },

    { codigo: '00000454', nombre: 'Hospital Regional Honorio Delgado Espinoza',
      institucion: 'MINSA', categoria: 'III-1', departamento: 'Arequipa', provincia: 'Arequipa',
      distrito: 'Arequipa', lat: -16.395, lon: -71.535, altitud: 2335,
      capacidad: ['pediatria'], telefono: null },

    { codigo: '00000455', nombre: 'Hospital Nacional Carlos Alberto Seguín Escobedo',
      institucion: 'EsSalud', categoria: 'III-1', departamento: 'Arequipa', provincia: 'Arequipa',
      distrito: 'Arequipa', lat: -16.409, lon: -71.537, altitud: 2335,
      capacidad: ['pediatria'], telefono: null },

    { codigo: '00000771', nombre: 'Hospital Regional Docente Clínico Quirúrgico Daniel Alcides Carrión',
      institucion: 'MINSA', categoria: 'II-2', departamento: 'Junín', provincia: 'Huancayo',
      distrito: 'Huancayo', lat: -12.068, lon: -75.210, altitud: 3259,
      capacidad: ['pediatria'], telefono: null },

    { codigo: '00000772', nombre: 'Hospital Nacional Ramiro Prialé Prialé',
      institucion: 'EsSalud', categoria: 'III-1', departamento: 'Junín', provincia: 'Huancayo',
      distrito: 'El Tambo', lat: -12.058, lon: -75.203, altitud: 3259,
      capacidad: ['pediatria'], telefono: null },

    { codigo: '00000905', nombre: 'Hospital Regional Manuel Núñez Butrón',
      institucion: 'MINSA', categoria: 'II-2', departamento: 'Puno', provincia: 'Puno',
      distrito: 'Puno', lat: -15.840, lon: -70.028, altitud: 3827,
      capacidad: ['pediatria'], telefono: null },

    { codigo: '00000112', nombre: 'Hospital Víctor Ramos Guardia',
      institucion: 'MINSA', categoria: 'II-2', departamento: 'Áncash', provincia: 'Huaraz',
      distrito: 'Huaraz', lat: -9.526, lon: -77.529, altitud: 3052,
      capacidad: ['pediatria'], telefono: null },

    { codigo: '00001033', nombre: 'Hospital Regional Docente de Trujillo',
      institucion: 'MINSA', categoria: 'III-1', departamento: 'La Libertad', provincia: 'Trujillo',
      distrito: 'Trujillo', lat: -8.112, lon: -79.029, altitud: 34,
      capacidad: ['pediatria'], telefono: null },

    { codigo: '00001180', nombre: 'Hospital Regional Lambayeque',
      institucion: 'MINSA', categoria: 'III-1', departamento: 'Lambayeque', provincia: 'Chiclayo',
      distrito: 'Chiclayo', lat: -6.772, lon: -79.841, altitud: 29,
      capacidad: ['pediatria'], telefono: null },

    { codigo: '00001299', nombre: 'Hospital Regional de Loreto',
      institucion: 'MINSA', categoria: 'III-1', departamento: 'Loreto', provincia: 'Maynas',
      distrito: 'Iquitos', lat: -3.749, lon: -73.253, altitud: 106,
      capacidad: ['pediatria'], telefono: null },

    // --- Establecimientos de origen (donde se mide) -------------------------
    { codigo: 'O-0001', nombre: 'C.S. Independencia (Lima)', institucion: 'MINSA', categoria: 'I-3',
      departamento: 'Lima', provincia: 'Lima', distrito: 'Independencia',
      lat: -11.990, lon: -77.055, altitud: 130, capacidad: ['origen'], telefono: null },
    { codigo: 'O-0002', nombre: 'C.S. San Borja (Lima)', institucion: 'MINSA', categoria: 'I-3',
      departamento: 'Lima', provincia: 'Lima', distrito: 'San Borja',
      lat: -12.108, lon: -77.000, altitud: 154, capacidad: ['origen'], telefono: null },
    { codigo: 'O-0003', nombre: 'C.S. Arequipa - Yanahuara', institucion: 'MINSA', categoria: 'I-3',
      departamento: 'Arequipa', provincia: 'Arequipa', distrito: 'Yanahuara',
      lat: -16.393, lon: -71.545, altitud: 2335, capacidad: ['origen'], telefono: null },
    { codigo: 'O-0004', nombre: 'C.S. Huaraz', institucion: 'MINSA', categoria: 'I-3',
      departamento: 'Áncash', provincia: 'Huaraz', distrito: 'Huaraz',
      lat: -9.530, lon: -77.531, altitud: 3052, capacidad: ['origen'], telefono: null },
    { codigo: 'O-0005', nombre: 'C.S. Huancayo', institucion: 'MINSA', categoria: 'I-3',
      departamento: 'Junín', provincia: 'Huancayo', distrito: 'Huancayo',
      lat: -12.070, lon: -75.212, altitud: 3259, capacidad: ['origen'], telefono: null },
    { codigo: 'O-0006', nombre: 'C.S. Cusco - Wanchaq', institucion: 'MINSA', categoria: 'I-3',
      departamento: 'Cusco', provincia: 'Cusco', distrito: 'Wanchaq',
      lat: -13.527, lon: -71.958, altitud: 3399, capacidad: ['origen'], telefono: null },
    { codigo: 'O-0007', nombre: 'C.S. Puno', institucion: 'MINSA', categoria: 'I-3',
      departamento: 'Puno', provincia: 'Puno', distrito: 'Puno',
      lat: -15.842, lon: -70.021, altitud: 3827, capacidad: ['origen'], telefono: null }
  ];

  var CAP_LABEL = {
    cardio_ped: 'Cardiología pediátrica',
    pediatria: 'Pediatría / neonatología',
    origen: 'Establecimiento de origen'
  };

  // Distancia en línea recta sobre la superficie terrestre. En los Andes el
  // trayecto real es mucho mayor que la línea recta, así que esto ordena por
  // cercanía pero NO estima tiempo de traslado.
  function haversineKm(lat1, lon1, lat2, lon2) {
    var R = 6371;
    var rad = Math.PI / 180;
    var dLat = (lat2 - lat1) * rad;
    var dLon = (lon2 - lon1) * rad;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function byCapacity(cap) {
    return EESS.filter(function (e) { return e.capacidad.indexOf(cap) !== -1; });
  }
  function origins() { return byCapacity('origen'); }
  function byCode(codigo) {
    var f = EESS.filter(function (e) { return e.codigo === codigo; });
    return f.length ? f[0] : null;
  }

  /* Centros de referencia ordenados por cercanía.
   * Sin coordenadas de origen no se inventa una distancia: se devuelven
   * igualmente, priorizando los del mismo departamento, con distancia nula.
   *
   * `cap` / `excludeCap` permiten pedir por capacidad. Hace falta porque
   * ordenar solo por distancia entierra al centro especializado: desde Cusco
   * los cinco más cercanos tienen pediatría, y la cardiología pediátrica está
   * en Lima. Quien atiende una alerta de cardiopatía necesita ver ambas cosas,
   * así que la interfaz pide dos listas en vez de una. */
  function nearest(o) {
    o = o || {};
    var lat = o.lat, lon = o.lon;
    var dep = o.departamento;
    var limit = o.limit || 5;

    var list = EESS
      .filter(function (e) { return e.capacidad.indexOf('origen') === -1; })
      .filter(function (e) { return !o.cap || e.capacidad.indexOf(o.cap) !== -1; })
      .filter(function (e) { return !o.excludeCap || e.capacidad.indexOf(o.excludeCap) === -1; })
      .map(function (e) {
        var km = (typeof lat === 'number' && typeof lon === 'number')
          ? haversineKm(lat, lon, e.lat, e.lon) : null;
        return {
          eess: e,
          km: km,
          cardioPed: e.capacidad.indexOf('cardio_ped') !== -1,
          mismoDepartamento: !!dep && e.departamento === dep
        };
      });

    list.sort(function (a, b) {
      if (a.km != null && b.km != null) return a.km - b.km;
      if (a.mismoDepartamento !== b.mismoDepartamento) return a.mismoDepartamento ? -1 : 1;
      // Sin distancia ni departamento, la referencia nacional va primero.
      if (a.cardioPed !== b.cardioPed) return a.cardioPed ? -1 : 1;
      return a.eess.nombre < b.eess.nombre ? -1 : 1;
    });

    return list.slice(0, limit);
  }

  var api = {
    EESS: EESS,
    CAP_LABEL: CAP_LABEL,
    haversineKm: haversineKm,
    byCapacity: byCapacity,
    byCode: byCode,
    origins: origins,
    nearest: nearest
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Eess = api;
})(typeof window !== 'undefined' ? window : globalThis);
