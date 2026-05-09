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
      'process.env.LANGCHAIN_API_KEY': JSON.stringify(""), // Force empty to kill tracing
      'process.env.LANGCHAIN_TRACING_V2': JSON.stringify("false"),
      'process.env.LANGCHAIN_PROJECT': JSON.stringify(""),
      'process.env.LANGCHAIN_ENDPOINT': JSON.stringify(""),
      'process.env.TAVILY_API_KEY': JSON.stringify(env.TAVILY_API_KEY),
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
