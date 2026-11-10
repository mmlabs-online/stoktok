import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/cli.ts'],
  format: ['esm'],
  target: 'node22',
  noExternal: ['@stoktok/core', '@stoktok/db', '@stoktok/sources', '@stoktok/ai'],
  clean: true,
});
