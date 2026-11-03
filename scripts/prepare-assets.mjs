import { createRequire } from 'node:module'
import { cpSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
const require = createRequire(new URL('../apps/web/package.json', import.meta.url))
const source = join(dirname(require.resolve('highlight.js/package.json')), 'styles')
const target = new URL('../apps/web/public/code-themes/', import.meta.url)
mkdirSync(target, { recursive: true })
cpSync(source, target, { recursive: true })
console.log('Local highlight.js themes prepared')
