import { statuses } from './value-data'
export enum Code {
	Ready = 4,
	Next
}
export type Payload = { status: (typeof statuses)[number]; code: Code }
