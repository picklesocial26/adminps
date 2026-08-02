const SUPABASE_URL = 'https://mpkmtcdsubopnrpyqwel.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1wa210Y2RzdWJvcG5ycHlxd2VsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU2NjI3MzQsImV4cCI6MjEwMTIzODczNH0.jLAVUE1Ixl6aLVqAcaHR3olwFWAvtDjV9u2vrJDTBoQ';

self.addEventListener('install', event => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', event => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || 'New Pending Booking';
  const options = {
    body: data.body || 'Check it now!',
    icon: 'logo.jpeg',
    badge: 'logo.jpeg',
    tag: 'pending-booking',
    renotify: true
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('sync', event => {
  if (event.tag === 'check-pending-bookings') {
    event.waitUntil(checkPendingBookingsBackground());
  }
});

async function checkPendingBookingsBackground() {
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/bookings?status=eq.pending&select=*&order=created_at.desc&limit=5`, {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
      }
    });

    if (!response.ok) return;

    const bookings = await response.json();
    if (bookings && bookings.length > 0) {
      const latest = bookings[0];
      const clientList = await self.clients.matchAll({ type: 'window' });
      
      if (clientList.length === 0) {
        const title = 'New Pending Booking';
        const options = {
          body: `${latest.customer_name || 'A customer'} • ${latest.phone_number || 'N/A'} • Check it now!`,
          icon: 'logo.jpeg',
          badge: 'logo.jpeg',
          tag: 'pending-booking',
          renotify: true,
          requireInteraction: true
        };
        await self.registration.showNotification(title, options);
      } else {
        clientList.forEach(client => {
          client.postMessage({
            type: 'PENDING_BOOKING_CHECK',
            bookings: bookings
          });
        });
      }
    }
  } catch (err) {
    console.error('Background sync check failed:', err);
  }
}
