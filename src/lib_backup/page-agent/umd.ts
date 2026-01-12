/**
 * Auto-run entry for page-agent.js. Insert this script into your page to get page-agent functionality.
 */
import { PageAgent, type PageAgentConfig } from './PageAgent'

// Clean up existing instances to prevent multiple injections from bookmarklet
if (window.pageAgent) {
	window.pageAgent.dispose()
}

// Mount to global window object
window.PageAgent = PageAgent

// Export for ES module usage
// export { PageAgent }

console.log('🚀 page-agent.js loaded!')

const DEMO_MODEL = 'PAGE-AGENT-FREE-TESTING-RANDOM'
const DEMO_BASE_URL = 'https://hwcxiuzfylggtcktqgij.supabase.co/functions/v1/llm-testing-proxy'
const DEMO_API_KEY = 'PAGE-AGENT-FREE-TESTING-RANDOM'

// in case document.x is not ready yet
// @todo give a switch to disable auto-init
setTimeout(() => {
	const currentScript = document.currentScript as HTMLScriptElement | null
	if (currentScript) {
		console.log('🚀 page-agent.js detected current script:', currentScript.src)
		const url = new URL(currentScript.src)
		const model = url.searchParams.get('model') || DEMO_MODEL
		const baseURL = url.searchParams.get('baseURL') || DEMO_BASE_URL
		const apiKey = url.searchParams.get('apiKey') || DEMO_API_KEY
		const language = (url.searchParams.get('lang') as 'zh-CN' | 'en-US') || 'zh-CN'
		const config: PageAgentConfig = { model, baseURL, apiKey, language }
		window.pageAgent = new PageAgent(config)
	} else {
		console.log('🚀 page-agent.js no current script detected, using default demo config')
		window.pageAgent = new PageAgent()
	}

	console.log('🚀 page-agent.js initialized with config:', window.pageAgent.config)

	window.pageAgent.panel.show() // Show panel
})
