/* eslint-disable no-restricted-globals */

// Serves generated images with an artificial delay, so the suspensey gallery
// fixture can simulate images that arrive out of order:
//   /suspensey-gallery-image/<label>.svg?delay=<ms>&hue=<0-360>&fail=1

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (!url.pathname.startsWith('/suspensey-gallery-image/')) {
    return;
  }
  const label = decodeURIComponent(
    url.pathname.slice('/suspensey-gallery-image/'.length).replace(/\.svg$/, '')
  );
  const delay = Number(url.searchParams.get('delay')) || 0;
  const hue = Number(url.searchParams.get('hue')) || 0;
  const fail = url.searchParams.get('fail') === '1';
  event.respondWith(
    new Promise(resolve => {
      setTimeout(() => {
        if (fail) {
          resolve(new Response('Not found', {status: 404}));
          return;
        }
        const svg =
          '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240" viewBox="0 0 320 240">' +
          '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
          `<stop offset="0" stop-color="hsl(${hue},70%,62%)"/>` +
          `<stop offset="1" stop-color="hsl(${(hue + 50) % 360},70%,38%)"/>` +
          '</linearGradient></defs>' +
          '<rect width="320" height="240" fill="url(#g)"/>' +
          '<text x="160" y="138" font-family="sans-serif" font-size="64" ' +
          `font-weight="bold" fill="white" text-anchor="middle">${label}</text>` +
          '</svg>';
        resolve(
          new Response(svg, {
            headers: {
              'Content-Type': 'image/svg+xml',
              'Cache-Control': 'max-age=3600',
            },
          })
        );
      }, delay);
    })
  );
});
