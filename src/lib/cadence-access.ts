import type { AstroCookies } from "astro";
import { getAdminIdentity } from "./admin-auth";
/** isTopAdmin 也允许被授权的顶级管理员；私人日程只属于 kind=top 的站主。 */
export async function isCadenceOwner(cookies: AstroCookies): Promise<boolean> {
  return (await getAdminIdentity(cookies)).kind === "top";
}
