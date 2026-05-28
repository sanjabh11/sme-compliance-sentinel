/** @type {import('next').NextConfig} */
const nextConfig = {
  typedRoutes: true,
  outputFileTracingIncludes: {
    "/api/production/deployment-evidence": ["./cloudrun.service.yaml"],
    "/api/production/deployment-packet": ["./cloudrun.service.yaml"],
    "/api/production/hosted-evidence": ["./cloudrun.service.yaml"]
  }
};

export default nextConfig;
