/**
 * Confirm Booking API
 * Updates booking status to confirmed and supports ManyChat automation.
 * If the request comes from ManyChat, the backend updates the booking only
 * and returns a confirmation payload for ManyChat to send to the customer.
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
async function confirmBooking(referenceCode, options = {}) {
  const { isManyChat = false, subscriberId = null } = options;

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
    const updatePayload = {
      status: 'confirmed',
      confirmed_at: new Date().toISOString(),
      confirmed_by: 'admin'
    };

    const { error: updateError } = await supabase
      .from('bookings')
      .update(updatePayload)
      .eq('reference_code', referenceCode);

    if (updateError) {
      console.error('Failed to update booking:', updateError);
      return {
        success: false,
        error: 'Failed to update booking status',
        reference_code: referenceCode
      };
    }

    // If the request comes from ManyChat, do not send a duplicate Messenger notification.
    let messengerNotificationSent = false;
    if (!isManyChat && booking.messenger_id) {
      messengerNotificationSent = await sendConfirmationMessage(booking.messenger_id, booking);
    }

    // Send via ManyChat if configured and subscriber id exists (avoid duplicate when request originates from ManyChat)
    let manychatNotificationSent = false;
    const MANYCHAT_URL = process.env.MANYCHAT_SEND_URL; // configurable endpoint
    const MANYCHAT_TOKEN = process.env.MANYCHAT_API_TOKEN;

    if (!isManyChat && booking.manychat_subscriber_id && MANYCHAT_URL && MANYCHAT_TOKEN) {
      try {
        const bookingDetails = `📅 Booking Confirmed!\n\nReference: ${booking.reference_code}\nCustomer: ${booking.customer_name}\nPhone: ${booking.phone_number || 'N/A'}\n\nBooking Details:\nCourt: ${booking.court || booking.court_name || 'N/A'}\nDate: ${booking.booking_date || 'N/A'}\nTime: ${booking.time_slot || booking.booking_time || 'N/A'}\nAmount: ₱${parseFloat(booking.price || booking.rate || 0).toFixed(2)}\n\nStatus: CONFIRMED${booking.booking_notes ? `\nNotes: ${booking.booking_notes}` : ''}`;

        const resp = await fetch(MANYCHAT_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${MANYCHAT_TOKEN}`
          },
          body: JSON.stringify({
            subscriber_id: booking.manychat_subscriber_id,
            message: { text: bookingDetails }
          })
        });

        if (resp.ok) {
          manychatNotificationSent = true;
          console.log(`✅ ManyChat confirmation sent to ${booking.manychat_subscriber_id}`);
        } else {
          const errData = await resp.text().catch(() => '');
          console.warn('ManyChat API error:', resp.status, errData);
        }
      } catch (mcErr) {
        console.error('Error sending ManyChat notification:', mcErr);
      }
    }

    return {
      success: true,
      reference_code: referenceCode,
      customer_name: booking.customer_name,
      manychat_confirmed: isManyChat,
      messenger_notification_sent: messengerNotificationSent,
      manychat_notification_sent: manychatNotificationSent,
      message: isManyChat
        ? 'Booking confirmed via ManyChat automation.'
        : (manychatNotificationSent ? 'Booking confirmed! Customer notified via ManyChat.' : (messengerNotificationSent ? 'Booking confirmed! Customer notified via Messenger.' : 'Booking confirmed. Customer can check status anytime by messaging us.'))
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
    const { reference_code, bookingReference, reference, subscriber_id, subscriberId, source, manychat } = req.body;
    const resolvedReference = reference_code || bookingReference || reference;
    const isManyChat = String(source || manychat || '').toLowerCase() === 'manychat';

    if (!resolvedReference) {
      return res.status(400).json({ error: 'Missing booking reference parameter' });
    }

    const result = await confirmBooking(resolvedReference, { isManyChat, subscriberId: subscriber_id || subscriberId });

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
