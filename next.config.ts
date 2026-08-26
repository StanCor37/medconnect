import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // These ship native bindings (@napi-rs/canvas's .node binary, pdfjs-dist's
  // worker) that the bundler otherwise tries to process and breaks
  // native-module path resolution for — Segment 6's rendering pipeline needs
  // them handled by Node's own `require` at runtime instead. OCR itself now
  // shells out to a native Tesseract binary via child_process rather than
  // bundling an in-process engine, so it needs no entry here.
  serverExternalPackages: ["@napi-rs/canvas", "pdfjs-dist"],
};

export default nextConfig;
