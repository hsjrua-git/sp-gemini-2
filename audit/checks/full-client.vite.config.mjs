import path from 'node:path';
import projectConfig from '../../client/vite.config.js';

// Preserve the project's full configuration; relocate generated output only.
export default async (env) => {
  const config = await projectConfig(env);
  return {
    ...config,
    root: path.resolve(import.meta.dirname, '../../client'),
    cacheDir: path.resolve(import.meta.dirname, '../.tmp/full-client-cache'),
    build: {
      ...config.build,
      outDir: path.resolve(import.meta.dirname, '../.tmp/continuation-06-client-dist'),
      emptyOutDir: true,
    },
  };
};
