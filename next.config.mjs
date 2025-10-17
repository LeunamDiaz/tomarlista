/** @type {import('next').NextConfig} */
const nextConfig = {
  // Configuración del proyecto de asistencia
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' },
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains; preload' },
        ],
      },
      {
        source: '/_next/static/(.*)',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
      {
        source: '/:all*(svg|png|jpg|jpeg|gif|webp|ico|css|js|woff|woff2)',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
      {
        source: '/',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, max-age=0' },
        ],
      },
      {
        source: '/:path*',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, max-age=0' },
        ],
      },
    ];
  },
};

export default nextConfig;
