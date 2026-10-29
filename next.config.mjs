/** @type {import('next').NextConfig} */
const nextConfig = {
  // Marketing hero/section videos (public/hero-video*.mp4) are large,
  // immutable files -- cache them long-term so a repeat visit (or
  // scrolling back up past a section) doesn't re-fetch them.
  async headers() {
    return [
      {
        source: "/:path*.mp4",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
    ];
  },
};

export default nextConfig;
