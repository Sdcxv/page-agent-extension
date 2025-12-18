/**
 * Simple assertion function that throws an error if the condition is falsy
 * @param condition - The condition to assert
 * @param errorMessage - The error message to throw
 * @param silent - Whether to suppress console output
 * @throws Error if condition is falsy
 */
export function assert(condition: unknown, errorMessage: string, silent = false): asserts condition {
	if (!condition) {
		if (!silent) console.error(`❌ assert: ${errorMessage}`)
		throw new Error(errorMessage)
	}
}
