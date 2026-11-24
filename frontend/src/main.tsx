import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { API_BASE } from './api/client';
import { installClientErrorReporting } from './utils/clientErrors';

// Before the first render, so an error while rendering is reported too.
installClientErrorReporting(`${API_BASE}/client-errors`, import.meta.env.VITE_BUILD_ID || undefined);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
