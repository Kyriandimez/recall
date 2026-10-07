import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: ["@mysten-incubation/memwal", "@mysten/sui", "@mysten/seal"],
};

export default config;
