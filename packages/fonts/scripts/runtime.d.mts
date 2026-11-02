/** Types for runtime.mjs (a plain ESM build script), so the unit tests can call it. */
export declare function deriveRuntime(library: readonly unknown[]): unknown;
export declare function writeRuntime(): Promise<void>;
