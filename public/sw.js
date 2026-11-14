/**
 * SMART VLE TOOL - Offline Service Worker
 * Complete offline caching for Document Studio, ID Card Studio, Image & PDF Editor
 */

const CACHE_NAME = 'monu-offline-v1.9';

const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/document-studio',
  '/document-studio/index.html',
  '/id-card-studio',
  '/id-card-studio/index.html',
  '/image-pdf-editor',
  '/image-pdf-editor/index.html',
  '/about-us',
  '/about-us/index.html',
  '/contact-us',
  '/contact-us/index.html',
  '/privacy-policy',
  '/privacy-policy/index.html',
  '/terms-and-conditions',
  '/terms-and-conditions/index.html',
  '/copyright-policy',
  '/copyright-policy/index.html',
  '/disclaimer',
  '/disclaimer/index.html',
  '/style.css',
  '/script.js',
  '/editor.js',
  '/smart-optimizer.js',
  '/browser-image-compression.js',
  '/site-router.js',
  '/videos-config.js',
  '/tutorial-videos.js',
  '/pwa-controller.js',
  '/manifest.webmanifest',
  '/icon.svg',
  '/pwa-192x192.png',
  '/pwa-512x512.png',
  '/pwa-maskable-512x512.png',
  '/apple-touch-icon.png',
  '/assets/aistudio/Document_Studio_Neon_Feature_Showcase_b3130b6f.png',
  '/assets/aistudio/Gemini_Generated_Image_oedxj3oedxj3oedx_65a15a70.png',
  '/assets/aistudio/Gemini_Generated_Image_oj4tkeoj4tkeoj4t_469c242c.png'
];

// Essential External CDNs for Offline Canvas & Document Processing
const EXTERNAL_CDNS = [
  'https://docs.opencv.org/4.5.4/opencv.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.min.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      console.log('[SW] Precaching core offline assets...');
      
      // Cache local assets resiliently
      for (const url of PRECACHE_URLS) {
        try {
          await cache.add(url);
        } catch (err) {
          console.warn('[SW] Could not precache:', url, err);
        }
      }

      // Precache external CDN libraries
      for (const url of EXTERNAL_CDNS) {
        try {
          const response = await fetch(url, { mode: 'cors' });
          if (response && response.ok) {
            await cache.put(url, response);
            console.log('[SW] Cached CDN library for offline use:', url);
          }
        } catch (err) {
          console.warn('[SW] Could not prefetch CDN:', url, err);
        }
      }
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[SW] Removing old cache:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  if (request.headers.has('range')) return;

  const url = new URL(request.url);
  if (url.pathname.startsWith('/videos/')) return;

  // Strategy 1: External CDNs (OpenCV, jsPDF, PDF.js, Google Fonts) -> Cache First
  const isCdn = url.hostname.includes('opencv.org') ||
                url.hostname.includes('cloudflare.com') ||
                url.hostname.includes('googleapis.com') ||
                url.hostname.includes('gstatic.com');

  if (isCdn) {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(request).then((networkResponse) => {
          if (networkResponse && (networkResponse.status === 200 || networkResponse.type === 'opaque')) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return networkResponse;
        }).catch(() => {
          console.warn('[SW] Offline CDN request failed and not in cache:', request.url);
          return new Response('/* Offline fallback for CDN */', {
            headers: { 'Content-Type': 'application/javascript' }
          });
        });
      })
    );
    return;
  }

  // Strategy 2: HTML navigations -> Stale-While-Revalidate with /index.html offline fallback
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(async () => {
          // If offline, check exact match first, then fallback to /index.html
          const cached = await caches.match(request);
          if (cached) return cached;
          const fallback = await caches.match('/index.html');
          if (fallback) return fallback;
          return new Response('<h1>Offline Mode</h1><p>SMART VLE TOOL is offline.</p>', {
            headers: { 'Content-Type': 'text/html' }
          });
        })
    );
    return;
  }

  // Strategy 3: Local CSS & JS -> Network First with Cache Fallback (always pick up latest UI fixes)
  const isCodeAsset = url.origin === self.location.origin &&
    (url.pathname.endsWith('.css') || url.pathname.endsWith('.js'));

  if (isCodeAsset) {
    event.respondWith(
      fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return networkResponse;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          if (cached) return cached;
          return caches.match(url.pathname);
        })
    );
    return;
  }

  // Strategy 4: Other Static Assets (Images, Manifest, Icons) -> Cache First with Background Update
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) {
        fetch(request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            caches.open(CACHE_NAME).then((cache) => cache.put(request, networkResponse));
          }
        }).catch(() => {/* Ignore background update failures when offline */});
        return cachedResponse;
      }

      return fetch(request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return networkResponse;
      });
    })
  );
});

// Communication with client UI
self.addEventListener('message', async (event) => {
  if (event.data && event.data.type === 'PRECACHE_ALL_NOW') {
    const cache = await caches.open(CACHE_NAME);
    let cachedCount = 0;
    const allToCache = [...PRECACHE_URLS, ...EXTERNAL_CDNS];
    for (const url of allToCache) {
      try {
        const res = await fetch(url, { mode: 'cors' });
        if (res && (res.ok || res.type === 'opaque')) {
          await cache.put(url, res);
          cachedCount++;
        }
      } catch (e) {
        // Continue
      }
    }
    event.source.postMessage({
      type: 'PRECACHE_COMPLETE',
      total: allToCache.length,
      cached: cachedCount
    });
  }
});
