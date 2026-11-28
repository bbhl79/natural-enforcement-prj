import { createWebRoot, DEFAULT_ROOT_ID_PREFIX } from './lib/root.js'
import App from './App.js'
import './index.css'

createWebRoot(document.getElementById('root')!, {
  identifierPrefix: DEFAULT_ROOT_ID_PREFIX,
}).render(<App />)
