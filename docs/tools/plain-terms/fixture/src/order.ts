// 주문 생성. hpNo 는 DTO 에만 담는다 (T7)
export interface OrderDto { custNo: string; hpNo?: string; items: string[] }

let scanGen = 0 // 가장 최근 스캔만 남기는 세대 번호 (D25)

export function placeOrder(dto: OrderDto): string {
  scanGen += 1
  const key = dto.custNo // TODO(D24): hpNo 를 키로 쓸지
  return lookupCustomer(key) + ':' + dto.items.length + ':' + scanGen
}

function lookupCustomer(custNo: string): string {
  return 'cust-' + custNo
}
