import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts'],
  format: ['esm'],
  target: 'node20',
  clean: true,
  sourcemap: true,
  // The shared workspace package ships TypeScript source, so it must be bundled in.
  noExternal: ['@tadka/shared'],
});
