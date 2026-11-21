(() => {
  const script = document.currentScript;
  if (!script) return;
  const server = new URL(script.src).origin;

  function start() {
    const mounts = document.querySelectorAll('#comments, [data-kucos]');
    if (!mounts.length) return;

    const style = document.createElement('link');
    style.rel = 'stylesheet';
    style.href = new URL('/min/kucos.min.css', server).href;
    document.head.append(style);

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

  function widget(mount, article, api) {
    const encoded = encodeURIComponent(article);
    const root = element('section', 'kucos');
    root.setAttribute('aria-label', 'Kucos comments');
    const heading = element('h2', 'kucos-heading', 'Comments');
    const notice = element('p', 'kucos-status');
    notice.setAttribute('role', 'status');
    const thread = element('ul', 'kucos-thread');
    const kudo = button('♥  Kudos', toggleKudos, 'kucos-kudos');
    kudo.setAttribute('aria-pressed', 'false');
    kudo.disabled = true;
    const bar = element('div', 'kucos-bar');
    bar.append(heading, kudo);
    root.append(bar, commentForm(), notice, thread);
    mount.replaceChildren(root);
    let given = false;

    function updateKudos(result) {
      given = result.given;
      kudo.setAttribute('aria-pressed', String(given));
      kudo.textContent = `♥  ${result.kudos} Kudos`;
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

    async function refresh(focusId) {
      try {
        const { count, comments } = await api(`/api/comments/${encoded}`);
        heading.textContent = `${count} ${count === 1 ? 'comment' : 'comments'}`;
        const nodes = renderThread(comments);
        thread.replaceChildren(...nodes);
        thread.hidden = !nodes.length;
        if (location.hash.startsWith('#comment-') && !focusId) {
          document.getElementById(location.hash.slice(1))?.scrollIntoView();
        }
        if (focusId) {
          const target = document.getElementById(`comment-${focusId}`);
          if (target) {
            target.tabIndex = -1;
            target.focus();
          }
        }
      } catch (error) {
        showError(notice, error);
      }
    }

    function commentForm({ parentId, edit, text = '', close } = {}) {
      const form = element('form', 'kucos-form');
      const label = element('label', 'kucos-input', edit ? 'Edit comment' : parentId ? 'Your reply' : 'Your comment');
      const field = element('textarea');
      field.name = 'comment';
      field.rows = 4;
      field.required = true;
      field.minLength = 4;
      field.maxLength = 4999;
      field.value = text;
      label.append(field);
      form.append(label);

      const formats = element('div', 'kucos-tools');
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
      form.prepend(formats);

      if (!edit) {
        const details = element('details', 'kucos-details');
        details.append(element('summary', '', 'Add a name, email, or website'));
        const optional = element('div', 'kucos-optional');
        for (const [name, caption, type] of [
          ['author', 'Name', 'text'], ['email', 'Email (private)', 'email'], ['website', 'Website', 'url'],
        ]) {
          const label = element('label', 'kucos-input', caption);
          const input = element('input');
          input.name = name;
          input.type = type;
          input.maxLength = 1000;
          label.append(input);
          optional.append(label);
        }
        details.append(optional);
        form.append(details);
      }

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
      controls.append(submit);
      if (close) controls.append(button('Cancel', close));
      controls.append(status);
      form.append(controls);

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
          notice.textContent = message.spam ? 'Your comment is awaiting moderation.' : edit ? 'Comment updated.' : 'Comment posted.';
          close?.();
          await refresh(message.id);
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
        node.id = `comment-${comment.id}`;
        const meta = element('div', 'kucos-meta');
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
        const permalink = itemLink('', `#comment-${comment.id}`);
        permalink.append(stamp);
        meta.append(author, permalink);
        if (comment.sticky) meta.append(element('span', 'kucos-tag', 'Pinned'));
        if (comment.edited) meta.append(element('span', 'kucos-tag', 'Edited'));
        node.append(meta);

        const content = element('div', 'kucos-content');
        if (comment.spam) content.textContent = 'Awaiting moderation.';
        else content.innerHTML = comment.comment;
        node.append(content);
        const actions = element('div', 'kucos-controls');
        const status = element('span', 'kucos-status');
        status.setAttribute('role', 'status');
        const followUp = element('div');
        node.append(actions, followUp);

        function openForm(options) {
          followUp.replaceChildren(commentForm({ parentId: comment.id, close: () => followUp.replaceChildren(), ...options }));
          followUp.querySelector('textarea').focus();
        }

        if (!comment.spam) {
          const score = element('span', 'kucos-score', String(comment.score));
          score.setAttribute('aria-label', `Score ${comment.score}`);
          const vote = async (action) => {
            up.disabled = down.disabled = true;
            try {
              const { message } = await api('/api/comments/vote', 'POST', { msgid: comment.id, action });
              score.textContent = message.score;
              score.setAttribute('aria-label', `Score ${message.score}`);
              status.textContent = '';
            } catch (error) {
              showError(status, error);
              up.disabled = down.disabled = false;
            }
          };
          const up = button('↑', () => vote('upvote'));
          const down = button('↓', () => vote('downvote'));
          up.setAttribute('aria-label', 'Upvote');
          down.setAttribute('aria-label', 'Downvote');
          actions.append(up, score, down, button('Reply', () => {
            const selection = window.getSelection();
            const selected = content.contains(selection?.anchorNode) && content.contains(selection?.focusNode)
              ? String(selection).trim() : '';
            openForm({ text: selected ? selected.split('\n').map((line) => `> ${line}`).join('\n') + '\n\n' : '' });
          }));
        }
        if (comment.editable) {
          actions.append(button('Edit', async () => {
            try {
              const { message } = await api(`/api/comments/row/${comment.id}`);
              openForm({ edit: true, text: message });
            } catch (error) {
              showError(status, error);
            }
          }));
        }
        actions.append(status);

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
