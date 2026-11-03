import { defineConfig } from 'vite'

import { foldkit } from '@foldkit/vite-plugin'

import { foldkitAliases } from '../vite.aliases'

export default defineConfig({
  plugins: [foldkit()],
  resolve: { alias: foldkitAliases(__dirname) },
  server: { fs: { allow: ['../../'] } },
})
