import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts', 'src/config.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'node20',
  external: ['keytar'],
  noExternal: ['@slack/bolt', '@slack/web-api'],
})
