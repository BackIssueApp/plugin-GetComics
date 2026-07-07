// Representative GetComics markup for parser tests. Modeled on the site's real
// structure (WordPress <article> cards; AIO download buttons in the post body),
// kept minimal — the parsers key off host/label and the Year/Size text, not
// exact theme classes, so these exercise the logic that matters.

export const SEARCH_HTML = `
<div class="content">
  <article id="post-1" class="post">
    <a href="https://getcomics.org/other-comics/saga-012-2013/" class="post-thumbnail">
      <img data-src="https://i0.wp.com/getcomics.org/uploads/saga-012.jpg" />
    </a>
    <h1 class="post-title"><a href="https://getcomics.org/other-comics/saga-012-2013/">Saga #12 (2013)</a></h1>
    <p style="text-align:center;">Language : English | Year : 2013 | Size : 38 MB</p>
    <a href="https://getcomics.org/cat/image/">Image Comics</a>
  </article>
  <article id="post-2" class="post">
    <h2><a href="https://getcomics.org/other-comics/saga-vol-1-2013/">Saga Vol. 1 (#1-6) (2013)</a></h2>
    <p>Year : 2013 | Size : 210 MB</p>
  </article>
  <article id="post-3" class="post">
    <h2><a href="https://getcomics.org/other-comics/paper-girls-012-2017/">Paper Girls #12 (2017)</a></h2>
    <p>Year : 2017 | Size : 42 MB</p>
  </article>
</div>`;

export const POST_HTML = `
<article>
  <div class="post-contents">
    <p>Language : English | Image Format : JPG | Year : 2013 | Size : 38 MB</p>
    <div class="aio-button-center">
      <a href="https://getcomics.org/dlds/12345/" class="aio-button" target="_blank"><span>Download Now</span></a>
      <a href="https://pixeldrain.com/u/abc123XY" class="aio-button">PixelDrain</a>
      <a href="https://mega.nz/file/deadbeef" class="aio-button">MEGA</a>
      <a href="https://www.mediafire.com/file/zzz/Saga.cbz/file" class="aio-button">MEDIAFIRE</a>
      <a href="https://getcomics.org/other-comics/saga-012-2013/#reader">Read Online</a>
    </div>
  </div>
  <footer><a href="https://getcomics.org/">Home</a></footer>
</article>`;
