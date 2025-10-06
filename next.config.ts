/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    // lets build succeed even if ESLint finds errors
    ignoreDuringBuilds: true,
  },
};
module.exports = nextConfig;
