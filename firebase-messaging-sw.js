importScripts('https://www.gstatic.com/firebasejs/10.7.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyB4gLueyFufxHbGPHmvbYBZXhgUWoyQNWc",
  authDomain: "golf-club-28ff5.firebaseapp.com",
  projectId: "golf-club-28ff5",
  storageBucket: "golf-club-28ff5.firebasestorage.app",
  messagingSenderId: "754272270372",
  appId: "1:754272270372:web:b7bb5ad2766e234b7a80b1"
});

const messaging = firebase.messaging();

// 백그라운드 메시지 처리
messaging.onBackgroundMessage(function(payload) {
  console.log('백그라운드 메시지:', payload);
  const { title, body, icon } = payload.notification || {};
  self.registration.showNotification(title || '⛳ 골통회', {
    body: body || '',
    icon: icon || '/icon.png',
    badge: '/icon.png',
    tag: payload.data?.tag || 'goltonghoe',
    data: payload.data
  });
});

// 알림 클릭 시 앱 열기
self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
      for (var i = 0; i < clientList.length; i++) {
        var client = clientList[i];
        if (client.url.includes('golf-club-app') && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow('https://golf-club-app.vercel.app');
      }
    })
  );
});
