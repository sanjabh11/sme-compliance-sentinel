/** @type {import('next').NextConfig} */
const nextConfig = {
  typedRoutes: true,
  async headers() {
    return [
      {
        source: "/admin",
        headers: [{ key: "Cache-Control", value: "no-store" }]
      }
    ];
  },
  outputFileTracingIncludes: {
    "/api/production/deployment-evidence": ["./cloudrun.service.yaml"],
    "/api/production/deployment-packet": ["./cloudrun.service.yaml"],
    "/api/production/hosted-evidence": ["./cloudrun.service.yaml"]
  }
};

export default nextConfig;
