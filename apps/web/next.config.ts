import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@stoktok/core', '@stoktok/db'],
};

export default nextConfig;
