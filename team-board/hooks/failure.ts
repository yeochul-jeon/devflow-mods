// 숨은 실패: Bash 가 exit 0 으로 끝났는데 출력에는 실패가 보이는 경우.
// 일반 규칙과 실패 코드 가림 규칙은 Reasonofmoon/reasonofmoon-mods 의 silent-failure 를 바탕으로 고쳐 썼다.
//   Copyright (c) 2026 Reason of Moon, MIT License: https://github.com/Reasonofmoon/reasonofmoon-mods/blob/main/LICENSE
// 여기서 더한 것: Gradle·Maven·JUnit·Spring·Kotlin 규칙, 읽기 전용 명령 제외, 팀 보드 표시, 같은 명령 재실행 시 해제.

import type { FailAlert } from '../types'

export type Severity = 'high' | 'warn'
type Rule = { label: string; pattern: RegExp; severity: Severity }

/** 명령에 skipTests·skipITs·maven.test.skip 이 있으면 일부러 건너뛴 것이라 보지 않는다 (judge). */
const MAVEN_SKIP = 'Maven 테스트 건너뜀'

/** 숫자는 1 이상만 ([1-9]\d*): "0 failed" 같은 통과 요약은 걸리지 않는다. 앞에 = : 가 붙은 숫자(`ok=1 skipped=0`)는 앞 항목의 값이라 세지 않는다. */
const RULES: Rule[] = [
  // JVM 빌드·테스트
  { label: '실패한 테스트', pattern: /\b\d+ tests? completed, [1-9]\d* failed\b/, severity: 'high' },
  { label: '실패한 테스트', pattern: /Tests run: \d+, Failures: [1-9]\d*|Tests run: \d+, Failures: \d+, Errors: [1-9]\d*/, severity: 'high' },
  { label: 'Maven 빌드 실패', pattern: /^\[INFO\] BUILD FAILURE\b|^\[ERROR\] (?:Failed to execute goal|Tests run:|Errors?:|Failures?:)/m, severity: 'high' },
  { label: 'JUnit 실패', pattern: /^\s*\S+ > .+ FAILED\s*$|\[\s*[1-9]\d* tests failed\s*\]/m, severity: 'high' },
  { label: 'Gradle 빌드 실패', pattern: /^\s*BUILD FAILED\b/m, severity: 'high' },
  { label: 'Gradle 작업 실패', pattern: /^> Task \S+ FAILED\s*$/m, severity: 'high' },
  { label: '컴파일 오류', pattern: /^e: (?:file:\/\/)?\S+\.kts?[:(]|^\S+\.java:\d+: error:|Compilation failed|compileKotlin FAILED|compileJava FAILED/m, severity: 'high' },
  { label: 'Spring 기동 실패', pattern: /APPLICATION FAILED TO START|Application run failed/, severity: 'high' },
  { label: '예외 발생', pattern: /^Exception in thread "|^Caused by: [\w.$]+(?:Exception|Error)\b/m, severity: 'high' },
  // 일반
  { label: '실패한 테스트', pattern: /(?<![=:])\b[1-9]\d*\s+(?:tests?\s+|specs?\s+|suites?\s+)?(?:failed|failing|failures?)\b/i, severity: 'high' },
  { label: '실패한 테스트', pattern: /^\s*[1-9]\d* fail\s*$/m, severity: 'high' }, // bun: " 2 fail"
  { label: 'FAIL 표시', pattern: /^\s*(?:FAIL|FAILED)\b/m, severity: 'high' },
  { label: 'npm 오류', pattern: /^\s*npm (?:ERR!|error)\s/m, severity: 'high' },
  { label: 'Python 예외', pattern: /Traceback \(most recent call last\):?[ \t]*\n\s+File "/, severity: 'high' }, // print 로 찍은 한 줄은 뺀다
  { label: '오류 줄', pattern: /^\s*(?:Error|TypeError|ReferenceError|SyntaxError|ModuleNotFoundError|ImportError|AssertionError)\b[:\s]/m, severity: 'high' },
  { label: '명령·파일 없음', pattern: /\bcommand not found\b|\bNo such file or directory\b|\bPermission denied\b/i, severity: 'high' },
  { label: '비정상 종료', pattern: /\bsegmentation fault\b|\bcore dumped\b|\bpanicked at\b|\bOutOfMemoryError\b/i, severity: 'high' },
  // 확인 필요: 검사했다고 하기엔 부족한 실행
  { label: '건너뛴 테스트', pattern: /(?<![=:])\b[1-9]\d*\s+(?:tests?\s+)?(?:skipped|pending|ignored)\b|Skipped: [1-9]\d*/i, severity: 'warn' },
  { label: '실행된 테스트 없음', pattern: /No tests found for given includes|\bno tests? (?:found|ran|were found|to run|collected)\b|\bRan 0 tests\b|Tests run: 0,/i, severity: 'warn' },
  { label: MAVEN_SKIP, pattern: /\bTests are skipped\b/, severity: 'warn' },
]

/** 실패 코드를 가리는 셸 구문. */
const MASKS: { label: string; pattern: RegExp }[] = [
  { label: '`|| true` 가 실패 코드를 삼킴', pattern: /\|\|\s*(?:true|:)(?:\s|$|;)/ },
  { label: '`; true` / `exit 0` 이 실패 코드를 덮음', pattern: /;\s*(?:true|exit\s+0)\s*$/ },
  { label: '파이프는 마지막 명령의 코드만 돌려줌', pattern: /\|\s*(?:tail|head|tee|grep|less|cat|sed|awk|sort|uniq|wc)\b/ },
]

/** 로그나 코드를 보여 주기만 하는 명령: 출력에 FAILED 가 있어도 실패가 아니다. */
const READ_ONLY = /^(?:cat|less|more|head|tail|grep|rg|ag|egrep|find|ls|wc|bat|jq|diff|sed -n|awk|echo|printf|sort|uniq|cut|tr|column|nl)\b|^xargs\s+(?:-\S+\s+)*(?:grep|rg|egrep|cat|head|tail|wc)\b|^git (?:log|diff|show|blame|grep|status|rev-parse|ls-files|ls-tree|rev-list|describe|cat-file|show-ref)\b|^pwd\b|^gh (?:run|pr) view\b|^docker (?:compose )?logs\b|^kubectl logs\b/

/** 읽기 도구가 파일이 없다고 알린 줄: 존재 확인의 답이지 실패가 아니다. 빌드·실행 도구가 낸 없음은 남긴다. */
const READ_MISSING = /^(?:(?:ls|stat|cat|head|tail|grep|rg|wc|du|file|find|readlink|realpath|diff|bat|eza|jq|sed|awk): .*No such file or directory.*|"[^"\n]*": No such file or directory \(os error 2\))$/gm

/** team-board 상태 파일을 읽는 명령: 지난 실패 기록을 다시 출력할 뿐이다. */
const OWN_STATE = /\.claude\/team-board\//

// 비밀 값: 이름에 token·secret·password 등이 든 변수·옵션의 값, 인증 헤더, URL 의 비밀번호, 알려진 토큰 꼴
const SECRET_NAME = String.raw`[\w-]*(?:token|secret|passw(?:or)?d|pwd|api[_-]?key|auth(?!or)|credential)[\w-]*`
const SECRET_VALUE = String.raw`(?:"[^"]*"|'[^']*'|[^\s'"]+)`
const SECRETS: [RegExp, string][] = [
  [/\b(?:sk-[\w-]{16,}|gh[pousr]_[A-Za-z0-9]{16,}|github_pat_\w{20,}|xox[abpr]-[\w-]{10,}|AKIA[0-9A-Z]{16}|eyJ[\w-]+\.eyJ[\w-]+\.[\w-]+)/g, '***'],
  [new RegExp(String.raw`(${SECRET_NAME}=)${SECRET_VALUE}`, 'gi'), '$1***'],
  [new RegExp(String.raw`(--?${SECRET_NAME}\s+)(?!-)${SECRET_VALUE}`, 'gi'), '$1***'],
  [/(Authorization:\s*(?:Bearer|Basic|Token)\s+)[^\s'"]+/gi, '$1***'],
  [/(\/\/[^\s:/@]+:)[^\s@/]+(@)/g, '$1***$2'],
]

/** 상태 파일에 남기기 전에 비밀 값을 *** 로 가린다. */
export function redact(text: string): string {
  return SECRETS.reduce((t, [re, to]) => t.replace(re, to), text)
}

const MAX_SCAN = 200_000
const MAX_LINE = 120

/** 셸 명령의 단계들 (&&, ||, ;, |, |&, 줄바꿈으로 나눔). cd 단계, 주석 줄, 따로 선 true·:, 변수 대입은 뺀다 ($( ) · ` ` 로 명령을 돌리는 대입은 남김). */
function steps(command: string): string[] {
  // 따옴표 안의 | ; 는 구분자가 아니다: 같은 길이로 가린 사본에서 자를 자리를 찾고 원문을 자른다
  // 주석 줄은 가리기 전에 지운다: 주석 안의 ' 가 뒤의 따옴표와 짝지어지지 않게
  const src = command.replace(/^[ \t]*#.*$/gm, '')
  const masked = src.replace(/'[^']*'|"[^"]*"/g, m => '_'.repeat(m.length))
  const parts: string[] = []
  let from = 0
  for (const m of masked.matchAll(/&&|\|\||\|&|;|\n|\|/g)) {
    parts.push(src.slice(from, m.index))
    from = m.index + m[0].length
  }
  parts.push(src.slice(from))
  return parts
    .map(s => s.trim().replace(/^(?:[A-Za-z_]\w*=(?!\S*(?:\$\(|`))\S*(?:\s+|$))+/, ''))
    .filter(s => s && !/^cd\s/.test(s) && !/^(?:true|:)$/.test(s))
}

/** 모든 단계가 읽기 전용일 때만 true. `echo x && ./gradlew test` 는 판정한다. */
export function isReadOnly(command: string): boolean {
  return steps(command).every(s => READ_ONLY.test(s))
}

/**
 * 같은 명령을 다시 돌렸는지 비교할 키: 읽기 전용이 아닌 첫 단계의 앞 두 낱말. `./gradlew test --tests X` → `./gradlew test`
 * 둘째 낱말이 run·-m·exec 이면 세 낱말: `npm run lint` → `npm run lint`.
 * 모두 읽기 전용이면 '' 를 돌려준다. 저장된 키는 판정한 명령에서만 나와 비지 않으므로, 읽기 전용 명령은 어떤 저장된 키와도 같지 않다.
 */
export function commandKey(command: string): string {
  const all = steps(command)
  const words = (all.find(s => !READ_ONLY.test(s)) ?? '').split(/\s+/)
  return redact(words.slice(0, ['run', '-m', 'exec'].includes(words[1] ?? '') ? 3 : 2).join(' '))
}

function lineAround(text: string, index: number): string {
  const start = text.lastIndexOf('\n', index) + 1
  const end = text.indexOf('\n', index)
  const line = text.slice(start, end === -1 ? undefined : end).trim()
  return line.length > MAX_LINE ? line.slice(0, MAX_LINE - 1) + '…' : line
}

export type Finding = { label: string; severity: Severity; line: string }

/** 출력에서 실패 흔적을 찾는다. 같은 이름의 규칙은 한 번만. */
export function scanOutput(text: string): Finding[] {
  const body = text.length > MAX_SCAN ? text.slice(-MAX_SCAN) : text
  const out: Finding[] = []
  for (const rule of RULES) {
    if (out.some(f => f.label === rule.label)) continue
    const m = rule.pattern.exec(body)
    if (m) out.push({ label: rule.label, severity: rule.severity, line: lineAround(body, m.index) })
  }
  return out.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'high' ? -1 : 1))
}

export function masksIn(command: string): string[] {
  return MASKS.filter(m => m.pattern.test(command)).map(m => m.label)
}

/** exit 0 으로 끝난 Bash 한 번을 판정한다. 의심할 게 없으면 null. */
export function judge(command: string, output: string, at: number): FailAlert | null {
  if (!output.trim() || isReadOnly(command) || OWN_STATE.test(command)) return null
  const findings = scanOutput(output.replace(READ_MISSING, '')).filter(f => f.label !== MAVEN_SKIP || !/skipTests|skipITs|maven\.test\.skip/.test(command))
  if (!findings.length) return null
  return {
    at,
    command: redact(command.replace(/\s+/g, ' ').trim()).slice(0, 200),
    key: commandKey(command),
    level: findings.some(f => f.severity === 'high') ? 'high' : 'warn',
    signs: findings.slice(0, 4).map(f => redact(`${f.label}: ${f.line}`)),
    masks: masksIn(command),
  }
}

/** Claude 에게 붙이는 메모. 확인 필요(warn)만 있으면 붙이지 않는다. */
export function noteForClaude(alert: FailAlert): string | null {
  if (alert.level !== 'high') return null
  return [
    'team-board: 이 Bash 명령은 exit 0 으로 끝났지만 출력에 실패 흔적이 있습니다.',
    ...alert.signs.map(s => `- ${s}`),
    ...(alert.masks.length ? [`실패 코드가 가려졌을 수 있습니다: ${alert.masks.join(', ')}. 파이프 없이 다시 실행하거나 set -o pipefail 을 쓰세요.`] : []),
    '이 단계를 성공으로 보고하기 전에 확인하거나, 문제가 아닌 이유를 말해 주세요.',
  ].join('\n')
}

/** /board fail 이 보여 주는 보고서. */
/** 흔적 한 줄에서 규칙 이름을 뗀 원문 (좁은 칸용). */
export function signLine(sign: string): string {
  const i = sign.indexOf(': ')
  return i < 0 ? sign : sign.slice(i + 2)
}

export function formatAlert(name: string, alert: FailAlert): string {
  return [
    `⚠ ${name}: 숨은 ${alert.level === 'high' ? '실패' : '확인 필요'}`,
    `명령  ${alert.command}`,
    '종료  exit 0 (도구는 오류로 보지 않음)',
    '흔적',
    ...alert.signs.map(s => `  • ${s}`),
    ...(alert.masks.length ? ['가림', ...alert.masks.map(m => `  • ${m}`)] : []),
  ].join('\n')
}
