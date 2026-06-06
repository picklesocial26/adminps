/**
 * Messenger Bot Integration Helpers
 * Add this to your dashboard to enable Messenger notifications
 */

/**
 * Notify customer via Messenger when booking status changes
 * @param {string} bookingReference - The booking reference code
 * @param {string} newStatus - The new booking status
 * @returns {Promise<Object>} Response from notification API
 */
async function notifyCustomerViaMessenger(bookingReference, newStatus) {
  try {
    const response = await fetch('/api/notify-customer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bookingReference,
        newStatus
      })
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const result = await response.json();
    console.log('Notification sent:', result);
    return result;
  } catch (err) {
    console.error('Failed to notify customer:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Check booking status via Messenger bot (for testing)
 * @param {string} bookingReference - The booking reference to check
 * @returns {Promise<Object>} Booking status
 */
async function checkBookingViaBot(bookingReference) {
  try {
    // This would require a separate API endpoint if you want to check status
    // For now, users check status by messaging the bot directly
    console.log('User should message bot with:', bookingReference);
    return { info: 'Send "' + bookingReference + '" to the Messenger bot' };
  } catch (err) {
    console.error('Error:', err);
    return { error: err.message };
  }
}

/**
 * Send custom message to customer
 * @param {string} bookingReference - The booking reference
 * @param {string} customMessage - Custom message to send
 * @returns {Promise<Object>} Response from API
 */
async function sendCustomMessage(bookingReference, customMessage) {
  try {
    const response = await fetch('/api/send-custom-message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bookingReference,
        message: customMessage
      })
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    return await response.json();
  } catch (err) {
    console.error('Failed to send message:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Integration example: Call this after confirming a booking
 */
async function confirmBookingAndNotify(bookingReference) {
  try {
    // 1. Update booking status in your dashboard
    console.log('Confirming booking:', bookingReference);

    // 2. Send Messenger notification
    const notifyResult = await notifyCustomerViaMessenger(bookingReference, 'confirmed');

    if (notifyResult.success) {
      showToast(`✅ Booking confirmed! Customer notified via Messenger.`);
    } else {
      showToast(`✅ Booking confirmed but couldn't send Messenger notification.`);
      console.warn('Notification failed:', notifyResult.error);
    }

    return notifyResult;
  } catch (err) {
    console.error('Confirmation error:', err);
    showToast('Error confirming booking');
    return { error: err.message };
  }
}

/**
 * Integration example: Call this after marking as paid
 */
async function markPaidAndNotify(bookingReference) {
  try {
    console.log('Marking as paid:', bookingReference);

    const notifyResult = await notifyCustomerViaMessenger(bookingReference, 'paid');

    if (notifyResult.success) {
      showToast(`💳 Payment recorded! Customer notified via Messenger.`);
    } else {
      showToast(`💳 Payment recorded but couldn't send Messenger notification.`);
    }

    return notifyResult;
  } catch (err) {
    console.error('Payment error:', err);
    showToast('Error marking payment');
    return { error: err.message };
  }
}

/**
 * Integration example: Call this when cancelling a booking
 */
async function cancelBookingAndNotify(bookingReference) {
  try {
    console.log('Cancelling booking:', bookingReference);

    const notifyResult = await notifyCustomerViaMessenger(bookingReference, 'cancelled');

    if (notifyResult.success) {
      showToast(`❌ Booking cancelled. Customer notified via Messenger.`);
    } else {
      showToast(`❌ Booking cancelled but couldn't send Messenger notification.`);
    }

    return notifyResult;
  } catch (err) {
    console.error('Cancellation error:', err);
    showToast('Error cancelling booking');
    return { error: err.message };
  }
}

// Export for use in modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    notifyCustomerViaMessenger,
    checkBookingViaBot,
    sendCustomMessage,
    confirmBookingAndNotify,
    markPaidAndNotify,
    cancelBookingAndNotify
  };
}
