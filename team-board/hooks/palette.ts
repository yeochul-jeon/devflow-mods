// team-board 의 색과 그리기 조각. 색마다 맡은 일이 있다:
// ask = 나를 기다림, work = 일하는 중, ok = 끝남/고른 답, bad = 위험(컨텍스트 부족), dim = 지난 것.

export type PaletteName = 'night' | 'aurora' | 'theme'

export type Palette = {
  accent: string
  ask: string
  work: string
  ok: string
  bad: string
  dim: string
  text: string
  frame: string
  /** 배지 글자색 (배지 배경 위) */
  onBadge: string
  /** 카드 바탕. '' 면 칠하지 않음 */
  card: string
  /** 색이 #rrggbb 라서 픽셀 그림(Raster)에 쓸 수 있는지 */
  isRaw: boolean
}

const PALETTES: Record<PaletteName, Palette> = {
  // 어두운 터미널용: 차분한 남색 바탕에 잘 보이는 색
  night: {
    accent: '#a5b4fc',
    ask: '#fbbf24',
    work: '#38bdf8',
    ok: '#4ade80',
    bad: '#f87171',
    dim: '#7c8aa5',
    text: '#e2e8f0',
    frame: '#334155',
    onBadge: '#0b1220',
    // 트루컬러에선 짙은 남색, 256색 터미널에선 남색(17)으로 떨어지는 값
    card: '#0f1730',
    isRaw: true,
  },
  // 어두운 터미널용: 청록과 보라
  aurora: {
    accent: '#c084fc',
    ask: '#facc15',
    work: '#2dd4bf',
    ok: '#86efac',
    bad: '#fb7185',
    dim: '#94a3b8',
    text: '#f1f5f9',
    frame: '#475569',
    onBadge: '#111827',
    card: '#14111f',
    isRaw: true,
  },
  // Claude Code 테마 색을 따른다: 밝은 배경이면 이것
  theme: {
    accent: 'claude',
    ask: 'warning',
    work: 'suggestion',
    ok: 'success',
    bad: 'error',
    dim: 'subtle',
    text: 'text',
    frame: 'promptBorder',
    onBadge: 'background',
    card: '',
    isRaw: false,
  },
}

export function paletteOf(name: unknown): Palette {
  return name === 'aurora' || name === 'theme' ? PALETTES[name] : PALETTES.night
}

/** ▰▰▰▱▱ 막대: total 중 done 만큼 채운다. */
export function bar(done: number, total: number, cells: number): string {
  if (total <= 0 || cells <= 0) return ''
  const full = Math.max(0, Math.min(cells, Math.round((done / total) * cells)))
  return '▰'.repeat(full) + '▱'.repeat(cells - full)
}

/** 컨텍스트 사용률 색: 여유 / 주의 / 위험. */
export function contextTone(pct: number | null, pal: Palette): string {
  if (pct === null) return pal.dim
  return pct >= 80 ? pal.bad : pct >= 50 ? pal.ask : pal.ok
}
