// estree-walker's package.json "exports" map has no "types" condition, so
// TypeScript's NodeNext resolution can't find its shipped .d.ts even though
// one exists — this ambient shim covers the one function this codebase uses.
declare module 'estree-walker' {
  export function walk(
    ast: unknown,
    handlers: {
      enter?: (
        this: { skip: () => void; remove: () => void },
        node: any,
        parent: any,
        key: string,
        index: number,
      ) => void
      leave?: (
        this: { skip: () => void; remove: () => void },
        node: any,
        parent: any,
        key: string,
        index: number,
      ) => void
    },
  ): unknown
}
