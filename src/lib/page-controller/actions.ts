/**
 * Copyright (C) 2025 Alibaba Group Holding Limited
 * All rights reserved.
 */
import type { InteractiveElementDomNode } from './dom/dom_tree/type'

// ======= general utils =======

async function waitFor(seconds: number): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, seconds * 1000))
}

// ======= dom utils =======

// ======= dom utils =======

/**
 * Calculates the center coordinates of an element relative to the TOP-LEVEL viewport.
 * This handles elements inside nested iframes by accumulating offsets.
 */
function getGlobalElementCenter(element: HTMLElement): { x: number, y: number } {
	let x = 0
	let y = 0
	let currentElement: HTMLElement | null = element

	// Start with the element's local rect in its own document/frame
	const localRect = element.getBoundingClientRect()
	x = localRect.left + localRect.width / 2
	y = localRect.top + localRect.height / 2

	// Traverse up the frame hierarchy
	// Note: We can only traverse same-origin frames. 
	// If `dom_tree` gave us an element, it guaranteed it is same-origin (cross-origin access throws error).
	let currentWindow = element.ownerDocument.defaultView

	while (currentWindow && currentWindow !== window.top) {
		try {
			// Get the frame element in the parent window that contains the current text
			const frameElement = currentWindow.frameElement
			if (!frameElement) break // Should not happen if not top

			const frameRect = frameElement.getBoundingClientRect()

			// Accumulate offset
			x += frameRect.left
			y += frameRect.top

			// Account for border width of the iframe itself (optional but precise)
			const style = window.getComputedStyle(frameElement)
			x += parseFloat(style.borderLeftWidth) || 0
			y += parseFloat(style.borderTopWidth) || 0

			// Move up one level
			currentWindow = currentWindow.parent as Window & typeof globalThis
		} catch (e) {
			// Cross-origin access blocked? Stop here.
			// But normally we shouldn't have reference to `element` if it was deep in cross-origin.
			console.warn('[PageAgent Actions] Failed to traverse frame hierarchy for coordinates:', e)
			break
		}
	}

	return { x, y }
}

export async function movePointerToElement(element: HTMLElement) {
	const { x, y } = getGlobalElementCenter(element)

	window.dispatchEvent(new CustomEvent('PageAgent::MovePointerTo', { detail: { x, y } }))

	await waitFor(0.3)
}

/**
 * Get the HTMLElement by index from a selectorMap.
 */
export function getElementByIndex(
	selectorMap: Map<number, InteractiveElementDomNode>,
	index: number
): HTMLElement {
	const interactiveNode = selectorMap.get(index)
	if (!interactiveNode) {
		throw new Error(`No interactive element found at index ${index}`)
	}

	const element = interactiveNode.ref
	if (!element) {
		throw new Error(`Element at index ${index} does not have a reference`)
	}

	if (!(element instanceof HTMLElement)) {
		throw new Error(`Element at index ${index} is not an HTMLElement`)
	}

	return element
}

let lastClickedElement: HTMLElement | null = null

function blurLastClickedElement() {
	if (lastClickedElement) {
		lastClickedElement.blur()
		lastClickedElement.dispatchEvent(
			new MouseEvent('mouseout', { bubbles: true, cancelable: true })
		)
		lastClickedElement = null
	}
}

/**
 * Simulate a click on the element
 */
export async function clickElement(element: HTMLElement, mode: 'simulated' | 'debugger' = 'simulated') {
	console.log(`[PageAgent Actions] clickElement called with mode: ${mode}, element:`, element.tagName)

	// Fixed: Do not blur previous element aggressively. 
	// This causes issues with dropdowns/popovers that close on blur.
	// Let the browser handle focus transition naturally.
	// blurLastClickedElement()

	lastClickedElement = element
	await scrollIntoViewIfNeeded(element)

	// Wait for scroll to settle
	await waitFor(0.2)

	await movePointerToElement(element)
	window.dispatchEvent(new CustomEvent('PageAgent::ClickPointer'))
	await waitFor(0.1)

	if (mode === 'debugger') {
		const { x, y } = getGlobalElementCenter(element)

		console.log(`[PageAgent Content] Debugger click at: (${x}, ${y})`);

		// Temporarily disable mask to let CDP click penetrate to the target element
		const mask = document.getElementById('page-agent-runtime_simulator-mask')
		if (mask) mask.style.setProperty('pointer-events', 'none', 'important')

		// Use chrome.runtime.sendMessage for debugger click via background worker
		await new Promise((resolve) => {
			chrome.runtime.sendMessage({
				type: 'DEBUGGER_CLICK',
				payload: { x, y },
				timestamp: Date.now()
			}, (response) => {
				// Restore mask events
				if (mask) mask.style.setProperty('pointer-events', 'auto', 'important')
				console.log('[PageAgent Actions] Debugger click response:', response, 'chrome.runtime.lastError:', chrome.runtime.lastError);
				resolve(response);
			})
		})
	} else {
		// hover it
		element.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, cancelable: true }))
		element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true }))

		// dispatch a sequence of events to ensure all listeners are triggered
		element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))

		// focus it to ensure it gets the click event
		element.focus()

		element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }))
		element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
	}

	await waitFor(0.1) // Wait to ensure click event processing completes
}

