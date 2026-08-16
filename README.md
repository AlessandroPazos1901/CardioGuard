# Cardio Alerta

Tamizaje neonatal de cardiopatía congénita crítica (CCHD) y evaluación de
adaptación temprana, con umbrales corregidos por altitud. Pensada para puestos
de salud sin conexión.

## Los dos modelos clínicos

La app elige **uno solo** según el tiempo de vida del recién nacido. Nunca los
combina.

| | `< 24 h` — Adaptación | `>= 24 h` — Tamizaje CCHD |
|---|---|---|
| Base | Curvas tipo Dawson por minuto de vida | AAP + estratos ANDES-CHD |
| Corrección de altitud | Lineal, `K = 0.0035 %/m` | Ya incluida en los umbrales del estrato |
| Medición | Solo pre-ductal (mano/muñeca derecha) | Pre-ductal **y** post-ductal |
| Verde | `SpO2 >= p10` local | ambas `>= pase` y diferencial `<= 3` |
| Amarillo | entre `p3` y `p10` → repetir 30 min | limítrofe o diferencial `> 3` → repetir 60 min |
| Rojo | `< p3` local | `< crítico`, o 3.ª repetición consecutiva |
| Decide alta | No | Sí |

### Por qué están separados

Los umbrales ANDES-CHD **ya** incorporan la altitud. Aplicarles encima el
coeficiente lineal los corregiría dos veces:

| A 3600 m, 24 h de vida | Umbral crítico |
|---|---|
| Estrato ANDES-CHD | **85 %** |
| Modelo lineal (`90 − 3600×0.0035`) | **77.4 %** |

Un neonato al 80 % es un tamizaje positivo por ANDES y pasaría como normal por
el modelo lineal. La extrapolación lineal se sale de la curva de disociación de
la hemoglobina, que es sigmoide; solo se usa en la ventana temprana, donde la
tabla de referencia es baja de por sí. `test.js` bloquea esta confusión.

### Estratos de tamizaje CCHD

| Altitud | Crítico (rojo si `<`) | Pase (verde si `>=` y dif `<= 3`) |
|---|---|---|
| 0 – 1599 msnm | 90 % | 95 % |
| 1600 – 2499 msnm | 90 % | 93 % |
| 2500 – 3599 msnm | 87 % | 90 % |
| 3600 – 4500 msnm | 85 % | 89 % |
| `> 4500` msnm | 85 % | 89 % + marcado fuera de rango |

Tres repeticiones consecutivas en zona gris se registran como tamizaje
positivo.

## Calibración

Todo lo ajustable vive en el bloque `CAL` al inicio de
[`www/triage.js`](www/triage.js). No se edita desde la interfaz: la app solo lo
muestra en modo lectura, en «Parámetros de calibración aplicados», para
auditoría.

Antes de uso clínico real hay que validar con datos locales:

- `K_ALT = 0.0035` — estimación neonatal conservadora. La literatura en adultos
  usa `0.0047`; **no** aplicar ese valor a neonatos.
- Los percentiles `p10` de `DAWSON_SEA_LEVEL` **no vienen en la fuente**: se
  derivan asumiendo normalidad (`p10 = p50 − 0.6815 × (p50 − p3)`).

## Desarrollo

```sh
npm test        # verificación de la lógica clínica (19 bloques, sin framework)
npm run serve   # http://localhost:8791
```

`www/` es una app estática sin build y sin recursos remotos: se abre en
cualquier navegador. La lógica clínica está aislada en `www/triage.js`, sin DOM,
por lo que `test.js` la ejecuta directamente en Node.

> Geolocalización: los navegadores solo la permiten en contexto seguro. Funciona
> en `localhost` y en la app Android, **no** abriendo el `index.html` con
> `file://`.

## Compilar el APK

Requiere JDK 17 y el SDK de Android (vía Android Studio o command-line tools),
con `ANDROID_HOME` apuntando al SDK.

```sh
npm install
npx cap sync android
cd android && ./gradlew assembleDebug
```

