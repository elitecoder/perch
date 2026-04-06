import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'node20',
  external: ['keytar'],
  noExternal: ['@perch-dev/shared', '@slack/web-api'],
  banner: {
    js: '#!/usr/bin/env node',
  },
})
