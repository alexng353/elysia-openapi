import { z } from 'zod'

const Kind = z.enum(['chart', 'table'])
const Data = z.object({ title: z.string(), count: z.number().nullable() })
type Private = { nested: number }
const Nested = z.object({ metadata: z.custom<Private>() })
const permissionRank = { view: 0, edit: 1 } as const
declare const table: {
	$inferSelect: {
		id: string
		client_secret_hash: string
		name: string | null
	}
}

export type Widget = {
	kind: z.infer<typeof Kind>
	data: z.infer<typeof Data>
}
export type Permission = keyof typeof permissionRank
export type PublicClient = Omit<typeof table.$inferSelect, 'client_secret_hash'>
export type NestedWidget = z.infer<typeof Nested>
export type Preferences = {
	keybinds: Record<string, string>
	dataById: Record<string, z.infer<typeof Data>>
}