// eslint-disable-next-line @typescript-eslint/unbound-method
const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
	window.HTMLInputElement.prototype,
	'value'
)!.set!

// eslint-disable-next-line @typescript-eslint/unbound-method
const nativeTextAreaValueSetter = Object.getOwnPropertyDescriptor(
	window.HTMLTextAreaElement.prototype,
	'value'
)!.set!

/**
 * create a synthetic keyboard event
 * with key keycode code
 */
export async function createSyntheticInputEvent(elem: HTMLElement, key: string) {
	elem.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key }))
	await waitFor(0.01)

	if (elem instanceof HTMLInputElement || elem instanceof HTMLTextAreaElement) {
		elem.dispatchEvent(new Event('beforeinput', { bubbles: true }))
		await waitFor(0.01)
		elem.dispatchEvent(new Event('input', { bubbles: true }))
		await waitFor(0.01)
	}

	elem.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, cancelable: true, key }))
}

export async function inputTextElement(element: HTMLElement, text: string, mode: 'simulated' | 'debugger' = 'simulated') {
	if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) {
		throw new Error('Element is not an input or textarea')
	}

	await clickElement(element, mode)

	if (mode === 'debugger') {
		console.log(`[PageAgent Actions] Debugger typing text: "${text}"`)
		// Use chrome.runtime.sendMessage for debugger typing via background worker
		await new Promise((resolve) => {
			chrome.runtime.sendMessage({
				type: 'DEBUGGER_TYPE',
				payload: { text },
				timestamp: Date.now()
			}, (response) => {
				console.log('[PageAgent Actions] Debugger type response:', response, 'chrome.runtime.lastError:', chrome.runtime.lastError);
				resolve(response)
			})
		})
	} else {
		if (element instanceof HTMLTextAreaElement) {
			nativeTextAreaValueSetter.call(element, text)
		} else {
			nativeInputValueSetter.call(element, text)
		}

		const inputEvent = new Event('input', { bubbles: true })
		element.dispatchEvent(inputEvent)
	}

	await waitFor(0.1) // Wait to ensure input event processing completes

	// Don't blur immediately, so that subsequent press_keys (like Enter) can work on this element behavior
	// blurLastClickedElement() 
}

/**
 * @todo browser-use version is very complex and supports menu tags, need to follow up
 */
export async function selectOptionElement(selectElement: HTMLSelectElement, optionText: string) {
	if (!(selectElement instanceof HTMLSelectElement)) {
		throw new Error('Element is not a select element')
	}

	const options = Array.from(selectElement.options)
	const option = options.find((opt) => opt.textContent?.trim() === optionText.trim())

	if (!option) {
		throw new Error(`Option with text "${optionText}" not found in select element`)
	}

	selectElement.value = option.value
	selectElement.dispatchEvent(new Event('change', { bubbles: true }))

	await waitFor(0.1) // Wait to ensure change event processing completes
}

export async function scrollIntoViewIfNeeded(element: HTMLElement) {
	const el = element as any
	if (el.scrollIntoViewIfNeeded) {
		el.scrollIntoViewIfNeeded()
		// await waitFor(0.5) // Animation playback
	} else {
		// @todo visibility check
		el.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'nearest' })
		// await waitFor(0.5) // Animation playback
	}
}

