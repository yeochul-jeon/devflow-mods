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
      /**
       * The band's rows the card it holds takes (border and caption included), 0 while it holds none:
       * team-board draws in what the card leaves. Written when a card opens, moves or closes, and every
       * half second while one is open; the band draws its card only within these rows.
       */
      cardRows: number
    }
    /** Read only, to count the band's rows the other mods take: the fields read. Absent when the mod is not installed. */
    'next-steps': { steps: { items: string[] } | null }
    'prompt-coach': { band: { hasDraft: boolean }; flow: { stage: string } }
    'team-board': { me: { state: string; question: string } | null; bandOff: boolean }
  }
}
