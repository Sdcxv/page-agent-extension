/// <reference types="vite/client" />

// Chrome extension types
declare namespace chrome {
    export const runtime: any
    export const storage: any
    export const tabs: any
    export const action: any
    export const commands: any
}

// Raw file imports
declare module '*.md?raw' {
    const content: string
    export default content
}

declare module '*.css?inline' {
    const content: string
    export default content
}

// CSS modules
declare module '*.module.css' {
    const classes: { readonly [key: string]: string }
    export default classes
}
