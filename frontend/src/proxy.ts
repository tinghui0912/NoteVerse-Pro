import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';

export default createMiddleware(routing);

export const config = {
  // 匹配所有路径，排除 API 路由、静态文件、Next.js 内部路径
  matcher: ['/((?!api|trpc|_next|_vercel|.*\\..*).*)', '/'],
};
