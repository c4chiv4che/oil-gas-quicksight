import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
//
// Functional form so `command` is available. Dev (`vite`) serves from
// '/' for localhost:5173; build (`vite build`) targets the GitHub Pages
// subpath. `command === 'build'` is the official switch — using `mode`
// would also flip on `vite build --mode anything`, which we don't want.
export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: command === 'build' ? '/oil-gas-quicksight/' : '/',
}))
