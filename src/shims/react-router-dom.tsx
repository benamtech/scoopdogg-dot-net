/**
 * react-router-dom shim.
 *
 * Astro does real navigation, so there is no client-side router. Rather than edit
 * twenty components to swap <Link to> for <a href>, `react-router-dom` is aliased to
 * this file in astro.config.mjs and every component keeps working unchanged.
 *
 * This is deliberately tiny. If something here needs to grow a real implementation,
 * that is a signal the component belongs in an Astro page, not that the shim needs
 * a router.
 */
import type { AnchorHTMLAttributes, ReactNode } from 'react';

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
  to: string;
  children?: ReactNode;
};

export function Link({ to, children, ...rest }: LinkProps) {
  return <a href={to} {...rest}>{children}</a>;
}

export function NavLink({ to, children, ...rest }: LinkProps) {
  return <a href={to} {...rest}>{children}</a>;
}

/** Full page navigation. Correct here: every route is a real document. */
export function useNavigate() {
  return (to: string | number) => {
    if (typeof window === 'undefined') return;
    if (typeof to === 'number') window.history.go(to);
    else window.location.assign(to);
  };
}

export function useLocation() {
  if (typeof window === 'undefined') {
    return { pathname: '/', search: '', hash: '', state: null, key: 'ssr' };
  }
  const { pathname, search, hash } = window.location;
  return { pathname, search, hash, state: null, key: 'browser' };
}

export function useSearchParams(): [URLSearchParams, (n: URLSearchParams) => void] {
  const params = new URLSearchParams(
    typeof window === 'undefined' ? '' : window.location.search,
  );
  const set = (next: URLSearchParams) => {
    if (typeof window !== 'undefined') {
      window.location.search = next.toString();
    }
  };
  return [params, set];
}

/**
 * Astro pages pass route values as props, so for the public site this stays empty on
 * purpose — a component reaching for params during a static render is a mistake worth
 * seeing.
 *
 * The admin detail screens are the exception: a lead id cannot be known at build time,
 * so those routes are one static page behind a rewrite and the id lives in the URL. Read
 * it from the path, in the browser only.
 */
export function useParams<T = Record<string, string>>(): T {
  if (typeof window === 'undefined') return {} as T;
  const parts = window.location.pathname.replace(/\/+$/, '').split('/').filter(Boolean);
  // /admin/leads/<id>  and  /admin/messages/<id>
  if (parts[0] === 'admin' && parts.length >= 3) {
    return { id: decodeURIComponent(parts[2]) } as T;
  }
  return {} as T;
}

export function Navigate({ to }: { to: string }) {
  if (typeof window !== 'undefined') window.location.replace(to);
  return null;
}
