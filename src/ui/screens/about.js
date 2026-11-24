// Hakkında: description, version (VERSION only, from the generated src/ui/version.js; the
// stamped commit is not shown), developer, language, contact, privacy and copyright.

import { h } from '../dom.js';
import { header, screen } from '../components.js';
import { hashFor } from '../routes.js';
import { VERSION } from '../version.js';
import { t } from '../i18n/i18n.js';

// Contact labels: brand names stay as they are; `labelKey` is a locale key.
const CONTACTS = [
  { label: 'GitHub', value: 'github.com/MalikFikret', href: 'https://github.com/MalikFikret' },
  { labelKey: 'about.email', value: 'malikfikretcontact@gmail.com', href: 'mailto:malikfikretcontact@gmail.com' },
  { label: 'Instagram', value: '@malikfikret', href: 'https://instagram.com/malikfikret' },
  { label: 'LinkedIn', value: 'linkedin.com/in/malikfikret', href: 'https://linkedin.com/in/malikfikret' },
];

const external = (href) => (href.startsWith('mailto:') ? {} : { target: '_blank', rel: 'noopener noreferrer' });

export function aboutScreen(ctx) {
  const top = header({ title: t('about.title'), subtitle: t('app.name'), onBack: () => ctx.go(hashFor.home()) });
  return screen('screen-about', top.el,
    h('div', { class: 'stack about' },
      h('div', { class: 'about-intro' },
        h('p', { class: 'about-title', text: t('app.name') }),
        h('p', { class: 'muted', text: t('about.intro') })),
      h('dl', { class: 'facts' },
        h('dt', { text: t('about.version') }), h('dd', { text: VERSION }),
        h('dt', { text: t('about.developer') }), h('dd', { class: 'strong', text: t('about.developerName') }),
        h('dt', { text: t('about.language') }), h('dd', { text: t('meta.languageName') })),
      h('section', { class: 'about-section' },
        h('h2', { class: 'section-title', text: t('about.contact') }),
        CONTACTS.map((c) => h('a', { class: 'contact', href: c.href, ...external(c.href) },
          h('span', { class: 'contact-label', text: c.labelKey ? t(c.labelKey) : c.label }),
          h('span', { class: 'contact-value', text: c.value })))),
      h('section', { class: 'about-section' },
        h('h2', { class: 'section-title', text: t('about.privacy') }),
        h('p', { class: 'muted small', text: t('about.privacyText') })),
      h('div', { class: 'card' },
        h('span', { class: 'strong', text: t('common.copyright') }),
        h('span', { class: 'muted small', text: t('about.ownership') }))));
}
