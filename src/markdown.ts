import highlight from 'highlight.js/lib/common';
import { Marked } from 'marked';
import { safeUrl } from './http.js';

const entities: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escape = (text: string) => text.replace(/[&<>"']/g, (match) => entities[match]);

function commentLink(href: string) {
  if (href.length > 2000) return;
  const absolute = URL.parse(href);
  if (absolute) return absolute.protocol === 'mailto:' ? absolute.href : safeUrl(href)?.href;

  const base = 'https://kucos.invalid';
  if (URL.parse(href, base)?.origin === base) return href;
}

const markdown = new Marked({ gfm: true, breaks: true });
markdown.use({
  renderer: {
    html({ text }) {
      return escape(text);
    },
    link({ href, tokens }) {
      const label = this.parser.parseInline(tokens);
      const url = commentLink(href);
      return url ? '<a href="' + escape(url) + '" rel="ugc nofollow noreferrer">' + label + '</a>' : label;
    },
    image({ text }) {
      return escape(text);
    },
    code({ text, lang }) {
      const language = lang?.trim().split(/\s+/)[0];
      const rendered = language && highlight.getLanguage(language)
        ? highlight.highlight(text, { language, ignoreIllegals: true }).value
        : escape(text);
      return '<pre><code>' + rendered + '</code></pre>\n';
    },
  },
  extensions: [{
    name: 'spoiler',
    level: 'block',
    start: (source) => source.search(/^!(?!\[)/m),
    tokenizer(source) {
      const match = /^(?:!(?!\[)[^\n]*(?:\n|$))+/.exec(source);
      if (match) {
        const text = match[0].replace(/^![ \t]?/gm, '').trimEnd();
        return { type: 'spoiler', raw: match[0], tokens: this.lexer.inlineTokens(text) };
      }
    },
    renderer({ tokens }) {
      return '<details class="kucos-spoiler"><summary>Show spoiler</summary><p>' + this.parser.parseInline(tokens ?? []) + '</p></details>\n';
    },
  }, {
    name: 'inlineQuote',
    level: 'inline',
    start: (source) => source.indexOf(':"'),
    tokenizer(source) {
      const match = /^:"([^"\n]+)":/.exec(source);
      if (match) return { type: 'inlineQuote', raw: match[0], text: match[1] };
    },
    renderer: ({ text }) => '<q>' + escape(text) + '</q>',
  }],
});

export const renderMarkdown = (text: string) => markdown.parse(text, { async: false });
