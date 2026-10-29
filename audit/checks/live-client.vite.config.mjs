import path from 'node:path';
import projectConfig from '../../client/vite.config.js';

// Preview Stage 2 builds locally without overwriting the retained baseline dist.
// The original Host header preserves the API's production Origin/CSRF checks.
export default async (env) => {
  const config = await projectConfig(env);
  return {
    ...config,
    root: path.resolve(import.meta.dirname, '../../client'),
    cacheDir: path.resolve(import.meta.dirname, '../.tmp/stage2-client-cache'),
    build: {
      ...config.build,
      outDir: path.resolve(import.meta.dirname, '../.tmp/stage2-client-dist'),
      emptyOutDir: true,
    },
    preview: {
      host: '127.0.0.1', port: 5300, strictPort: true,
      proxy: { '/api': { target: 'http://127.0.0.1:3300', changeOrigin: false } },
    },
  };
};
