import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

const nextConfig: NextConfig = {
  transpilePackages: ['@stoktok/core', '@stoktok/db'],
  output: 'standalone',
  outputFileTracingRoot: repoRoot,
  experimental: { authInterrupts: true },
};

export default nextConfig;
