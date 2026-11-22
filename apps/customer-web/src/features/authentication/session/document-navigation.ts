import { getCurrentLoginHref } from '../return-url';

export function navigateToLogin() {
  window.location.assign(getCurrentLoginHref());
}