export async function scrollVertically(
	down: boolean,
	scroll_amount: number,
	element?: HTMLElement | null
) {
	// Element-specific scrolling if element is provided
	if (element) {
		const targetElement = element
		console.log(
			'[SCROLL DEBUG] Starting direct container scroll for element:',
			targetElement.tagName
		)

		let currentElement = targetElement as HTMLElement | null
		let scrollSuccess = false
		let scrolledElement: HTMLElement | null = null
		let scrollDelta = 0
		let attempts = 0
		const dy = scroll_amount

		while (currentElement && attempts < 10) {
			const computedStyle = window.getComputedStyle(currentElement)
			const hasScrollableY = /(auto|scroll|overlay)/.test(computedStyle.overflowY)
			const canScrollVertically = currentElement.scrollHeight > currentElement.clientHeight

			console.log(
				'[SCROLL DEBUG] Checking element:',
				currentElement.tagName,
				'hasScrollableY:',
				hasScrollableY,
				'canScrollVertically:',
				canScrollVertically,
				'scrollHeight:',
				currentElement.scrollHeight,
				'clientHeight:',
				currentElement.clientHeight
			)

			if (hasScrollableY && canScrollVertically) {
				const beforeScroll = currentElement.scrollTop
				const maxScroll = currentElement.scrollHeight - currentElement.clientHeight

				let scrollAmount = dy / 3

				if (scrollAmount > 0) {
					scrollAmount = Math.min(scrollAmount, maxScroll - beforeScroll)
				} else {
					scrollAmount = Math.max(scrollAmount, -beforeScroll)
				}

				currentElement.scrollTop = beforeScroll + scrollAmount

				const afterScroll = currentElement.scrollTop
				const actualScrollDelta = afterScroll - beforeScroll

				console.log(
					'[SCROLL DEBUG] Scroll attempt:',
					currentElement.tagName,
					'before:',
					beforeScroll,
					'after:',
					afterScroll,
					'delta:',
					actualScrollDelta
				)

				if (Math.abs(actualScrollDelta) > 0.5) {
					scrollSuccess = true
					scrolledElement = currentElement
					scrollDelta = actualScrollDelta
					console.log(
						'[SCROLL DEBUG] Successfully scrolled container:',
						currentElement.tagName,
						'delta:',
						actualScrollDelta
					)
					break
				}
			}

			if (currentElement === document.body || currentElement === document.documentElement) {
				break
			}
			currentElement = currentElement.parentElement
			attempts++
		}

		if (scrollSuccess) {
			return `Scrolled container (${scrolledElement?.tagName}) by ${scrollDelta}px`
		} else {
			return `No scrollable container found for element (${targetElement.tagName})`
		}
	}

	// Page-level scrolling (default or fallback)

	const dy = scroll_amount
	const bigEnough = (el: HTMLElement) => el.clientHeight >= window.innerHeight * 0.5
	const canScroll = (el: HTMLElement | null) =>
		el &&
		/(auto|scroll|overlay)/.test(getComputedStyle(el).overflowY) &&
		el.scrollHeight > el.clientHeight &&
		bigEnough(el)

	let el: HTMLElement | null = document.activeElement as HTMLElement | null
	while (el && !canScroll(el) && el !== document.body) el = el.parentElement

	el = canScroll(el)
		? el
		: Array.from(document.querySelectorAll<HTMLElement>('*')).find(canScroll) ||
		(document.scrollingElement as HTMLElement) ||
		(document.documentElement as HTMLElement)

	if (el === document.scrollingElement || el === document.documentElement || el === document.body) {
		window.scrollBy(0, dy)
		return `✅ Scrolled page by ${dy}px.`
	} else {
		el!.scrollBy({ top: dy, behavior: 'smooth' })
		await waitFor(0.1) // Animation playback
		return `✅ Scrolled container (${el!.tagName}) by ${dy}px.`
	}
}

