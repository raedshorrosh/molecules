import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import { viteSingleFile } from "vite-plugin-singlefile";
import { execSync } from 'child_process';
import fs from 'fs';

function buildOnDemandPlugin() {
  return {
    name: 'build-on-demand',
    configureServer(server: any) {
      server.middlewares.use(async (req: any, res: any, next: any) => {
        if (req.url === '/molecule-editor.html') {
          try {
            console.log('\n--- Intercepted request for molecule-editor.html ---\nBuilding on demand...');
            execSync('npm run build', { stdio: 'inherit' });
            console.log('Build complete. Serving standalone file...');
            const file = fs.readFileSync(path.join(process.cwd(), 'public/molecule-editor.html'));
            res.setHeader('Content-Type', 'text/html');
            res.setHeader('Content-Disposition', 'attachment; filename="molecule-editor.html"');
            res.end(file);
          } catch (e) {
            console.error('Build failed', e);
            res.statusCode = 500;
            res.end('Build failed: ' + String(e));
          }
          return;
        }
        next();
      });
    }
  }
}

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss(), viteSingleFile(), buildOnDemandPlugin()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
