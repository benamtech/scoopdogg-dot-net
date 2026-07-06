import { useEffect } from 'react';
import { SITE_URL, DEFAULT_OG_IMAGE } from './constants';

interface SEOProps {
  title: string;
  description: string;
  canonicalPath: string;
  ogImage?: string;
  jsonLd?: object | object[];
}

function setMetaTag(attr: string, key: string, content: string) {
  let el = document.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.content = content;
}

function applyTags({ title, description, canonicalPath, ogImage, jsonLd }: SEOProps) {
  document.title = title;

  const canonicalUrl = `${SITE_URL}${canonicalPath}`;
  const image = ogImage || DEFAULT_OG_IMAGE;

  setMetaTag('name', 'description', description);

  let canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!canonical) {
    canonical = document.createElement('link');
    canonical.rel = 'canonical';
    document.head.appendChild(canonical);
  }
  canonical.href = canonicalUrl;

  setMetaTag('property', 'og:title', title);
  setMetaTag('property', 'og:description', description);
  setMetaTag('property', 'og:url', canonicalUrl);
  setMetaTag('property', 'og:image', image);

  setMetaTag('name', 'twitter:title', title);
  setMetaTag('name', 'twitter:description', description);
  setMetaTag('name', 'twitter:image', image);

  const schemaId = 'page-schema';
  let schemaEl = document.getElementById(schemaId) as HTMLScriptElement | null;
  if (jsonLd) {
    const payload = Array.isArray(jsonLd) ? jsonLd : [jsonLd];
    if (!schemaEl) {
      schemaEl = document.createElement('script');
      schemaEl.id = schemaId;
      schemaEl.type = 'application/ld+json';
      document.head.appendChild(schemaEl);
    }
    schemaEl.textContent = JSON.stringify(payload.length === 1 ? payload[0] : payload);
  }
}

export function useSEO(props: SEOProps) {
  // Run synchronously on every render so react-snap captures it during prerender
  applyTags(props);

  useEffect(() => {
    applyTags(props);
    return () => {
      document.getElementById('page-schema')?.remove();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.title, props.description, props.canonicalPath, props.ogImage, props.jsonLd]);
}
