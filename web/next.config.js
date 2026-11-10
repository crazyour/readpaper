/** @type {import('next').NextConfig} */

const isVercel = process.env.VERCEL === "1";

module.exports = {
  distDir: process.env.DEEPTUTOR_NEXT_DIST_DIR || ".next",
  typescript: {
    tsconfigPath: process.env.DEEPTUTOR_NEXT_TSCONFIG || "tsconfig.json",
  },

  // Docker/local production uses a self-contained server. Vercel creates its
  // own output bundle and must not receive Next's standalone directory.
  output: isVercel ? undefined : "standalone",
  outputFileTracingRoot: isVercel ? undefined : __dirname,

  async redirects() {
    return [{ source: "/", destination: "/research-plan", permanent: false }];
  },
};