El APK queda en `android/app/build/outputs/apk/debug/app-debug.apk`. Se instala
por USB, tarjeta SD o Bluetooth, sin internet en ningún momento.

Tras cambiar cualquier cosa en `www/`, correr `npx cap sync android` antes de
recompilar.

### Notas de la plataforma

- `@capacitor/geolocation` **no declara permisos propios**. `ACCESS_FINE_LOCATION`
  y `ACCESS_COARSE_LOCATION` están añadidos a mano en
  `android/app/src/main/AndroidManifest.xml`; si se regenera la carpeta
  `android/`, hay que volver a ponerlos o el GPS falla en silencio.
- `coords.altitude` es altura elipsoidal WGS84. En los Andes el geoide está unos
  30–50 m por debajo, lo que a `0.0035 %/m` desplaza el umbral menos de 0.2
  puntos. Muchos equipos devuelven `altitude: null`; por eso el campo manual en
  msnm es siempre la fuente de verdad y el GPS solo lo rellena.

## Signos clínicos y bloqueo del alta

Un tamizaje mide saturación y nada más. Si hay **signos clínicos marcados**
(cianosis, quejido, aleteo, retracciones) y el resultado sale negativo, el nivel
sigue siendo verde — la saturación *es* normal — pero el alta queda bloqueada:
la pantalla dice «Tamizaje negativo con signos clínicos» y no ofrece el botón de
alta.

Separar `level` de `dischargeBlocked` es deliberado. El algoritmo no miente
sobre lo que midió, y aun así la app no puede empujar al alta a un recién nacido
sintomático — es justo por donde se escapa una coartación de aorta con ductus
permeable.

## Derivación y pedir ayuda

Desde cualquier resultado hay un botón **Pedir ayuda o derivar**. Muestra dos
listas separadas, ordenadas por cercanía:

1. **Cardiología pediátrica** — la referencia especializada, que casi nunca es la
   más cercana. Desde Cusco está a ~570 km.
2. **Pediatría más cercana** — apoyo inmediato y estabilización antes del traslado.

Están separadas porque ordenar solo por distancia entierra al centro
especializado: desde Cusco los cinco más cercanos tienen pediatría y ninguno
cardiología pediátrica. Hay un test que lo fija.

Cada centro ofrece **Teleconsulta** o **Iniciar referencia**. La solicitud se
guarda contra la evaluación que la motivó, como `pendiente_envio`, y viaja en el
CSV. Todavía no hay transmisión real: es el módulo de interoperabilidad simulada.

### El registro de establecimientos

