import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs'],
  dts: false, // Disable type declarations for now due to Babel type issues
  clean: true,
  sourcemap: true,
  minify: false,
  target: 'node18',
  banner: {
    js: '#!/usr/bin/env node',
  },
  onSuccess: 'chmod +x dist/index.js',
});