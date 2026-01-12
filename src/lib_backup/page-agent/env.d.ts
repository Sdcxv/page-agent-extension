/// <reference types="vite/client" />
import type { PageAgent } from './PageAgent'

declare module '*.module.css' {
	const classes: Record<string, string>
	export default classes
}

declare module '*.md?raw' {
	const content: string
	export default content
}

declare global {
	interface Window {
		pageAgent?: PageAgent
		PageAgent: typeof PageAgent
		__PAGE_AGENT_IDS__: string[]
	}
}
