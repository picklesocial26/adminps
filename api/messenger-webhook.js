/**
 * Messenger Webhook Handler for Pickle Social
 * Handles incoming messages and sends booking status updates
 */

const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Facebook Messenger constants
const VERIFY_TOKEN = process.env.MESSENGER_VERIFY_TOKEN;
const PAGE_ACCESS_TOKEN = process.env.MESSENGER_PAGE_ACCESS_TOKEN;

/**
 * GET request handler for webhook verification
 */
function handleVerification(req, res) {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token) {
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('Webhook verified');
      res.status(200).send(challenge);
    } else {
      res.sendStatus(403);
    }
  } else {
    res.sendStatus(400);
  }
}

/**
 * Query booking status from Supabase
 */
async function getBookingStatus(reference) {
  try {
    const { data, error } = await supabase
      .from('bookings')
      .select('*')
      .eq('reference_code', reference)
      .single();

    if (error) {
      console.error('Database error:', error);
      return null;
    }

    return data;
  } catch (err) {
    console.error('Error fetching booking:', err);
    return null;
  }
}

/**
 * Format booking status for user-friendly message
 */
function formatBookingMessage(booking) {
  if (!booking) {
    return {
      text: "❌ Booking not found. Please check your booking reference and try again.",
      quick_replies: null
    };
  }

  let statusEmoji = '⏳';
  let statusText = 'Pending';
  let message = '';

  switch (booking.status?.toLowerCase()) {
    case 'pending':
      statusEmoji = '⏳';
      statusText = 'Pending';
      message = `Your booking is still pending.\n\nWe'll confirm it shortly. Please wait for your admin to review and confirm your payment.`;
      break;
    case 'confirmed':
      statusEmoji = '✅';
      statusText = 'Confirmed';
      message = `Great! Your booking is confirmed.\n\n📅 Date: ${booking.booking_date}\n⏰ Time: ${booking.time_slot}\n🎾 Court: ${booking.court}`;
      break;
    case 'paid':
      statusEmoji = '💳';
      statusText = 'Paid';
      message = `Your payment has been received!\n\n📅 Date: ${booking.booking_date}\n⏰ Time: ${booking.time_slot}\n🎾 Court: ${booking.court}`;
      break;
    case 'completed':
      statusEmoji = '✨';
      statusText = 'Completed';
      message = `Your booking has been completed.\n\nThank you for using Pickle Social! We hope you enjoyed your game. 🎾`;
      break;
    case 'cancelled':
      statusEmoji = '❌';
      statusText = 'Cancelled';
      message = `Your booking has been cancelled.\n\nIf you believe this is a mistake, please contact our support team.`;
      break;
    default:
      message = `Your booking status: ${booking.status || 'Unknown'}`;
  }

  return {
    text: `${statusEmoji} **${statusText}**\n\nBooking Ref: ${booking.reference_code}\nCustomer: ${booking.customer_name}\n\n${message}`,
    quick_replies: booking.status?.toLowerCase() === 'pending' ? [
      {
        content_type: 'text',
        title: '🔄 Refresh Status',
        payload: `CHECK_${booking.reference_code}`
      }
    ] : null
  };
}

/**
 * Send message via Facebook Messenger API
 */
async function sendMessage(recipientId, message, quickReplies = null) {
  try {
    const payload = {
      recipient: { id: recipientId },
      message: {
        text: message
      }
    };

    if (quickReplies) {
      payload.message.quick_replies = quickReplies;
    }

    const response = await fetch('https://graph.facebook.com/v18.0/me/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload),
      qs: { access_token: PAGE_ACCESS_TOKEN }
    });

    if (!response.ok) {
      console.error('Failed to send message:', response.statusText);
      return false;
    }

    return true;
  } catch (err) {
    console.error('Error sending message:', err);
    return false;
  }
}

/**
 * Handle incoming messages
 */
async function handleMessage(senderId, text) {
  const cleanText = text.trim().toUpperCase();

  // Check if message is a booking reference (typically starts with 'REF' or similar pattern)
  const referenceMatch = cleanText.match(/REF[A-Z0-9-]{0,20}/);
  const reference = referenceMatch ? referenceMatch[0] : cleanText;

  // Greeting messages
  if (cleanText.includes('HI') || cleanText.includes('HELLO') || cleanText.includes('START')) {
    await sendMessage(
      senderId,
      'Hey! Welcome to Pickle Social! 🎾\n\nSend us your booking reference to check your booking status.\n\nExample: REF-ABC123'
    );
    return;
  }

  // Help message
  if (cleanText.includes('HELP')) {
    await sendMessage(
      senderId,
      'Sure! Here\'s how to use me:\n\n1. Send your booking reference (e.g., REF-ABC123)\n2. I\'ll check your booking status\n3. You\'ll see if it\'s pending, confirmed, paid, or completed\n\nWhat\'s your booking reference?'
    );
    return;
  }

  // Query booking status
  const booking = await getBookingStatus(reference);
  const { text: messageText, quick_replies } = formatBookingMessage(booking);

  await sendMessage(senderId, messageText, quick_replies);
}

/**
 * Handle webhook POST events
 */
async function handleEvents(req, res) {
  const body = req.body;

  if (body.object === 'page') {
    for (const entry of body.entry) {
      for (const messaging_event of entry.messaging) {
        if (messaging_event.message) {
          const senderId = messaging_event.sender.id;
          const messageText = messaging_event.message.text;

          if (messageText) {
            console.log(`Message from ${senderId}: ${messageText}`);
            await handleMessage(senderId, messageText);
          }
        }

        // Handle postback (quick reply clicks)
        if (messaging_event.postback) {
          const senderId = messaging_event.sender.id;
          const payload = messaging_event.postback.payload;

          if (payload.startsWith('CHECK_')) {
            const reference = payload.replace('CHECK_', '');
            console.log(`Refresh status for: ${reference}`);
            const booking = await getBookingStatus(reference);
            const { text: messageText, quick_replies } = formatBookingMessage(booking);
            await sendMessage(senderId, messageText, quick_replies);
          }
        }
      }
    }
    res.status(200).send('ok');
  } else {
    res.sendStatus(404);
  }
}

/**
 * Main webhook handler
 */
async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method === 'GET') {
    return handleVerification(req, res);
  }

  if (req.method === 'POST') {
    return handleEvents(req, res);
  }

  res.status(405).json({ error: 'Method not allowed' });
}

module.exports = handler;
