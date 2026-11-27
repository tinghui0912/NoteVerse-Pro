export type BrowserPolicy =
  | 'auth'
  | 'default'
  | 'library'
  | 'upload'
  | 'score'
  | 'review'
  | 'media'
  | 'score-video'
  | 'preview'
  | 'practice';

export function browserPolicy(pathname: string): BrowserPolicy {
  const path = pathname.replace(/^\/(?:en|zh)(?=\/|$)/, '') || '/';
  if (/^\/auth(?:\/|$)/.test(path)) return 'auth';
  if (/^\/score\/[^/]+\/practice(?:\/|$)/.test(path)) return 'practice';
  if (/^\/score\/[^/]+(?:\/|$)/.test(path)) return 'score';
  if (/^\/imports\/[^/]+\/review(?:\/|$)/.test(path)) return 'review';
  if (/^\/my-performances\/[^/]+\/score-video(?:\/|$)/.test(path)) return 'score-video';
  if (/^\/my-performances(?:\/|$)/.test(path)) return 'media';
  if (/^\/preview\/[^/]+(?:\/|$)/.test(path)) return 'preview';
  if (/^\/upload(?:\/|$)/.test(path)) return 'upload';
  if (/^\/library(?:\/|$)/.test(path)) return 'library';
  return 'default';
}

export function requiresDocumentNavigation(current: BrowserPolicy, pathname: string): boolean {
  return browserPolicy(pathname) !== current;
}
