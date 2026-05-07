import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      'process.env.OPENAI_API_KEY': JSON.stringify(env.OPENAI_API_KEY),
      'process.env.LANGCHAIN_API_KEY': JSON.stringify(env.LANGSMITH_API_KEY),
      'process.env.LANGCHAIN_TRACING_V2': JSON.stringify(env.LANGSMITH_TRACING),
      'process.env.LANGCHAIN_PROJECT': JSON.stringify(env.LANGCHAIN_PROJECT),
      'process.env.LANGCHAIN_ENDPOINT': JSON.stringify("https://api.smith.langchain.com"),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
        'node:async_hooks': path.resolve(__dirname, './src/polyfills/async_hooks.js'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
