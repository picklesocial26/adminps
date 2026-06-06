/**
 * Customer Notification API
 * Sends automated Messenger notifications when booking status changes
 * Call this from your dashboard when updating booking status
 */

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const PAGE_ACCESS_TOKEN = process.env.MESSENGER_PAGE_ACCESS_TOKEN;
const FACEBOOK_GRAPH_API = 'https://graph.facebook.com/v18.0';

/**
 * Send notification to customer via Messenger
 */
async function notifyCustomer(bookingReference, newStatus) {
  try {
    // Fetch booking details including customer messenger ID
    const { data: booking, error } = await supabase
      .from('bookings')
      .select('*')
      .eq('reference_code', bookingReference)
      .single();

    if (error || !booking) {
      console.error('Booking not found:', bookingReference);
      return { success: false, error: 'Booking not found' };
    }

    // Format notification message
    const messageText = formatNotificationMessage(booking, newStatus);

    // If we have customer's messenger ID, send notification
    if (booking.messenger_id) {
      const sent = await sendMessengerNotification(booking.messenger_id, messageText);
      return { success: sent, bookingRef: bookingReference, status: newStatus };
    }

    // Otherwise, we could send SMS or email (future feature)
    console.log(`No messenger ID for ${bookingReference}. Alternative notification methods coming soon.`);
    return { success: true, note: 'Messenger ID not available, but booking status updated' };

  } catch (err) {
    console.error('Notification error:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Format notification based on status change
 */
function formatNotificationMessage(booking, newStatus) {
  let message = '';

  switch (newStatus?.toLowerCase()) {
    case 'confirmed':
      message = `✅ Great news! Your booking (${booking.reference_code}) has been confirmed!\n\n📅 ${booking.booking_date}\n⏰ ${booking.time_slot}\n🎾 ${booking.court}\n\nSee you soon at Pickle Social! 🎾`;
      break;
    case 'paid':
      message = `💳 Payment received! Your booking (${booking.reference_code}) is all set.\n\nWe'll see you on ${booking.booking_date} at ${booking.time_slot} on ${booking.court}.`;
      break;
    case 'completed':
      message = `✨ Your game is complete! Thanks for playing at Pickle Social 🎾\n\nWe hope you had fun! See you next time.`;
      break;
    case 'cancelled':
      message = `❌ Your booking (${booking.reference_code}) has been cancelled.\n\nIf you have questions, please contact our support team.`;
      break;
    default:
      message = `📢 Update on your booking (${booking.reference_code}): Status is now ${newStatus}`;
  }

  return message;
}

/**
 * Send message via Facebook Messenger API
 */
async function sendMessengerNotification(recipientId, message) {
  try {
    const url = `${FACEBOOK_GRAPH_API}/me/messages?access_token=${PAGE_ACCESS_TOKEN}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient: { id: recipientId },
        message: { text: message }
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('Messenger API error:', errorData);
      return false;
    }

    console.log(`Notification sent to ${recipientId}`);
    return true;
  } catch (err) {
    console.error('Error sending notification:', err);
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
    const { bookingReference, newStatus, authToken } = req.body;

    if (!bookingReference || !newStatus) {
      return res.status(400).json({ error: 'Missing bookingReference or newStatus' });
    }

    // Optional: Add authentication check here
    // if (authToken !== process.env.NOTIFY_API_SECRET) {
    //   return res.status(401).json({ error: 'Unauthorized' });
    // }

    const result = await notifyCustomer(bookingReference, newStatus);

    if (result.success) {
      return res.status(200).json({ success: true, ...result });
    } else {
      return res.status(400).json(result);
    }
  } catch (err) {
    console.error('API error:', err);
    return res.status(500).json({ error: err.message });
  }
}

module.exports = handler;
