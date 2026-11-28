import type { NextConfig } from 'next';
import { CUSTOMER_API_PREFIX } from './src/generated/browser-protocol';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

if (process.env.NODE_ENV === 'development' && !process.env.NEXT_BACKEND_ORIGIN) {
  throw new Error('NEXT_BACKEND_ORIGIN is required.');
}

const backendOrigin = process.env.NEXT_BACKEND_ORIGIN?.replace(/\/$/, '');
const allowedDevOrigins = process.env.NEXT_ALLOWED_DEV_ORIGINS
  ? process.env.NEXT_ALLOWED_DEV_ORIGINS
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean)
  : [];

const nextConfig: NextConfig = {
  typescript: { ignoreBuildErrors: false },
  ...(allowedDevOrigins.length > 0 ? { allowedDevOrigins } : {}),
  webpack(config, { isServer, webpack }) {
    if (!isServer) {
      // Verovio's Emscripten bundle contains a Node-only dynamic import in a
      // runtime-dead browser branch. Webpack still parses the node: scheme.
      config.plugins.push(
        new webpack.IgnorePlugin({ resourceRegExp: /^node:module$/ })
      );
    } else {
      config.resolve = config.resolve || {};
      config.resolve.alias = {
        ...config.resolve.alias,
        'onnxruntime-web/webgpu': false,
        'onnxruntime-web': false,
      };
    }
    return config;
  },
  images: {
    localPatterns: [
      {
        pathname: '/images/**',
      },
    ],
  },
  async rewrites() {
    if (process.env.NODE_ENV !== 'development') return [];
    return [
      {
        source: `${CUSTOMER_API_PREFIX}/:path*`,
        destination: `${backendOrigin}${CUSTOMER_API_PREFIX}/:path*`,
      },
    ];
  },
};

export default withNextIntl(nextConfig);
