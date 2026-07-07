// GetComics client UI — injected by core via window.BackIssue. Adds the source
// settings section (toggle + site URL + FlareSolverr + a Test button). Reuses
// core CSS classes; no extra stylesheet.
(function () {
  const $ = (id) => document.getElementById(id);

  window.BackIssue.registerClient((api) => {
    const src = api.slot('settings-plugin-sources');
    if (src) {
      const block = document.createElement('div');
      block.className = 'src-block';
      block.innerHTML =
        '<div class="src-toggle">' +
          '<label class="switch"><input id="set-getcomicsEnabled" type="checkbox"><span class="switch__track"></span></label>' +
          '<div class="src-toggle__text"><b>GetComics</b><span class="modal__note src-toggle__note">Direct downloads from getcomics.org. Fetches a ready CBZ — no external client needed.</span></div>' +
        '</div>' +
        '<div id="getcomics-config" class="src-config">' +
          '<label class="field"><span>Site URL</span><input id="set-getcomicsUrl" type="text" spellcheck="false" placeholder="https://getcomics.org"></label>' +
          '<label class="field"><span>FlareSolverr URL</span><input id="set-getcomicsFlaresolverrUrl" type="text" spellcheck="false" placeholder="http://flaresolverr:8191/v1"></label>' +
          '<p class="modal__note">GetComics sits behind Cloudflare. <b>FlareSolverr</b> (a small companion service you run — <code>ghcr.io/flaresolverr/flaresolverr</code>) solves the challenge; point this at its <code>/v1</code> endpoint. Leave blank to try a direct request, which works only when Cloudflare isn\'t actively challenging.</p>' +
          '<div class="client-test"><button id="getcomics-test" class="btn btn--ghost" type="button">Test connection</button><span id="getcomics-test-result" class="client-status" hidden></span></div>' +
          '<p class="modal__note">GetComics posts are often multi-issue packs; this source grabs single-issue matches for the download queue. Downloads use its own server, falling back to PixelDrain.</p>' +
        '</div>';
      src.appendChild(block);
    }

    // Toggling the source re-syncs the shared source UI (warning + priority).
    const enabled = $('set-getcomicsEnabled');
    if (enabled) enabled.onchange = () => api.refreshSourceUI();

    // Reveal the config only when enabled (like usenet/torrent); report enabled
    // state for the no-sources warning.
    api.onSourcesSync(() => {
      const en = !!(enabled && enabled.checked);
      const cfg = $('getcomics-config'); if (cfg) cfg.classList.toggle('open', en);
      return en;
    });

    // Test button — runs a trivial search server-side and reports parse count.
    const testBtn = $('getcomics-test');
    if (testBtn) testBtn.onclick = async () => {
      const el = $('getcomics-test-result');
      el.hidden = false; el.className = 'client-status is-testing'; el.textContent = 'Testing…';
      let r;
      try {
        r = await api.post('/api/getcomics/test', {
          getcomicsUrl: ($('set-getcomicsUrl').value || '').trim(),
          getcomicsFlaresolverrUrl: ($('set-getcomicsFlaresolverrUrl').value || '').trim(),
        });
      } catch (e) { r = { ok: false, message: String(e) }; }
      el.className = 'client-status ' + (r.ok ? 'is-ok' : 'is-bad');
      el.textContent = (r.ok ? '✓ ' : '✕ ') + r.message;
    };
  });
})();