[`www/eess.js`](www/eess.js) son **datos semilla**. El registro real se descarga
de RENIPRESS (SUSALUD), en la
[Plataforma Nacional de Datos Abiertos](https://www.datosabiertos.gob.pe/dataset/registro-nacional-de-ipress-renipress-superintendencia-nacional-de-salud-susalud).

El buscador SIGEPS del SIS **no sirve como fuente**: es solo una interfaz de
consulta, sin API, sin descarga masiva y sin coordenadas. Y en cualquier caso el
registro va empaquetado en la app, nunca consultado en línea — derivar tiene que
funcionar donde no hay señal.

Salvedades de los datos semilla, a corregir con RENIPRESS: las coordenadas son
del centro de la ciudad, no del predio; `capacidad` es una clasificación
conservadora por categoría; y **no hay teléfonos**, porque un número inventado en
una app clínica es peor que ninguno. Un test lo verifica.

## Seguimiento a la familia por WhatsApp

El seguimiento se ofrece únicamente después de un tamizaje CCHD verde sin
signos. En la pantalla de resultado, **Dar de alta** abre el registro del celular
y la programación; no existe un flujo paralelo por enlace `wa.me`.

Tres decisiones que están fijadas con tests:

- **El mensaje no lleva el código RN, DNI ni saturaciones.** WhatsApp no es un canal
  seguro, y la familia no necesita la cifra: necesita saber qué hacer.
- **Sin jerga médica.** Nada de «cianosis», «taquipnea» ni «pre-ductal». Los
  signos van como los ve un padre — «se pone morado», «se cansa al lactar» — y el
  mensaje cierra diciendo que *no* son gases, frío ni soroche, que es
  exactamente la confusión que documenta el trabajo de campo.

El celular del cuidador no se solicita durante el tamizaje. Se registra al
momento de dar de alta, dentro de la programación del seguimiento. La falta de
un teléfono nunca impide realizar la evaluación clínica.

### Seguimiento programado después del alta

Un tamizaje CCHD verde sin signos habilita **Dar de alta** y, a continuación,
una agenda simple: fecha y hora del primer envío, frecuencia y cantidad finita de
mensajes. La app calcula las fechas, guarda la programación contra la evaluación
y añade sus campos al CSV.

Para esta demo sin backend, la app revisa localmente las fechas pendientes y, al
llegar cada una, envía el mensaje directamente desde el frontend a:

```text
POST https://graph.facebook.com/<API_VERSION>/<PHONE_NUMBER_ID>/messages
```

El cuerpo usa `messaging_product: "whatsapp"`, destinatario individual y
`type: "text"`. La respuesta solo se marca como aceptada cuando Meta devuelve el
identificador `wamid`. La configuración de la demo está en `www/config.js`.

Esta modalidad expone el token dentro del APK. El ejecutor revisa cada diez
segundos mientras la aplicación está abierta y vuelve a revisar lo vencido al
abrirse o recuperar visibilidad. Android puede suspender una aplicación cerrada,
por lo que esta programación local es únicamente para la demo. Un mensaje simple
puede ser rechazado por Meta si la conversación no está dentro de una ventana de
servicio habilitada.

## Almacenamiento

Todo se guarda en `localStorage`, en dos colecciones ([`www/store.js`](www/store.js)):

- **`children`** — un registro por recién nacido, indexado por un código local
  con formato **`RN-APELLIDO_PADRE-CÓDIGO`** (por ejemplo,
  `RN-QUISPE-A7K4`). La app genera cuatro caracteres para distinguir niños con
  el mismo apellido. Al teclear un código ya conocido se
  recuperan DNI de la madre y datos de nacimiento.
- **`evaluations`** — cada evaluación apunta a su código RN y lleva su número de orden
  (`seq`). Un niño acumula tantas como se le hagan a lo largo del tiempo.

Los cuatro caracteres se verifican contra los registros locales antes de
asignarse. Para producción, la base central debe imponer además una restricción
única y resolver cualquier colisión entre establecimientos.

Las evaluaciones guardan **copia** de los datos del paciente y de los umbrales
aplicados. Es deliberado: si mañana se corrige el DNI de la madre, el registro
clínico de ayer debe seguir mostrando lo que se usó entonces.

Consecuencia importante: **el contador de repeticiones sale del almacenamiento,
no de la memoria**. Si la app se cierra entre una zona gris y la siguiente, la
escalada a positivo sigue contando. Para que una zona gris antigua no escale la
primera medición de hoy, solo cuentan las que caen dentro de
`REPEAT_WINDOW_MIN` (6 h por defecto).

### Exportar

«Historial → Exportar CSV» escribe todas las evaluaciones. En el navegador baja
como descarga; en el APK se escribe en Documentos y se abre el menú de compartir
(un `<a download>` dentro del WebView no descarga nada, de ahí los plugins
`@capacitor/filesystem` y `@capacitor/share`).

Los registros se marcan como exportados solo si el archivo se escribió de
verdad, y **únicamente se pueden borrar los ya exportados**.

## Alcance

Fuera de alcance por ahora: sincronización con un servidor central. Los datos
viven en el equipo y salen por CSV. No hay cifrado: en Android el sandbox impide
que otras apps lean el almacenamiento, pero un equipo desbloqueado expone los
registros — de ahí que exista el borrado tras exportar.
