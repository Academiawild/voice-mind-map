import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(() => {
  const frontendPort = Number(process.env.VITE_PORT ?? 5173);
  const backendPort = Number(process.env.PORT ?? 8787);

  return {
    plugins: [react()],
    server: {
      port: frontendPort,
      strictPort: true,
      host: '127.0.0.1',
      proxy: {
        '/api': {
          target: `http://127.0.0.1:${backendPort}`,
          ws: true,
        },
      },
    },
  };
});
