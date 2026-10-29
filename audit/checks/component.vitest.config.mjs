import path from 'node:path';
import { createRequire } from 'node:module';
import react from '../../client/node_modules/@vitejs/plugin-react/dist/index.js';

const client = path.resolve(import.meta.dirname, '../../client');
const require = createRequire(path.join(client, 'package.json'));
const packages = ['react', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-dom',
  '@tanstack/react-query', '@testing-library/react', 'react-router'];

// Keep the temporary regression suite and every generated cache under audit/.
export default {
  root: client,
  cacheDir: '../audit/.tmp/vite-component-cache',
  plugins: [react()],
  resolve: {
    alias: packages.map(name => ({
      find: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`),
      replacement: require.resolve(name),
    })),
  },
  test: {
    environment: 'jsdom', pool: 'vmThreads', globals: true,
    setupFiles: './src/test/setup.js', css: false,
    include: ['../audit/checks/scoring-components.test.jsx'],
  },
};
