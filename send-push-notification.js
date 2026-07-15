// For Vercel: npm install web-push
// const webpush = require('web-push');

// IMPORTANT: Generate VAPID keys (run this once):
// const vapidKeys = webpush.generateVAPIDKeys();
// console.log('Public Key:', vapidKeys.publicKey);
// console.log('Private Key:', vapidKeys.privateKey);

// Then set these in environment variables
// const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
// const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
// const subjectEmail = 'mailto:your-email@example.com';

// webpush.setVapidDetails(subjectEmail, vapidPublicKey, vapidPrivateKey);

// When a booking is created (in your messenger-webhook.js or booking API):
async function sendPendingBookingNotification(booking) {
  // This would run when booking.status === 'pending'
  
  // const subscription = JSON.parse(localStorage.getItem('pushSubscription'));
  // if (!subscription) {
  //   console.log('No push subscription found');
  //   return;
  // }

  // const payload = JSON.stringify({
  //   title: 'New Pending Booking',
  //   body: `${booking.customer_name} • ${booking.phone_number} • Check it now!`,
  //   bookingId: booking.id,
  //   icon: 'logo.jpeg',
  //   badge: 'logo.jpeg'
  // });

  // try {
  //   await webpush.sendNotification(subscription, payload);
  //   console.log('Push notification sent successfully');
  // } catch (err) {
  //   console.error('Failed to send push notification:', err);
  // }
}

module.exports = { sendPendingBookingNotification };
