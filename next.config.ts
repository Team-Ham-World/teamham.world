import type { NextConfig } from "next";
import { networkInterfaces } from "node:os";

const localDevOrigins = Object.values(networkInterfaces()).flatMap(
  (addresses) =>
    (addresses ?? [])
      .filter((address) => address.family === "IPv4" && !address.internal)
      .map((address) => address.address),
);

const nextConfig: NextConfig = {
  /* Next blocks dev chunks requested through a LAN IP unless that host is
     explicitly trusted. Discover this machine's active IPv4 interfaces so
     phone testing keeps working when DHCP assigns a new address. */
  allowedDevOrigins: localDevOrigins,
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
