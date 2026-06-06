/**
 * Custom Message API
 * Send custom messages from your dashboard to customers via Messenger
 */

const PAGE_ACCESS_TOKEN = process.env.MESSENGER_PAGE_ACCESS_TOKEN;
const FACEBOOK_GRAPH_API = 'https://graph.facebook.com/v18.0';

/**
 * Send custom message via Messenger
 */
async function sendCustomMessage(messengerId, messageText) {
  try {
    const url = `${FACEBOOK_GRAPH_API}/me/messages?access_token=${PAGE_ACCESS_TOKEN}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient: { id: messengerId },
        message: { text: messageText }
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('Messenger API error:', errorData);
      return false;
    }

    return true;
  } catch (err) {
    console.error('Error sending custom message:', err);
    return false;
  }
}

/**
 * API endpoint handler
 */
async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { messengerId, message } = req.body;

    if (!messengerId || !message) {
      return res.status(400).json({ error: 'Missing messengerId or message' });
    }

    const sent = await sendCustomMessage(messengerId, message);

    if (sent) {
      return res.status(200).json({ success: true, messengerId });
    } else {
      return res.status(400).json({ success: false, error: 'Failed to send message' });
    }
  } catch (err) {
    console.error('API error:', err);
    return res.status(500).json({ error: err.message });
  }
}

module.exports = handler;
