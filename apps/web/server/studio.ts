import type { IncomingMessage, ServerResponse } from 'node:http'
import { createMaterialHandler } from './materials.ts'
import { createWorkspaceHandler } from './workspace.ts'

export function createStudioHandler(path: string) {
  const workspace = createWorkspaceHandler(path)
  const materials = createMaterialHandler(path, workspace.notifyMaterialsChanged)
  return {
    handle(req: IncomingMessage, res: ServerResponse, next: () => void) {
      return materials.handle(req, res, () => { void workspace.handle(req, res, next) })
    },
    close() {
      workspace.close()
      materials.close()
    },
  }
}
