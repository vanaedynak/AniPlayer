// Profiles, ratings and comments on Supabase. What may be read or written is decided by the database
// (supabase/schema.sql); errors it raises are already in Russian.
import { useEffect, useState } from 'react'
import { supabase, cloud, useSync } from './sync'

export interface Profile {
  id: string
  username: string
  display_name: string | null
  avatar_url: string | null
  banner_url: string | null
  bio: string | null
  accent: string | null
  favorites: number[]
  public: boolean
  role: 'user' | 'moderator' | 'admin'
  banned_until: string | null
  created_at: string
}

export interface Comment {
  id: number
  anime_id: number
  user_id: string
  parent_id: number | null
  body: string
  spoiler: boolean
  likes: number
  hidden: boolean
  created_at: string
  edited_at: string | null
  author?: Pick<Profile, 'username' | 'display_name' | 'avatar_url' | 'role'>
  liked?: boolean
}

const PROFILE_FIELDS = 'id,username,display_name,avatar_url,banner_url,bio,accent,favorites,public,role,banned_until,created_at'

function client() {
  const sb = supabase()
  if (!sb) throw new Error('Нет связи с сервером')
  return sb
}
function me() {
  const c = cloud()
  if (!c) throw new Error('Войдите в аккаунт, чтобы это сделать')
  return c
}
const check = <T,>({ data, error }: { data: T; error: { message: string } | null }) => {
  if (error) throw new Error(error.message)
  return data
}

// ---- profiles ----------------------------------------------------------------------------------

export async function getProfile(username: string): Promise<Profile | null> {
  return check(await client().from('profiles').select(PROFILE_FIELDS).eq('username', username.toLowerCase()).maybeSingle()) as Profile | null
}

export async function getProfileById(id: string): Promise<Profile | null> {
  return check(await client().from('profiles').select(PROFILE_FIELDS).eq('id', id).maybeSingle()) as Profile | null
}

export type ProfileEdit = Partial<Pick<Profile, 'display_name' | 'bio' | 'accent' | 'favorites' | 'public' | 'avatar_url' | 'banner_url'>>
export async function updateProfile(patch: ProfileEdit) {
  const { sb, uid } = me()
  check(await sb.from('profiles').update(patch).eq('id', uid))
  myProfileCache = null
  window.dispatchEvent(new Event('anyflow-profile'))
}

/** uploads a picture into the account's own folder; returns its public address */
export async function uploadPicture(file: File, kind: 'avatar' | 'banner') {
  const { sb, uid } = me()
  if (file.size > 2 * 1024 * 1024) throw new Error('Картинка больше 2 МБ')
  if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) throw new Error('Подойдут PNG, JPG, WebP или GIF')
  const path = `${uid}/${kind}-${Date.now()}.${file.type.split('/')[1]}`
  check(await sb.storage.from('avatars').upload(path, file, { contentType: file.type, upsert: true }))
  return sb.storage.from('avatars').getPublicUrl(path).data.publicUrl
}

export interface ProfileStats {
  seconds: number
  episodes: number
  completed: number
  watching: number
  comments: number
  ratings: number
}
export async function profileStats(id: string): Promise<ProfileStats | null> {
  return check(await client().rpc('profile_stats', { target: id })) as ProfileStats | null
}

let myProfileCache: Promise<Profile | null> | null = null
/** the signed-in user's own profile, refreshed when it is edited */
export function useMyProfile() {
  const user = useSync((s) => s.user)
  const [p, setP] = useState<Profile | null>(null)
  useEffect(() => {
    if (!user) return setP(null)
    const load = () => {
      myProfileCache ??= getProfileById(user.id).catch(() => null)
      void myProfileCache.then(setP)
    }
    load()
    const on = () => load()
    window.addEventListener('anyflow-profile', on)
    return () => window.removeEventListener('anyflow-profile', on)
  }, [user])
  return p
}

export const isStaff = (p: Profile | null) => p?.role === 'admin' || p?.role === 'moderator'
export const displayName = (p: Pick<Profile, 'username' | 'display_name'> | null | undefined) => p?.display_name || p?.username || 'Гость'

// ---- ratings -----------------------------------------------------------------------------------

export async function animeScore(animeId: number): Promise<{ average: number; votes: number } | null> {
  const row = check(await client().from('anime_scores').select('average,votes').eq('anime_id', animeId).maybeSingle()) as { average: number; votes: number } | null
  return row ? { average: Number(row.average), votes: row.votes } : null
}

export async function myScore(animeId: number): Promise<number | null> {
  const c = cloud()
  if (!c) return null
  const row = check(await c.sb.from('ratings').select('score').eq('anime_id', animeId).eq('user_id', c.uid).maybeSingle()) as { score: number } | null
  return row?.score ?? null
}

