/* Proxy server-side para el envío de WhatsApp.
 * El token de Meta vive solo en variables de entorno de Vercel: nunca llega
 * al navegador ni al APK. */
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método no permitido.' });
    return;
  }

  var version = process.env.META_GRAPH_API_VERSION;
  var phoneNumberId = process.env.META_WHATSAPP_PHONE_NUMBER_ID;
  var token = process.env.META_WHATSAPP_ACCESS_TOKEN;
  if (!version || !phoneNumberId || !token) {
    res.status(500).json({ error: 'El envío de WhatsApp no está configurado en el servidor.' });
    return;
  }

  var to = String((req.body || {}).to || '').replace(/\D/g, '');
  var body = String((req.body || {}).body || '');
  if (to.length !== 9 || to.charAt(0) !== '9' || !body.trim()) {
    res.status(400).json({ error: 'Destinatario o mensaje inválido.' });
    return;
  }

  try {
    var endpoint = 'https://graph.facebook.com/' + version + '/' + phoneNumberId + '/messages';
    var response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: '51' + to,
        type: 'text',
        text: { preview_url: false, body: body }
      })
    });
    var result = await response.json().catch(function () { return {}; });
    if (!response.ok) {
      res.status(502).json({ error: (result.error && result.error.message) || ('WhatsApp respondió HTTP ' + response.status + '.') });
      return;
    }
    var messageId = result.messages && result.messages[0] && result.messages[0].id;
    if (!messageId) {
      res.status(502).json({ error: 'WhatsApp no devolvió el identificador del mensaje.' });
      return;
    }
    res.status(200).json({ id: messageId });
  } catch (err) {
    res.status(502).json({ error: 'No se pudo conectar con WhatsApp.' });
  }
};
