const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { reference_code, subscriber_id, type } = req.body || {};
    if (!reference_code || !subscriber_id) {
      return res.status(400).json({ success: false, error: 'Missing reference_code or subscriber_id' });
    }

    // type can be 'psid' (Facebook PSID) or 'manychat' - default to psid
    const field = type === 'manychat' ? 'manychat_subscriber_id' : 'messenger_id';

    const { error } = await supabase
      .from('bookings')
      .update({ [field]: subscriber_id })
      .eq('reference_code', reference_code);

    if (error) {
      console.error('link-subscriber error:', error);
      return res.status(500).json({ success: false, error: error.message });
    }

    return res.status(200).json({ success: true, reference_code, [field]: subscriber_id });
  } catch (err) {
    console.error('link-subscriber exception:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
}

module.exports = handler;
module.exports.default = handler;
module.exports.handler = handler;