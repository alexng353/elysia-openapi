interface Private {
	id: number
}
export type Payload = { value: Private }
declare function getValue(): number
enum Dynamic {
	A = 'a',
	B = getValue()
}
export type DynamicPayload = { value: Dynamic }
