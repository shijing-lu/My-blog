import type { APIRoute } from 'astro';
import { createHash } from 'node:crypto';
import { mobileError, mobileJson, requireMobileOwner } from '../../../../../lib/mobile-auth';
import { MobileAuthError } from '../../../../../lib/mobile-auth-core';
import { listArticleMeta, getArticleById, getArticleContents } from '../../../../../lib/articles';
import { articleCategoryMap, listArticleCategories } from '../../../../../lib/article-categories';
import { getLandingHero } from '../../../../../lib/landing';
import { getHeroQuoteSettings } from '../../../../../lib/quote-settings';
import { parsePasswordHash, verifyPassword } from '../../../../../lib/article-password';
import { countViews, countViewsByTargets, recordView } from '../../../../../lib/article-views';
import { countLikes, countLikesByTargets, hasLiked } from '../../../../../lib/likes';
import { likes } from '../../../../../../db/schema.sqlite';
import { getPrimaryDb } from '../../../../../../db';
import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
export const prerender = false;
const meta = (a: Awaited<ReturnType<typeof listArticleMeta>>[number], categoryId: string | null) => ({
  id: a.id, title: a.title, slug: a.slug, type: a.type, summary: a.summary ?? '', cover: a.cover,
  tags: a.tags, encrypted: a.encrypted, createdAt: +a.createdAt, updatedAt: +a.updatedAt, categoryId,
});
export const GET: APIRoute = async ({ request, params, url }) => {
  try {
    const owner = await requireMobileOwner(request);
    if(params.action==='display') {const [landing,quotes]=await Promise.all([getLandingHero(),getHeroQuoteSettings()]);return mobileJson({protocolVersion:1,serverId:owner.serverId,landing,quotes});}
    if(params.action==='search') {
      const query=(url.searchParams.get('q') ?? '').trim().slice(0,200).toLowerCase();
      const all=await listArticleMeta();const sources=await getArticleContents(all.filter(a=>!a.encrypted).map(a=>a.id));const map=await articleCategoryMap();
      const matching=all.filter(a=>(a.title+' '+a.summary+' '+a.tags.join(' ')+' '+(a.encrypted?'':sources.get(a.id) ?? '')).toLowerCase().includes(query));
      return mobileJson({protocolVersion:1,serverId:owner.serverId,articles:matching.map(a=>meta(a,map.get(a.id) ?? null))});
    }
    if (params.action !== 'catalog') throw new MobileAuthError(404, 'not_found', '阅读接口不存在');
    const [articles, categories, map] = await Promise.all([listArticleMeta(), listArticleCategories(), articleCategoryMap()]);
    const [views, likeCounts] = await Promise.all([countViewsByTargets(articles.map(a => a.id)), countLikesByTargets('article', articles.map(a => a.id))]);
    return mobileJson({ protocolVersion: 1, serverId: owner.serverId, articles: articles.map(a => ({ ...meta(a, map.get(a.id) ?? null), views: views[a.id] ?? 0, likes: likeCounts[a.id] ?? 0 })), categories });
  } catch (error) { return mobileError(error); }
};
export const POST: APIRoute = async ({ request, params }) => {
  try {
    const owner = await requireMobileOwner(request);
    const raw = await request.text();
    if (raw.length > 4096) throw new MobileAuthError(413, 'large_request', '请求过大');
    let body; try { body = JSON.parse(raw); } catch { throw new MobileAuthError(400, 'invalid_json', '请求格式错误'); }
    if (body.serverId !== owner.serverId || typeof body.id !== 'string' || body.id.length > 128) throw new MobileAuthError(400, 'invalid_request', '服务身份或文章ID无效');
    const article = await getArticleById(body.id);
    if (!article) throw new MobileAuthError(404, 'not_found', '文章不存在');
    const ownerIdent = `mobile-owner:${owner.serverId}`;
    if (params.action === 'view') { await recordView(article.id); return mobileJson({ views: await countViews(article.id), likes: await countLikes('article',article.id), liked: await hasLiked('article',article.id,'anonymous',ownerIdent) }); }
    if (params.action === 'like') {
      if (typeof body.liked !== 'boolean') throw new MobileAuthError(400,'invalid_request','点赞状态无效');
      if(body.liked) await getPrimaryDb().insert(likes).values({ id:randomUUID(),targetType:'article',targetId:article.id,userType:'anonymous',userIdent:ownerIdent,createdAt:new Date() }).onConflictDoNothing();
      else await getPrimaryDb().delete(likes).where(and(eq(likes.targetType,'article'),eq(likes.targetId,article.id),eq(likes.userType,'anonymous'),eq(likes.userIdent,ownerIdent)));
      return mobileJson({ views:await countViews(article.id),likes:await countLikes('article',article.id),liked:body.liked });
    }
    if (article.encrypted) {
      const hash = parsePasswordHash(article.encryptMeta);
      if (!hash || typeof body.password !== 'string' || !verifyPassword(body.password, hash)) {
        return mobileJson({ code: 'article_locked', error: '需要正确的文章访问密码', hint: article.encryptHint ?? '' }, 423);
      }
    }
    if (params.action !== 'detail') throw new MobileAuthError(404, 'not_found', '阅读接口不存在');
    const map = await articleCategoryMap();
    return mobileJson({ protocolVersion: 1, serverId: owner.serverId, article: meta(article, map.get(article.id) ?? null),
      source: article.content, sourceVersion: createHash('sha256').update(article.content).digest('hex'), views: await countViews(article.id), likes: await countLikes('article',article.id), liked: await hasLiked('article',article.id,'anonymous',ownerIdent) });
  } catch (error) { return mobileError(error); }
};
