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
  try {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode && token) {
      if (mode === 'subscribe' && token === VERIFY_TOKEN) {
        console.log('✅ Webhook verified');
        res.status(200).send(challenge);
      } else {
        console.warn('❌ Invalid verification token or mode');
        res.status(403).end();
      }
    } else {
      console.warn('❌ Missing verification parameters');
      res.status(400).end();
    }
  } catch (err) {
    console.error('Error in verification:', err);
    res.status(500).end();
  }
}

/**
 * Query booking status from Supabase
 */
async function getBookingStatus(reference) {
  try {
    if (!reference || reference.length < 2) {
      return null;
    }

    const { data, error } = await supabase
      .from('bookings')
      .select('*')
      .eq('reference_code', reference)
      .single();

    if (error) {
      console.warn(`Booking not found for reference: ${reference}`, error.message);
      return null;
    }

    return data || null;
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
  const status = booking.status ? booking.status.toLowerCase() : 'unknown';

  switch (status) {
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
      message = `Your booking status: ${status}`;
  }

  return {
    text: `${statusEmoji} **${statusText}**\n\nBooking Ref: ${booking.reference_code}\nCustomer: ${booking.customer_name}\n\n${message}`,
    quick_replies: status === 'pending' ? [
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
async function sendMessage(recipientId, message, quickReplies) {
  try {
    if (!recipientId || !message || !PAGE_ACCESS_TOKEN) {
      console.warn('Missing required parameters for sending message');
      return false;
    }

    const payload = {
      recipient: { id: recipientId },
      message: {
        text: message
      }
    };

    if (quickReplies) {
      payload.message.quick_replies = quickReplies;
    }

    const url = new URL('/me/messages', 'https://graph.facebook.com/v18.0');
    url.searchParams.set('access_token', PAGE_ACCESS_TOKEN);

    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('Failed to send message:', response.statusText, errorData);
      return false;
    }

    console.log(`✅ Message sent to ${recipientId}`);
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
  try {
    const cleanText = text.trim().toUpperCase();

    // Check if message is a booking reference - simpler pattern
    const referenceMatch = cleanText.match(/[A-Z0-9\-]{6,}/);
    const reference = referenceMatch ? referenceMatch[0] : cleanText;

    // Greeting messages
    if (cleanText.includes('HI') || cleanText.includes('HELLO') || cleanText.includes('START')) {
      await sendMessage(
        senderId,
        'Hey! Welcome to Pickle Social! 🎾\n\nSend us your booking reference to check your booking status.\n\nExample: PKL-ABCD123EFGH'
      );
      return;
    }

    // Help message
    if (cleanText.includes('HELP')) {
      await sendMessage(
        senderId,
        'Sure! Here\'s how to use me:\n\n1. Send your booking reference (e.g., PKL-ABCD123EFGH)\n2. I\'ll check your booking status\n3. You\'ll see if it\'s pending, confirmed, paid, or completed\n\nWhat\'s your booking reference?'
      );
      return;
    }

    // Query booking status
    const booking = await getBookingStatus(reference);
    
    // Store messenger ID when customer contacts about a valid booking
    if (booking && booking.reference_code) {
      try {
        const { error } = await supabase
          .from('bookings')
          .update({ messenger_id: senderId })
          .eq('reference_code', booking.reference_code);
        
        if (!error) {
          console.log(`✅ Messenger ID stored for ${booking.reference_code}`);
        } else {
          console.warn(`Could not store messenger ID:`, error.message);
        }
      } catch (updateErr) {
        console.warn(`Error storing messenger ID:`, updateErr);
      }
    }
    
    const { text: messageText, quick_replies } = formatBookingMessage(booking);
    await sendMessage(senderId, messageText, quick_replies);
  } catch (err) {
    console.error('Error in handleMessage:', err);
  }
}

/**
 * Handle webhook POST events
 */
async function handleEvents(req, res) {
  try {
    const body = req.body;

    if (body && body.object === 'page') {
      if (body.entry && Array.isArray(body.entry)) {
        for (const entry of body.entry) {
          if (entry.messaging && Array.isArray(entry.messaging)) {
            for (const messaging_event of entry.messaging) {
              try {
                if (messaging_event.message) {
                  const senderId = messaging_event.sender.id;
                  const messageText = messaging_event.message.text;

                  if (messageText) {
                    console.log(`📨 Message from ${senderId}: ${messageText}`);
                    await handleMessage(senderId, messageText);
                  }
                }

                // Handle postback (quick reply clicks)
                if (messaging_event.postback) {
                  const senderId = messaging_event.sender.id;
                  const payload = messaging_event.postback.payload;

                  if (payload && payload.startsWith('CHECK_')) {
                    const reference = payload.replace('CHECK_', '');
                    console.log(`🔄 Refresh status for: ${reference}`);
                    const booking = await getBookingStatus(reference);
                    const { text: messageText, quick_replies } = formatBookingMessage(booking);
                    await sendMessage(senderId, messageText, quick_replies);
                  }
                }
              } catch (eventErr) {
                console.error('Error processing event:', eventErr);
              }
            }
          }
        }
      }
      res.status(200).send('ok');
    } else {
      res.status(404).end();
    }
  } catch (err) {
    console.error('Error in handleEvents:', err);
    res.status(500).json({ error: err.message });
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

  try {
    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }

    if (req.method === 'GET') {
      try {
        return handleVerification(req, res);
      } catch (verifyErr) {
        console.error('Verification error:', verifyErr);
        return res.status(500).json({ error: 'Verification failed' });
      }
    }

    if (req.method === 'POST') {
      try {
        return await handleEvents(req, res);
      } catch (eventsErr) {
        console.error('Events handling error:', eventsErr);
        return res.status(500).json({ error: 'Events handling failed' });
      }
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('❌ Handler error:', err.message || err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
}

module.exports = handler;
