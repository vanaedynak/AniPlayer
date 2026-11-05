import { readFileSync } from 'node:fs'
import type { CapacitorConfig } from '@capacitor/cli'

// the app id and name come from flavor.json, so the lab copy installs as a separate app
const flavor = JSON.parse(readFileSync(new URL('./flavor.json', import.meta.url), 'utf-8')) as { name: string; appId: string }

const config: CapacitorConfig = {
  appId: `${flavor.appId}.ios`,
  appName: flavor.name,
  webDir: 'dist',
  backgroundColor: '#060a0f',
  ios: {
    contentInset: 'never',
    backgroundColor: '#060a0f',
    allowsLinkPreview: false,
    preferredContentMode: 'desktop',
  },
  plugins: {
    StatusBar: {
      style: 'DARK',
    },
  },
}

export default config
