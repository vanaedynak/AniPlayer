// the hyphen package ships no types: the two languages the book pages use
type Hyphenate = (text: string, options?: { minWordLength?: number; hyphenChar?: string }) => Promise<string>
declare module 'hyphen/ru' {
  export const hyphenate: Hyphenate
}
declare module 'hyphen/en-us' {
  export const hyphenate: Hyphenate
}
