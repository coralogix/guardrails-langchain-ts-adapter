import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['./index.ts'],
  dts: true,
  clean: true,
  format: ['esm', 'cjs'],
})
