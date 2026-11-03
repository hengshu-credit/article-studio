import { bootstrap } from './bootstrap'
import { silenceDevLogs } from './lib/bootstrap/silence-dev-logs'

import 'vue-sonner/style.css'
import '@/assets/index.css'
import '@/assets/less/codemirror-global.less'
import '@/assets/less/global.less'

import '@/assets/less/theme.less'
import '@/assets/studio-shell.css'

silenceDevLogs()

bootstrap().catch(console.error)
