/** A pasted image as the mod read it: its file, format, size and pixel shape, or why it has no preview. */
export type Picture =
  | { file: string; format: string; bytes: number; width: number; height: number; png?: string }
  | { error: string }

/**
 * The card on show: its image; the pointer target that showed it (`<site>/<chip key>`); the
 * transcript row it floats on, by `requestId` (null: the band holds it, or a window); how many rows
 * it may take; and whether it stands on that row's last row on screen, ends just above its first,
 * or is a window of its own, outside the terminal.
 */
export type Shown = { id: number; target: string; host: string | null; rows: number; edge: 'last' | 'first' | 'window' }

declare module 'claude-code' {
  interface PluginState {
    'image-preview': {
      /** The `[Image #N]` ids in the prompt box, in the order typed. */
      draft: number[]
      /** Each image read so far, by id. */
      pictures: Record<string, Picture>
      /** The card the pointer has open, and where it floats; null while none is. */
      shown: Shown | null
      /** Whether a transcript row, by its `requestId`, holds the card: so only the rows it leaves and joins draw again. */
      hosting: StateFamily<boolean>
    }
  }
}
