// import MarkdownIt from 'markdown-it'
// import hljs from 'highlight.js/lib/common'
import highlight from 'highlight.js/lib/common';
import { Marked } from 'marked';
import { webUrl } from './config.js';

// const markdown = new MarkdownIt({
//   html: false,
//   breaks: true,
//   linkify: true,
//   highlight(content, language) {
//     if (language && hljs.getLanguage(language)) return hljs.highlight(content, { language }).value
//     return ''
//   },
// })
//
// markdown.disable('image')
// markdown.renderer.rules.link_open = (tokens, index, options, _env, renderer) => {
//   tokens[index].attrSet('rel', 'nofollow ugc')
//   return renderer.renderToken(tokens, index, options)
// }
//
// markdown.block.ruler.before('paragraph', 'kucos_spoiler', (state, start, end, silent) => {
//   const line = (row: number) => state.src.slice(state.bMarks[row] + state.tShift[row], state.eMarks[row])
//   const isSpoiler = (text: string) => /^!(?!\[)/.test(text)
//   if (state.sCount[start] - state.blkIndent >= 4 || !isSpoiler(line(start))) return false
//   if (silent) return true
//
//   const lines = []
//   let next = start
//   while (next < end && isSpoiler(line(next))) lines.push(line(next++).slice(1).trimStart())
//   state.push('html_block', '', 0).content =
//     `<details class="kucos-spoiler"><summary>Show spoiler</summary>${markdown.renderInline(lines.join('\n'))}</details>`
//   state.line = next
//   return true
// }, { alt: ['paragraph', 'blockquote'] })
//
// markdown.inline.ruler.before('text', 'kucos_quote', (state, silent) => {
//   if (!state.src.startsWith(':"', state.pos)) return false
//   const end = state.src.indexOf('":', state.pos + 2)
//   if (end === -1 || end + 2 > state.posMax) return false
//   if (!silent) {
//     state.push('q_open', 'q', 1)
//     state.push('text', '', 0).content = state.src.slice(state.pos + 2, end)
//     state.push('q_close', 'q', -1)
//   }
//   state.pos = end + 2
//   return true
// })
//
// export function renderMarkdown(content: string) {
//   return markdown.render(content)
// }

const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escape = (text) => text.replace(/[&<>"']/g, (match) => entities[match]);

const markdown = new Marked({ gfm: true, breaks: true });
markdown.use({
  renderer: {
    html({ text }) {
      return escape(text);
    },
    link({ href, tokens }) {
      const label = this.parser.parseInline(tokens);
      const url = webUrl(href);
      return url ? '<a href="' + escape(url.href) + '" rel="ugc nofollow noreferrer">' + label + '</a>' : label;
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
    start: (source) => source.search(/^![ \t]/m),
    tokenizer(source) {
      const match = /^(?:![ \t].*(?:\n|$))+/.exec(source);
      if (match) return { type: 'spoiler', raw: match[0], text: match[0].replace(/^![ \t]/gm, '').trimEnd() };
    },
    renderer: ({ text }) => '<details class="kucos-spoiler"><summary>Spoiler</summary><p>' + escape(text).replaceAll('\n', '<br>') + '</p></details>',
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

export const renderMarkdown = (text) => markdown.parse(text);
