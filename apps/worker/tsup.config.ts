import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/cli.ts'],
  format: ['esm'],
  target: 'node22',
  noExternal: ['@stoktok/core', '@stoktok/db', '@stoktok/sources', '@stoktok/ai'],
  // The pg driver and kysely stay runtime dependencies (installed in the image), never inlined.
  external: ['pg', 'pg-native', 'kysely'],
  clean: true,
});
