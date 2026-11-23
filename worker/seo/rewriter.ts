import type { IBrandingConfig } from '../../src/core/types';

export function rewriteHtmlWithBranding(
  response: Response,
  branding: IBrandingConfig,
  pathname: string
): Response {
  const siteName = branding.site_name.trim() || 'Modulus';
  const domain = branding.domain.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '') || 'modulus.josefyang.com';
  const tagline = branding.tagline.trim() || 'Build the machine. Master the physics.';
  const description = branding.meta_description.trim();
  const isAdmin = pathname === '/admin' || pathname.startsWith('/admin/');
  const fullTitle = isAdmin ? `${siteName} — Mission Control` : `${siteName} — ${tagline}`;
  const canonicalUrl = isAdmin ? `https://${domain}/admin` : `https://${domain}/`;
  const ogImageUrl = `https://${domain}/assets/og-banner.png`;

  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'VideoGame',
    name: siteName,
    url: `https://${domain}`,
    description,
    genre: ['Racing Simulation', 'Vehicle Engineering'],
    playMode: 'SinglePlayer',
    applicationCategory: 'Game',
    operatingSystem: 'Web, iOS, Android, Windows, macOS',
  });

  return new HTMLRewriter()
    .on('title', {
      element(el) {
        el.setInnerContent(fullTitle);
      },
    })
    .on('meta[name="description"]', {
      element(el) {
        el.setAttribute('content', description);
      },
    })
    .on('meta[name="apple-mobile-web-app-title"]', {
      element(el) {
        el.setAttribute('content', siteName);
      },
    })
    .on('meta[property="og:site_name"]', {
      element(el) {
        el.setAttribute('content', siteName);
      },
    })
    .on('meta[property="og:title"]', {
      element(el) {
        el.setAttribute('content', fullTitle);
      },
    })
    .on('meta[property="og:description"]', {
      element(el) {
        el.setAttribute('content', description);
      },
    })
    .on('meta[property="og:url"]', {
      element(el) {
        el.setAttribute('content', canonicalUrl);
      },
    })
    .on('meta[property="og:image"]', {
      element(el) {
        el.setAttribute('content', ogImageUrl);
      },
    })
    .on('meta[name="twitter:title"]', {
      element(el) {
        el.setAttribute('content', fullTitle);
      },
    })
    .on('meta[name="twitter:description"]', {
      element(el) {
        el.setAttribute('content', description);
      },
    })
    .on('meta[name="twitter:image"]', {
      element(el) {
        el.setAttribute('content', ogImageUrl);
      },
    })
    .on('link[rel="canonical"]', {
      element(el) {
        el.setAttribute('href', canonicalUrl);
      },
    })
    .on('script#modulus-jsonld', {
      element(el) {
        el.setInnerContent(jsonLd, { html: false });
      },
    })
    .transform(response);
}
