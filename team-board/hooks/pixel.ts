// 픽셀 그림: 한 칸에 2×2 픽셀을 담는 블록 문자(▘▝▀▖▌▞▛▗▚▐▜▄▙▟█)로 Raster 셀을 만든다.

const QUADRANT = [' ', '▘', '▝', '▀', '▖', '▌', '▞', '▛', '▗', '▚', '▐', '▜', '▄', '▙', '▟', '█']

export type RasterCells = { columns: number; rows: number; cells: string }

function base64(bytes: Uint8Array): string {
  const native = bytes as Uint8Array & { toBase64?: () => string }
  if (native.toBase64) return native.toBase64()
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

/** '#' 가 켜진 픽셀인 그림(행 문자열 배열)을 Raster 셀로. 폭·높이는 짝수 픽셀. */
export function sprite(art: readonly string[], on: number, off: number): RasterCells {
  const height = art.length
  const width = Math.max(...art.map(r => r.length))
  const columns = Math.ceil(width / 2)
  const rows = Math.ceil(height / 2)
  const lit = (x: number, y: number) => art[y]?.[x] === '#'
  const words: number[] = []
  for (let y = 0; y < rows * 2; y += 2) {
    for (let x = 0; x < columns * 2; x += 2) {
      const mask = (lit(x, y) ? 1 : 0) | (lit(x + 1, y) ? 2 : 0) | (lit(x, y + 1) ? 4 : 0) | (lit(x + 1, y + 1) ? 8 : 0)
      words.push(QUADRANT[mask]!.codePointAt(0)!, on, off)
    }
  }
  return { columns, rows, cells: base64(new Uint8Array(Uint32Array.from(words).buffer)) }
}

/** 12×6 픽셀 = 6×3 칸 상태 아이콘. 모양이 상태를 말한다. */
export const ICONS = {
  // 결정 필요: 느낌표
  asking: ['.....##.....', '.....##.....', '.....##.....', '.....##.....', '............', '.....##.....'],
  // 작업 중: 앞으로 가는 화살표
  working: ['......##....', '......####..', '############', '############', '......####..', '......##....'],
  // 대기 (턴 끝, 입력 기다림): 체크
  idle: ['..........##', '.........##.', '##......##..', '.##....##...', '..##..##....', '...####.....'],
  // 소식 없음: 물결 (졸음)
  stale: ['............', '.##....##...', '#..#..#..#..', '....##....##', '............', '............'],
} as const

export function hex(color: string): number {
  return parseInt(color.replace('#', ''), 16) & 0xffffff
}
