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
    const { reference_code, reference } = req.body || {};
    const ref = reference_code || reference;
    if (!ref) return res.status(400).json({ success: false, error: 'Missing reference' });

    const { data: booking, error } = await supabase
      .from('bookings')
      .select('*')
      .eq('reference_code', ref)
      .single();

    if (error || !booking) {
      return res.status(200).json({ success: true, found: false, message: 'Booking not found' });
    }

    return res.status(200).json({
      success: true,
      found: true,
      reference_code: booking.reference_code,
      status: booking.status || 'pending',
      customer_name: booking.customer_name,
      booking_date: booking.booking_date,
      time_slot: booking.time_slot,
      court: booking.court || booking.court_name,
      message: booking.status === 'pending' ? 'Pending Booking Confirmation' : `Status: ${booking.status}`
    });
  } catch (err) {
    console.error('check-booking error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
}

module.exports = handler;
module.exports.default = handler;
module.exports.handler = handler;