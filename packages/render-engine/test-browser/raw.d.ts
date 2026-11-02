/** Vite's `?raw` imports: a file's text (the browser tests read the WASM encoder's worker script this way). */
declare module '*?raw' {
  const text: string;
  export default text;
}
