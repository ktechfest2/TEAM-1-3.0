import type { NextConfig } from 'next';

/**
 * TrustElect's web app is a static site. Pages load their data in the browser from the API
 * at NEXT_PUBLIC_API_URL. Security headers are set by the host: see deploy/web.hosting.template.json.
 */
const nextConfig: NextConfig = {
  output: 'export',
  images: { unoptimized: true },
  turbopack: {
    rules: {
      '*.css': {
        loaders: ['@tailwindcss/turbopack'],
        as: '*.css',
      },
    },
  },
};

export default nextConfig;
