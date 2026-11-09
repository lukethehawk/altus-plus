import { defineConfig } from 'vite';

// https://vitejs.dev/config
export default defineConfig({
  build: {
    // The main process loads its tray icons and translations from next to
    // main.cjs; Forge 8 no longer copies public/ there by default.
    copyPublicDir: true,
  },
  define: {
    // Only set when building a local update test; release builds get "".
    ALTUS_TEST_UPDATE_FEED: JSON.stringify(
      process.env.ALTUS_TEST_UPDATE_FEED ?? ''
    ),
  },
  resolve: {
    // Some libs that can run in both Web and Node.js, such as `axios`, we need to tell Vite to build them in Node.js.
    mainFields: ['module', 'jsnext:main', 'jsnext'],
  },
});
