(() => {
  const script = document.currentScript;
  if (!script) return;
  const server = new URL(script.src).origin;

  function start() {
    const mounts = document.querySelectorAll('#kucos-comments, [data-kucos]');
    if (!mounts.length) return;

    const key = `kucos:visitor:${server}`;
    let token;
    try {
      token = localStorage.getItem(key);
    } catch {
      // A browser may disable site storage.
    }
    if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(token ?? '')) {
      const hex = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('');
      token = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20)}`;
      try {
        localStorage.setItem(key, token);
      } catch {
        // The token still identifies this visitor until the page reloads.
      }
    }

    async function api(path, method = 'GET', body) {
      const headers = { 'X-Kucos-Visitor': token };
      if (body) headers['Content-Type'] = 'application/json';
      const response = await fetch(new URL(path, server), {
        method, headers, body: body && JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Kucos could not complete the request.');
      return result;
    }

    for (const mount of mounts) {
      if (mount.dataset.kucosReady) continue;
      mount.dataset.kucosReady = 'true';
      try {
        const url = new URL(mount.dataset.article || location.href, location.href);
        if (url.hash.startsWith('#comment-')) url.hash = '';
        widget(mount, url.href, api);
      } catch {
        mount.textContent = 'Kucos could not load this article.';
      }
    }
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function button(label, action, className) {
    const node = element('button', className, label);
    node.type = 'button';
    node.addEventListener('click', action);
    return node;
  }

  function itemLink(text, href) {
    const link = element('a', '', text);
    link.href = href;
    return link;
  }

  function formatScore(score) {
    return `${score} ${Math.abs(score) === 1 ? 'point' : 'points'}`;
  }

  function widget(mount, article, api) {
    const encoded = encodeURIComponent(article);
    const host = element('div');
    const shadow = host.attachShadow({ mode: 'open' });
    const style = element('link');
    style.rel = 'stylesheet';
    style.href = new URL('/min/kucos.min.css', server).href;
    const root = element('section', 'kucos');
    root.setAttribute('aria-label', 'Comments and kudos');
    const heading = element('h2', 'kucos-heading', 'Discussion');
    const countBadge = element('span', 'kucos-count');
    const title = element('div', 'kucos-title');
    title.append(heading, countBadge);
    const notice = element('p', 'kucos-status');
    notice.setAttribute('role', 'status');
    const thread = element('div', 'kucos-discussion');
    const kudo = button('', toggleKudos, 'kucos-kudos');
    const heart = element('span', 'kucos-heart', '♥');
    heart.setAttribute('aria-hidden', 'true');
    const kudoCount = element('span');
    kudo.append(heart, element('span', '', 'Kudos'), kudoCount);
    kudo.setAttribute('aria-pressed', 'false');
    kudo.disabled = true;
    const bar = element('header', 'kucos-bar');
    bar.append(title, kudo);
    const footer = element('footer', 'kucos-footer');
    const credit = itemLink('Comments by Kucos', 'https://github.com/kucosjs/v2');
    credit.className = 'credit';
    credit.target = '_blank';
    credit.rel = 'noopener noreferrer';
    credit.append(element('span', '', '.'));
    footer.append(credit);
    root.append(bar, commentForm(), notice, thread, footer);
    shadow.append(style, root);
    mount.replaceChildren(host);
    let given = false;
    let highlightedComment = null;

    function updateKudos(result) {
      given = result.given;
      kudo.setAttribute('aria-pressed', String(given));
      kudoCount.textContent = result.kudos;
    }

    async function toggleKudos() {
      kudo.disabled = true;
      try {
        const { message } = await api('/api/kudos', 'POST', { id: article, kudo: given ? 'remove' : 'add' });
        updateKudos(message);
        notice.textContent = '';
      } catch (error) {
        showError(notice, error);
      } finally {
        kudo.disabled = false;
      }
    }

    function showError(status, error) {
      status.textContent = error instanceof Error ? error.message : 'Kucos could not complete the request.';
    }

    function focusComment(target) {
      if (!target) return;
      for (let parent = target.parentElement; parent && parent !== thread; parent = parent.parentElement) {
        if (parent.tagName === 'DETAILS') parent.open = true;
      }
      target.focus({ preventScroll: true });
      target.scrollIntoView({ block: 'start', inline: 'nearest' });
    }

    function focusPermalink(hash = location.hash, moveFocus = true) {
      const id = hash.startsWith('#comment-') ? hash.slice(1) : '';
      const target = id ? shadow.getElementById(id) : null;
      if (highlightedComment !== target) {
        highlightedComment?.classList.remove('kucos-highlight');
        target?.classList.add('kucos-highlight');
        highlightedComment = target;
      }
      if (moveFocus) focusComment(target);
    }

    window.addEventListener('hashchange', () => focusPermalink());

    function showSubmissionNotice(text) {
      notice.textContent = text;
      notice.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }

    async function refresh(submission) {
      thread.setAttribute('aria-busy', 'true');
      try {
        const { count, comments } = await api(`/api/comments/${encoded}`);
        countBadge.textContent = count;
        countBadge.setAttribute('aria-label', `${count} ${count === 1 ? 'comment' : 'comments'}`);
        const nodes = renderThread(comments);
        const list = element('ul', 'kucos-thread');
        list.append(...nodes);
        thread.replaceChildren(nodes.length ? list : element('p', 'kucos-empty', 'No comments yet.'));
        focusPermalink(location.hash, !submission);
        if (submission) {
          const target = submission.id && shadow.getElementById(`comment-${submission.id}`);
          if (target) {
            const confirmation = element('p', 'kucos-confirmation', submission.text);
            confirmation.id = `${target.id}-confirmation`;
            target.setAttribute('aria-describedby', confirmation.id);
            target.prepend(confirmation);
            focusComment(target);
          } else {
            showSubmissionNotice(submission.text);
          }
        }
      } catch (error) {
        if (submission) showSubmissionNotice(`${submission.text} The discussion couldn't reload.`);
        else showError(notice, error);
        thread.replaceChildren(button('Try again', () => {
          notice.textContent = '';
          void refresh(submission);
        }, 'kucos-quiet'));
      } finally {
        thread.setAttribute('aria-busy', 'false');
      }
    }

    function commentForm({ parentId, draft, text = '', close } = {}) {
      const edit = Boolean(draft);
      const form = element('form', 'kucos-form');
      const label = element('label', 'kucos-input', edit ? 'Edit comment' : parentId ? 'Your reply' : 'Your comment');
      const field = element('textarea');
      field.name = 'comment';
      field.rows = 3;
      field.required = true;
      field.minLength = 4;
      field.maxLength = 4999;
      field.placeholder = parentId && !edit ? 'Write your reply…' : 'Join the discussion…';
      field.value = draft?.comment ?? text;
      label.append(field);
      form.append(label);

      const formats = element('div', 'kucos-tools');
      formats.setAttribute('role', 'group');
      formats.setAttribute('aria-label', 'Markdown formatting');
      for (const [name, before, after] of [
        ['Bold', '**', '**'], ['Italic', '_', '_'], ['Quote', '> ', ''],
        ['Link', '[', '](https://example.com)'], ['Code', '`', '`'],
        ['Spoiler', '! ', ''], ['Strike', '~~', '~~'],
      ]) {
        formats.append(button(name, () => {
          const { selectionStart: start, selectionEnd: end } = field;
          const selected = field.value.slice(start, end);
          field.setRangeText(before + selected + after, start, end);
          field.setSelectionRange(start + before.length, start + before.length + selected.length);
          field.focus();
        }));
      }
      form.append(formats);

      const details = element('details', 'kucos-details');
      details.append(element('summary', '', edit ? 'Edit name, website, or email' : 'Add a name, website, or email'));
      const optional = element('div', 'kucos-optional');
      for (const [name, caption, type] of [
        ['author', 'Name', 'text'], ['website', 'Website', 'url'], ['email', 'Email (private)', 'email'],
      ]) {
        const label = element('label', 'kucos-input', caption);
        const input = element('input');
        input.name = name;
        input.type = type;
        input.maxLength = 1000;
        input.value = draft?.[name] ?? '';
        label.append(input);
        optional.append(label);
      }
      details.append(optional);

      const trap = element('input');
      trap.name = 'username';
      trap.tabIndex = -1;
      trap.autocomplete = 'off';
      trap.hidden = true;
      form.append(trap);

      const controls = element('div', 'kucos-controls');
      const submit = element('button', 'kucos-submit', edit ? 'Save changes' : parentId ? 'Post reply' : 'Post comment');
      submit.type = 'submit';
      const status = element('span', 'kucos-status');
      status.setAttribute('role', 'status');
      if (close) controls.append(button('Cancel', close, 'kucos-quiet'));
      controls.append(submit);
      const footer = element('div', 'kucos-form-footer');
      footer.append(details, controls);
      form.append(footer, status);

      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        submit.disabled = true;
        status.textContent = 'Saving…';
        try {
          const { message } = await api('/api/comments', edit ? 'PATCH' : 'POST', {
            ...Object.fromEntries(new FormData(form)), article_url: article, parent_id: parentId,
          });
          form.reset();
          status.textContent = '';
          notice.textContent = '';
          const confirmation = message.spam ? 'Your comment was flagged for review.' : edit ? 'Comment updated.' : 'Comment posted.';
          close?.();
          await refresh({ id: message.id, text: confirmation });
        } catch (error) {
          showError(status, error);
        } finally {
          submit.disabled = false;
        }
      });

      return form;
    }

    function renderThread(comments) {
      return Object.values(comments).sort((a, b) => b.sticky - a.sticky).map((comment) => {
        const node = element('li', 'kucos-entry');
        const card = element('article', comment.spam ? 'kucos-comment kucos-comment-flagged' : 'kucos-comment');
        card.id = `comment-${comment.id}`;
        card.tabIndex = -1;
        const meta = element('div', 'kucos-meta');
        const [initial] = comment.authorText.trim();
        const avatar = element('span', 'kucos-avatar', initial?.toUpperCase() || '?');
        avatar.setAttribute('aria-hidden', 'true');
        const author = element('strong', '', comment.authorText);
        if (comment.website) {
          const url = new URL(comment.website);
          if (['https:', 'http:'].includes(url.protocol)) {
            const link = itemLink(comment.authorText, url.href);
            link.rel = 'nofollow ugc';
            author.replaceChildren(link);
          }
        }
        const stamp = element('time', '', comment.created);
        stamp.dateTime = comment.createdOn;
        stamp.title = comment.createdOnTime;
        const permalink = itemLink('', new URL(`#${card.id}`, location.href));
        permalink.addEventListener('click', (event) => {
          if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

          event.preventDefault();
          if (location.hash !== permalink.hash) {
            history.pushState(history.state, '', new URL(permalink.hash, location.href));
          }
          focusPermalink(permalink.hash);
        });
        permalink.append(stamp);
        const commentInfo = element('div', 'kucos-comment-info');
        const byline = element('div', 'kucos-byline');
        byline.append(author);
        if (comment.sticky) byline.append(element('span', 'kucos-tag kucos-pinned', 'Pinned'));
        if (comment.spam) byline.append(element('span', 'kucos-tag kucos-flagged', 'Flagged'));
        if (comment.edited) byline.append(element('span', 'kucos-tag', 'Edited'));
        const commentDetails = element('div', 'kucos-comment-details');
        commentDetails.append(permalink);
        commentInfo.append(byline, commentDetails);
        meta.append(avatar, commentInfo);
        const content = element('div', 'kucos-content');
        const actions = element('div', 'kucos-controls kucos-comment-actions');
        const status = element('div', 'kucos-status');
        status.setAttribute('role', 'status');
        const followUp = element('div', 'kucos-inline-editor');
        card.append(meta);
        if (!comment.spam) {
          content.innerHTML = comment.comment;
          card.append(content);
        }
        card.append(status, followUp);
        node.append(card);

        function openForm(options) {
          followUp.replaceChildren(commentForm({ parentId: comment.id, close: () => followUp.replaceChildren(), ...options }));
          followUp.querySelector('textarea').focus();
        }

        if (!comment.spam) {
          const votes = element('div', 'kucos-votes');
          const score = element('span', 'kucos-score', formatScore(comment.score));
          score.setAttribute('aria-live', 'polite');
          const separator = element('span', '', '·');
          separator.setAttribute('aria-hidden', 'true');
          commentDetails.prepend(score, separator);
          const vote = async (action) => {
            up.disabled = down.disabled = true;
            try {
              const { message } = await api('/api/comments/vote', 'POST', { msgid: comment.id, action });
              score.textContent = formatScore(message.score);
              status.textContent = '';
            } catch (error) {
              showError(status, error);
              up.disabled = down.disabled = false;
            }
          };
          const up = button('', () => vote('upvote'), 'kucos-vote kucos-vote-up');
          const down = button('', () => vote('downvote'), 'kucos-vote');
          up.disabled = down.disabled = comment.voted;
          up.setAttribute('aria-label', 'Upvote');
          down.setAttribute('aria-label', 'Downvote');
          votes.append(up, down);
          meta.append(votes);
          function selectedText() {
            const selection = shadow.getSelection?.() ?? window.getSelection();
            return content.contains(selection?.anchorNode) && content.contains(selection?.focusNode)
              ? String(selection).trim().slice(0, 2000) : '';
          }
          let quote = '';
          const reply = button('Reply', () => {
            const selected = quote || selectedText();
            quote = '';
            openForm({ text: selected ? selected.split('\n').map((line) => `> ${line}`).join('\n') + '\n\n' : '' });
          }, 'kucos-quiet');
          reply.addEventListener('pointerdown', () => { quote = selectedText(); });
          actions.append(reply);
        }
        if (comment.editable) {
          actions.append(button('Edit', async () => {
            try {
              const { message } = await api(`/api/comments/edit/${comment.id}`);
              openForm({ draft: message });
            } catch (error) {
              showError(status, error);
            }
          }, 'kucos-quiet'));
        }
        meta.append(actions);

        const replies = renderThread(comment.children);
        if (replies.length) {
          const details = element('details', 'kucos-replies');
          details.open = true;
          const list = element('ul', 'kucos-thread');
          list.append(...replies);
          details.append(element('summary', '', `${replies.length} ${replies.length === 1 ? 'reply' : 'replies'}`), list);
          node.append(details);
        }
        return node;
      });
    }

    notice.textContent = 'Loading comments…';
    void refresh().then(() => {
      if (notice.textContent === 'Loading comments…') notice.textContent = '';
    });
    api(`/api/kudos/${encoded}`).then(({ message }) => {
      updateKudos(message);
      kudo.disabled = false;
    }).catch((error) => showError(notice, error));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