export async function rate(animeId: number, score: number | null) {
  const { sb, uid } = me()
  if (score == null) check(await sb.from('ratings').delete().eq('anime_id', animeId).eq('user_id', uid))
  else check(await sb.from('ratings').upsert({ anime_id: animeId, score, updated_at: new Date().toISOString() }))
}

// ---- comments ----------------------------------------------------------------------------------

export type CommentSort = 'new' | 'top'
const PAGE = 30

export async function listComments(animeId: number, sort: CommentSort, page = 0): Promise<{ items: Comment[]; more: boolean }> {
  const sb = client()
  // top-level comments page by page; their replies come along
  let q = sb.from('comments').select('*').eq('anime_id', animeId).is('parent_id', null)
  q = sort === 'top' ? q.order('likes', { ascending: false }).order('created_at', { ascending: false }) : q.order('created_at', { ascending: false })
  const top = check(await q.range(page * PAGE, page * PAGE + PAGE - 1)) as Comment[]
  const replies = top.length ? (check(await sb.from('comments').select('*').in('parent_id', top.map((c) => c.id)).order('created_at')) as Comment[]) : []
  const all = [...top, ...replies]
  await attach(all)
  return { items: all, more: top.length === PAGE }
}

/** authors and the viewer's own likes, in two requests for the whole page */
async function attach(list: Comment[]) {
  if (!list.length) return
  const sb = client()
  const ids = [...new Set(list.map((c) => c.user_id))]
  const people = check(await sb.from('profiles').select('id,username,display_name,avatar_url,role').in('id', ids)) as (Profile & { id: string })[]
  const byId = new Map(people.map((p) => [p.id, p]))
  const c = cloud()
  const liked = c ? new Set((check(await c.sb.from('comment_likes').select('comment_id').in('comment_id', list.map((x) => x.id))) as { comment_id: number }[]).map((l) => l.comment_id)) : new Set<number>()
  for (const x of list) {
    x.author = byId.get(x.user_id)
    x.liked = liked.has(x.id)
  }
}

export async function postComment(animeId: number, body: string, spoiler: boolean, parentId: number | null): Promise<Comment> {
  const { sb } = me()
  const row = check(await sb.from('comments').insert({ anime_id: animeId, body: body.trim(), spoiler, parent_id: parentId }).select('*').single()) as Comment
  await attach([row])
  return row
}

export async function editComment(id: number, body: string, spoiler: boolean) {
  check(await me().sb.from('comments').update({ body: body.trim(), spoiler }).eq('id', id))
}

export async function deleteComment(id: number) {
  check(await me().sb.from('comments').delete().eq('id', id))
}

export async function toggleLike(c: Comment) {
  const { sb, uid } = me()
  if (c.liked) check(await sb.from('comment_likes').delete().eq('comment_id', c.id).eq('user_id', uid))
  else check(await sb.from('comment_likes').insert({ comment_id: c.id }))
}

export async function reportComment(id: number, reason: string) {
  const { error } = await me().sb.from('reports').insert({ comment_id: id, reason: reason.slice(0, 300) })
  // reporting twice is not an error for the user
  if (error && !/duplicate/i.test(error.message)) throw new Error(error.message)
}

export async function userComments(userId: string, limit = 20): Promise<Comment[]> {
  return check(await client().from('comments').select('*').eq('user_id', userId).is('parent_id', null).order('created_at', { ascending: false }).limit(limit)) as Comment[]
}

// ---- moderation --------------------------------------------------------------------------------

export async function setHidden(id: number, hidden: boolean) {
  check(await me().sb.from('comments').update({ hidden }).eq('id', id))
}

export async function banUser(id: string, days: number) {
  check(await me().sb.rpc('ban_user', { target: id, days }))
}

export interface Report {
  id: number
  comment_id: number
  reason: string
  created_at: string
  comment?: Comment
}
export async function listReports(): Promise<Report[]> {
  const sb = me().sb
  const reports = check(await sb.from('reports').select('id,comment_id,reason,created_at').order('created_at', { ascending: false }).limit(100)) as Report[]
  const comments = reports.length ? (check(await sb.from('comments').select('*').in('id', [...new Set(reports.map((r) => r.comment_id))])) as Comment[]) : []
  await attach(comments)
  const byId = new Map(comments.map((c) => [c.id, c]))
  return reports.map((r) => ({ ...r, comment: byId.get(r.comment_id) }))
}

export async function clearReports(commentId: number) {
  check(await me().sb.from('reports').delete().eq('comment_id', commentId))
}
