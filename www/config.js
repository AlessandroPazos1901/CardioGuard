/* Cardio Alerta — configuración pública del frontend.
 * No poner secretos aquí: este archivo se sirve tal cual al navegador y
 * queda visible dentro del APK. Las credenciales de WhatsApp viven como
 * variables de entorno del servidor (ver api/whatsapp.js) y solo se usan
 * ahí. */
window.CARDIO_CONFIG = {
  WHATSAPP_API_ENDPOINT: '/api/whatsapp'
};
