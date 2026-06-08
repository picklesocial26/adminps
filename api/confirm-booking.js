/**
 * Confirm Booking API
 * Updates booking status to confirmed and sends Messenger notification with booking details
 */

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const PAGE_ACCESS_TOKEN = process.env.MESSENGER_PAGE_ACCESS_TOKEN;
const FACEBOOK_GRAPH_API = 'https://graph.facebook.com/v18.0';

/**
 * Send confirmation message via Messenger with booking details
 */
async function sendConfirmationMessage(messengerId, booking) {
  try {
    if (!messengerId) {
      console.warn(`No messenger ID for booking ${booking.reference_code}. Customer can check status anytime by messaging.`);
      return false;
    }

    const bookingDetails = `📅 *Booking Confirmed!*\n\n*Reference:* ${booking.reference_code}\n*Customer:* ${booking.customer_name}\n*Phone:* ${booking.phone_number || 'N/A'}\n\n*Booking Details:*\n🎾 *Court:* ${booking.court || booking.court_name || 'N/A'}\n📆 *Date:* ${booking.booking_date || 'N/A'}\n⏰ *Time:* ${booking.time_slot || booking.booking_time || 'N/A'}\n💰 *Amount:* ₱${parseFloat(booking.price || booking.rate || 0).toFixed(2)}\n\n*Status:* ✅ CONFIRMED${booking.booking_notes ? `\n📝 *Notes:* ${booking.booking_notes}` : ''}\n\nThank you for booking with Pickle Social! 🎾\nSee you soon!`;

    const url = new URL('/me/messages', FACEBOOK_GRAPH_API);
    url.searchParams.set('access_token', PAGE_ACCESS_TOKEN);

    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient: { id: messengerId },
        message: { text: bookingDetails }
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('Messenger API error:', errorData);
      return false;
    }

    console.log(`✅ Confirmation message sent to ${messengerId}`);
    return true;
  } catch (err) {
    console.error('Error sending confirmation message:', err);
    return false;
  }
}

/**
 * Confirm a booking and notify customer
 */
async function confirmBooking(referenceCode) {
  try {
    // Fetch booking details
    const { data: booking, error: fetchError } = await supabase
      .from('bookings')
      .select('*')
      .eq('reference_code', referenceCode)
      .single();

    if (fetchError || !booking) {
      console.error('Booking not found:', referenceCode);
      return {
        success: false,
        error: 'Booking not found',
        reference_code: referenceCode
      };
    }

    // Update booking status to confirmed
    const { error: updateError } = await supabase
      .from('bookings')
      .update({ 
        status: 'confirmed',
        confirmed_at: new Date().toISOString(),
        confirmed_by: 'admin'
      })
      .eq('reference_code', referenceCode);

    if (updateError) {
      console.error('Failed to update booking:', updateError);
      return {
        success: false,
        error: 'Failed to update booking status',
        reference_code: referenceCode
      };
    }

    // Send confirmation message via Messenger
    let messengerNotificationSent = false;
    if (booking.messenger_id) {
      messengerNotificationSent = await sendConfirmationMessage(booking.messenger_id, booking);
    }

    return {
      success: true,
      reference_code: referenceCode,
      customer_name: booking.customer_name,
      messenger_notification_sent: messengerNotificationSent,
      message: messengerNotificationSent 
        ? 'Booking confirmed! Customer notified via Messenger.'
        : 'Booking confirmed. Customer can check status anytime by messaging us.'
    };
  } catch (err) {
    console.error('Error in confirmBooking:', err);
    return {
      success: false,
      error: err.message,
      reference_code: referenceCode
    };
  }
}

/**
 * API endpoint handler
 */
async function handler(req, res) {
  // CORS headers
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
    const { reference_code } = req.body;

    if (!reference_code) {
      return res.status(400).json({ error: 'Missing reference_code parameter' });
    }

    const result = await confirmBooking(reference_code);

    if (result.success) {
      return res.status(200).json(result);
    } else {
      return res.status(400).json(result);
    }
  } catch (err) {
    console.error('API error:', err);
    return res.status(500).json({ error: err.message });
  }
}

module.exports = handler;
