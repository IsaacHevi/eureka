// No caching, keys, history, subscriptions or push payloads are retained here.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(self.clients.matchAll({type:'window', includeUncontrolled:true}).then(async clients => {
    const client = clients.find(c => new URL(c.url).origin === self.location.origin);
    if (client) return client.focus();
    return self.clients.openWindow('/');
  }));
});
