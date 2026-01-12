/**
 * ShadowUIManager manages a single Shadow DOM root for all PageAgent UI elements.
 * This ensures isolation from the page's CSS and prevents visibility issues.
 */
export class ShadowUIManager {
    static #instance: ShadowUIManager | null = null
    #host: HTMLElement
    #shadow: ShadowRoot

    private constructor() {
        // Create host element
        this.#host = document.createElement('div')
        this.#host.id = 'page-agent-ui-root'
        this.#host.style.cssText = 'position: absolute; top: 0; left: 0; width: 0; height: 0; z-index: 2147483647; pointer-events: none;'

        // Create shadow root
        this.#shadow = this.#host.attachShadow({ mode: 'open' })

        // Safe append to document
        this.#safeAppend(this.#host)
    }

    static get instance(): ShadowUIManager {
        if (!this.#instance) {
            this.#instance = new ShadowUIManager()
        }
        return this.#instance
    }

    get shadow(): ShadowRoot {
        return this.#shadow
    }

    /**
     * Append an element to the shadow root
     */
    append(element: HTMLElement) {
        this.#shadow.appendChild(element)
    }

    /**
     * Remove an element from the shadow root
     */
    remove(element: HTMLElement) {
        if (element.parentNode === this.#shadow) {
            this.#shadow.removeChild(element)
        }
    }

    /**
     * Inject styles into the shadow root
     */
    injectStyle(css: string) {
        const style = document.createElement('style')
        style.textContent = css
        this.#shadow.appendChild(style)
    }

    #safeAppend(element: HTMLElement) {
        const tryAppend = () => {
            const target = document.body || document.documentElement
            if (target) {
                // Avoid appending twice or to a disposed document
                if (!document.getElementById(element.id)) {
                    target.appendChild(element)
                }
                return true
            }
            return false
        }

        if (!tryAppend()) {
            const observer = new MutationObserver(() => {
                if (tryAppend()) observer.disconnect()
            })
            observer.observe(document, { childList: true, subtree: true })
        }
    }
}
