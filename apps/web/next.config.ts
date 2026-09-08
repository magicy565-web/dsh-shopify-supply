import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  devIndicators: false,
  transpilePackages: ['@dsh-supply/agent-contracts', '@dsh-supply/catalog', '@dsh-supply/procurement'],
}

export default nextConfig
