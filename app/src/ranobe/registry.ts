import type { Source } from './sources'
import { ranobehub } from './ranobehub'
import { bakatsuki } from './bakatsuki'

/** every online source, Russian first; a new one is an adapter added here */
export const SOURCES: Source[] = [ranobehub, bakatsuki]
export const sourceById = (id: string) => SOURCES.find((s) => s.id === id)
