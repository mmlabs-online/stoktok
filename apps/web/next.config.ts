import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

const nextConfig: NextConfig = {
  transpilePackages: ['@stoktok/core', '@stoktok/db', '@stoktok/ai'],
  serverExternalPackages: ['@anthropic-ai/sdk', '@google/genai', 'pg'],
  output: 'standalone',
  outputFileTracingRoot: repoRoot,
};

export default nextConfig;
