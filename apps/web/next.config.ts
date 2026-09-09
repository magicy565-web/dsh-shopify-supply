import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR || '.next',
  devIndicators: false,
  transpilePackages: ['@dsh-supply/agent-contracts', '@dsh-supply/catalog', '@dsh-supply/procurement'],
}

export default nextConfig
