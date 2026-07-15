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
