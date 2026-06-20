import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

if (!process.env.NEXT_BACKEND_ORIGIN) {
  throw new Error('NEXT_BACKEND_ORIGIN is required.');
}

const backendOrigin = process.env.NEXT_BACKEND_ORIGIN.replace(/\/$/, '');

const nextConfig: NextConfig = {
  typescript: { ignoreBuildErrors: false },
  webpack(config, { isServer, webpack }) {
    if (!isServer) {
      // Verovio's Emscripten bundle contains a Node-only dynamic import in a
      // runtime-dead browser branch. Webpack still parses the node: scheme.
      config.plugins.push(
        new webpack.IgnorePlugin({ resourceRegExp: /^node:module$/ })
      );
    }
    return config;
  },
  images: {
    localPatterns: [
      {
        pathname: '/images/**',
      },
      {
        pathname: '/api/v1/files/download/**',
      },
    ],
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.oss-cn-shenzhen.aliyuncs.com',
        port: '',
        pathname: '/**',
      },
    ],
  },
  async rewrites() {
    return [
      {
        source: '/api/v1/:path*',
        destination: `${backendOrigin}/api/v1/:path*`,
      },
    ];
  },
};

export default withNextIntl(nextConfig);
