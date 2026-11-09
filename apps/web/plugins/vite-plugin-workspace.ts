import type { Plugin } from 'vite'
import { resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { createStudioHandler } from '../server/studio.ts'

export function workspacePlugin(): Plugin {
  const path = process.env.ARTICLE_STUDIO_DATA_PATH ?? fileURLToPath(new URL('../../../data/workspace.sqlite', import.meta.url))
  return {
    name: 'article-studio-workspace',
    configureServer(server) {
      const handler = createStudioHandler(resolve(path))
      server.middlewares.use((req, res, next) => { void handler.handle(req, res, next) })
      server.httpServer?.once('close', () => handler.close())
    },
    configurePreviewServer(server) {
      const handler = createStudioHandler(resolve(path))
      server.middlewares.use((req, res, next) => { void handler.handle(req, res, next) })
      server.httpServer.once('close', () => handler.close())
    },
  }
}
