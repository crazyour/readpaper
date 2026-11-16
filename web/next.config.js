/** @type {import('next').NextConfig} */

module.exports = {
  output: process.env.VERCEL === "1" ? undefined : "standalone",
};
