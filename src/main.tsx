import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// FORCE disable LangSmith tracing at the absolute highest level
if (typeof window !== 'undefined') {
  (window as any).process = (window as any).process || {};
  (window as any).process.env = (window as any).process.env || {};
  (window as any).process.env.LANGCHAIN_TRACING_V2 = "false";
  (window as any).process.env.LANGSMITH_TRACING = "false";
  (window as any).process.env.LANGCHAIN_API_KEY = "";
  (window as any).process.env.LANGSMITH_API_KEY = "";
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