export async function scrollHorizontally(
	right: boolean,
	scroll_amount: number,
	element?: HTMLElement | null
) {
	// Element-specific scrolling if element is provided
	if (element) {
		const targetElement = element
		console.log(
			'[SCROLL DEBUG] Starting direct container scroll for element:',
			targetElement.tagName
		)

		let currentElement = targetElement as HTMLElement | null
		let scrollSuccess = false
		let scrolledElement: HTMLElement | null = null
		let scrollDelta = 0
		let attempts = 0
		const dx = right ? scroll_amount : -scroll_amount

		while (currentElement && attempts < 10) {
			const computedStyle = window.getComputedStyle(currentElement)
			const hasScrollableX = /(auto|scroll|overlay)/.test(computedStyle.overflowX)
			const canScrollHorizontally = currentElement.scrollWidth > currentElement.clientWidth

			console.log(
				'[SCROLL DEBUG] Checking element:',
				currentElement.tagName,
				'hasScrollableX:',
				hasScrollableX,
				'canScrollHorizontally:',
				canScrollHorizontally,
				'scrollWidth:',
				currentElement.scrollWidth,
				'clientWidth:',
				currentElement.clientWidth
			)

			if (hasScrollableX && canScrollHorizontally) {
				const beforeScroll = currentElement.scrollLeft
				const maxScroll = currentElement.scrollWidth - currentElement.clientWidth

				let scrollAmount = dx / 3

				if (scrollAmount > 0) {
					scrollAmount = Math.min(scrollAmount, maxScroll - beforeScroll)
				} else {
					scrollAmount = Math.max(scrollAmount, -beforeScroll)
				}

				currentElement.scrollLeft = beforeScroll + scrollAmount

				const afterScroll = currentElement.scrollLeft
				const actualScrollDelta = afterScroll - beforeScroll

				console.log(
					'[SCROLL DEBUG] Scroll attempt:',
					currentElement.tagName,
					'before:',
					beforeScroll,
					'after:',
					afterScroll,
					'delta:',
					actualScrollDelta
				)

				if (Math.abs(actualScrollDelta) > 0.5) {
					scrollSuccess = true
					scrolledElement = currentElement
					scrollDelta = actualScrollDelta
					console.log(
						'[SCROLL DEBUG] Successfully scrolled container:',
						currentElement.tagName,
						'delta:',
						actualScrollDelta
					)
					break
				}
			}

			if (currentElement === document.body || currentElement === document.documentElement) {
				break
			}
			currentElement = currentElement.parentElement
			attempts++
		}

		if (scrollSuccess) {
			return `Scrolled container (${scrolledElement?.tagName}) horizontally by ${scrollDelta}px`
		} else {
			return `No horizontally scrollable container found for element (${targetElement.tagName})`
		}
	}

	// Page-level scrolling (default or fallback)

	const dx = right ? scroll_amount : -scroll_amount
	const bigEnough = (el: HTMLElement) => el.clientWidth >= window.innerWidth * 0.5
	const canScroll = (el: HTMLElement | null) =>
		el &&
		/(auto|scroll|overlay)/.test(getComputedStyle(el).overflowX) &&
		el.scrollWidth > el.clientWidth &&
		bigEnough(el)

	let el: HTMLElement | null = document.activeElement as HTMLElement | null
	while (el && !canScroll(el) && el !== document.body) el = el.parentElement

	el = canScroll(el)
		? el
		: Array.from(document.querySelectorAll<HTMLElement>('*')).find(canScroll) ||
		(document.scrollingElement as HTMLElement) ||
		(document.documentElement as HTMLElement)

	if (el === document.scrollingElement || el === document.documentElement || el === document.body) {
		window.scrollBy(dx, 0)
		return `✅ Scrolled page horizontally by ${dx}px`
	} else {
		el!.scrollBy({ left: dx, behavior: 'smooth' })
		await waitFor(0.1) // Animation playback
		return `✅ Scrolled container (${el!.tagName}) horizontally by ${dx}px`
	}
}

export async function pressKeys(keys: string[], mode: 'simulated' | 'debugger' = 'simulated') {
	const results: string[] = []

	for (const key of keys) {
		if (mode === 'debugger') {
			await new Promise((resolve) => {
				chrome.runtime.sendMessage({
					type: 'DEBUGGER_PRESS_KEY',
					payload: { key },
					timestamp: Date.now()
				}, (response) => resolve(response))
			})
			results.push(key)
		} else {
			// Simulated mode fallback (mostly for testing, less reliable for specialized keys like Enter on forms)
			// We can try to use active element
			const activeElement = document.activeElement as HTMLElement
			if (activeElement) {
				await createSyntheticInputEvent(activeElement, key)
				results.push(key)
			}
		}
		await waitFor(0.1)
	}

	return `✅ Pressed keys: ${results.join(', ')}`
}
