import { formatUtc } from '../../lib/format'

/** An ISO time as the date and time in UTC that every screen of the app uses. */
export const utcOf = (iso: string): string => formatUtc(Math.floor(new Date(iso).getTime() / 1000))
