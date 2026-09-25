// What GitHub's Markdown API rendered for 325 documents, recorded by
// `reference/build-github-fixture.ts`, which asked GitHub once and kept the answers.
//
// 309 are read the same way by this engine, and 16 differ, each for the reason it
// carries. Never edit an answer by hand to make a test pass: ask GitHub again.

export interface GitHubRendering {
  name: string;
  markdown: string;
  html: string;
  /** Why this engine reads the document differently from GitHub. */
  differsFromGitHub?: string;
}

export const GITHUB_RENDERINGS: GitHubRendering[] = [
  {
    "name": "element html in a div",
    "markdown": "<div>x<html>y</html>z</div>",
    "html": "<div>xyz</div>"
  },
  {
    "name": "element body in a div",
    "markdown": "<div>x<body>y</body>z</div>",
    "html": "<div>xyz</div>"
  },
  {
    "name": "element address in a div",
    "markdown": "<div>x<address>y</address>z</div>",
    "html": "<div>xyz</div>"
  },
  {
    "name": "element blockquote in a div",
    "markdown": "<div>x<blockquote>y</blockquote>z</div>",
    "html": "<div>x<blockquote>y</blockquote>z</div>"
  },
  {
    "name": "element center in a div",
    "markdown": "<div>x<center>y</center>z</div>",
    "html": "<div>xyz</div>"
  },
  {
    "name": "element dialog in a div",
    "markdown": "<div>x<dialog>y</dialog>z</div>",
    "html": "<div>xyz</div>"
  },
  {
    "name": "element div in a div",
    "markdown": "<div>x<div>y</div>z</div>",
    "html": "<div>x<div>y</div>z</div>"
  },
  {
    "name": "element figure in a div",
    "markdown": "<div>x<figure>y</figure>z</div>",
    "html": "<div>xyz</div>"
  },
  {
    "name": "element figcaption in a div",
    "markdown": "<div>x<figcaption>y</figcaption>z</div>",
    "html": "<div>xyz</div>"
  },
  {
    "name": "element footer in a div",
    "markdown": "<div>x<footer>y</footer>z</div>",
    "html": "<div>xyz</div>"
  },
  {
    "name": "element form in a div",
    "markdown": "<div>x<form>y</form>z</div>",
    "html": "<div>xyz</div>"
  },
  {
    "name": "element header in a div",
    "markdown": "<div>x<header>y</header>z</div>",
    "html": "<div>xyz</div>"
  },
  {
    "name": "element hr in a div",
    "markdown": "<div>x<hr>y</hr>z</div>",
    "html": "<div>x<hr>yz</div>"
  },
  {
    "name": "element legend in a div",
    "markdown": "<div>x<legend>y</legend>z</div>",
    "html": "<div>xyz</div>"
  },
  {
    "name": "element listing in a div",
    "markdown": "<div>x<listing>y</listing>z</div>",
    "html": "<div>xyz</div>"
  },
  {
    "name": "element main in a div",
    "markdown": "<div>x<main>y</main>z</div>",
    "html": "<div>xyz</div>"
  },
  {
    "name": "element p in a div",
    "markdown": "<div>x<p>y</p>z</div>",
    "html": "<div>x<p>y</p>z</div>"
  },
  {
    "name": "element plaintext in a div",
    "markdown": "<div>x<plaintext>y</plaintext>z</div>",
    "html": "<div>x&lt;plaintext&gt;y&lt;/plaintext&gt;z</div>"
  },
  {
    "name": "element pre in a div",
    "markdown": "<div>x<pre>y</pre>z</div>",
    "html": "<div>x<pre class=\"notranslate\">y</pre>z</div>"
  },
  {
    "name": "element search in a div",
    "markdown": "<div>x<search>y</search>z</div>",
    "html": "<div>xyz</div>"
  },
  {
    "name": "element xmp in a div",
    "markdown": "<div>x<xmp>y</xmp>z</div>",
    "html": "<div>x&lt;xmp&gt;y&lt;/xmp&gt;z</div>"
  },
  {
    "name": "element article in a div",
    "markdown": "<div>x<article>y</article>z</div>",
    "html": "<div>xyz</div>"
  },
  {
    "name": "element aside in a div",
    "markdown": "<div>x<aside>y</aside>z</div>",
    "html": "<div>xyz</div>"
  },
  {
    "name": "element h1 in a div",
    "markdown": "<div>x<h1>y</h1>z</div>",
    "html": "<div>x<h1>y</h1>z</div>"
  },
  {
    "name": "element h2 in a div",
    "markdown": "<div>x<h2>y</h2>z</div>",
    "html": "<div>x<h2>y</h2>z</div>"
  },
  {
    "name": "element h3 in a div",
    "markdown": "<div>x<h3>y</h3>z</div>",
    "html": "<div>x<h3>y</h3>z</div>"
  },
  {
    "name": "element h4 in a div",
    "markdown": "<div>x<h4>y</h4>z</div>",
    "html": "<div>x<h4>y</h4>z</div>"
  },
  {
    "name": "element h5 in a div",
    "markdown": "<div>x<h5>y</h5>z</div>",
    "html": "<div>x<h5>y</h5>z</div>"
  },
  {
    "name": "element h6 in a div",
    "markdown": "<div>x<h6>y</h6>z</div>",
    "html": "<div>x<h6>y</h6>z</div>"
  },
  {
    "name": "element hgroup in a div",
    "markdown": "<div>x<hgroup>y</hgroup>z</div>",
    "html": "<div>xyz</div>"
  },
  {
    "name": "element nav in a div",
    "markdown": "<div>x<nav>y</nav>z</div>",
    "html": "<div>xyz</div>"
  },
  {
    "name": "element section in a div",
    "markdown": "<div>x<section>y</section>z</div>",
    "html": "<div>x<section>y</section>z</div>"
  },
  {
    "name": "element dir in a div",
    "markdown": "<div>x<dir>y</dir>z</div>",
    "html": "<div>xyz</div>"
  },
  {
    "name": "element dd in a div",
    "markdown": "<div>x<dd>y</dd>z</div>",
    "html": "<div>x<dd>y</dd>z</div>"
  },
  {
    "name": "element dl in a div",
    "markdown": "<div>x<dl>y</dl>z</div>",
    "html": "<div>x<dl>y</dl>z</div>"
  },
  {
    "name": "element dt in a div",
    "markdown": "<div>x<dt>y</dt>z</div>",
    "html": "<div>x<dt>y</dt>z</div>"
  },
  {
    "name": "element menu in a div",
    "markdown": "<div>x<menu>y</menu>z</div>",
    "html": "<div>xyz</div>"
  },
  {
    "name": "element ol in a div",
    "markdown": "<div>x<ol>y</ol>z</div>",
    "html": "<div>x<ol>y</ol>z</div>"
  },
  {
    "name": "element ul in a div",
    "markdown": "<div>x<ul>y</ul>z</div>",
    "html": "<div>x<ul>y</ul>z</div>"
  },
  {
    "name": "element li in a div",
    "markdown": "<div>x<li>y</li>z</div>",
    "html": "<div>x<li>y</li>z</div>"
  },
  {
    "name": "element fieldset in a div",
    "markdown": "<div>x<fieldset>y</fieldset>z</div>",
    "html": "<div>xyz</div>"
  },
  {
    "name": "element details in a div",
    "markdown": "<div>x<details>y</details>z</div>",
    "html": "<div>x<details><summary>Details</summary>y</details>z</div>",
    "differsFromGitHub": "GitHub adds a summary reading \"Details\" to a details element that has none."
  },
  {
    "name": "element summary in a div",
    "markdown": "<div>x<summary>y</summary>z</div>",
    "html": "<div>x<summary>y</summary>z</div>"
  },
  {
    "name": "element option in a div",
    "markdown": "<div>x<option>y</option>z</div>",
    "html": "<div>xyz</div>"
  },
  {
    "name": "element optgroup in a div",
    "markdown": "<div>x<optgroup>y</optgroup>z</div>",
    "html": "<div>xyz</div>"
  },
  {
    "name": "element table in a div",
    "markdown": "<div>x<table>y</table>z</div>",
    "html": "<div>xy<markdown-accessiblity-table><table role=\"table\"></table></markdown-accessiblity-table>z</div>",
    "differsFromGitHub": "Text written inside a table but outside any cell, or in a caption, is moved in front of the table by the HTML parser. This engine reads it where it is written."
  },
  {
    "name": "element caption in a div",
    "markdown": "<div>x<caption>y</caption>z</div>",
    "html": "<div>xyz</div>"
  },
  {
    "name": "element colgroup in a div",
    "markdown": "<div>x<colgroup>y</colgroup>z</div>",
    "html": "<div>xyz</div>"
  },
  {
    "name": "element col in a div",
    "markdown": "<div>x<col>y</col>z</div>",
    "html": "<div>xyz</div>"
  },
  {
    "name": "element thead in a div",
    "markdown": "<div>x<thead>y</thead>z</div>",
    "html": "<div>xyz</div>"
  },
  {
    "name": "element tbody in a div",
    "markdown": "<div>x<tbody>y</tbody>z</div>",
    "html": "<div>xyz</div>"
  },
  {
    "name": "element tfoot in a div",
    "markdown": "<div>x<tfoot>y</tfoot>z</div>",
    "html": "<div>xyz</div>"
  },
  {
    "name": "element tr in a div",
    "markdown": "<div>x<tr>y</tr>z</div>",
    "html": "<div>xyz</div>"
  },
  {
    "name": "element td in a div",
    "markdown": "<div>x<td>y</td>z</div>",
    "html": "<div>xyz</div>"
  },
  {
    "name": "element th in a div",
    "markdown": "<div>x<th>y</th>z</div>",
    "html": "<div>xyz</div>"
  },
  {
    "name": "element br in a div",
    "markdown": "<div>x<br>y</br>z</div>",
    "html": "<div>x<br>y<br>z</div>"
  },
  {
    "name": "element video in a div",
    "markdown": "<div>x<video>y</video>z</div>",
    "html": "<div>x<video>y</video>z</div>"
  },
  {
    "name": "element audio in a div",
    "markdown": "<div>x<audio>y</audio>z</div>",
    "html": "<div>xyz</div>"
  },
  {
    "name": "element rp in a div",
    "markdown": "<div>x<rp>y</rp>z</div>",
    "html": "<div>x<rp>y</rp>z</div>"
  },
  {
    "name": "element rt in a div",
    "markdown": "<div>x<rt>y</rt>z</div>",
    "html": "<div>x<rt>y</rt>z</div>"
  },
  {
    "name": "element ruby in a div",
    "markdown": "<div>x<ruby>y</ruby>z</div>",
    "html": "<div>x<ruby>y</ruby>z</div>"
  },
  {
    "name": "element template in a div",
    "markdown": "<div>x<template>y</template>z</div>",
    "html": "<div>xyz</div>"
  },
  {
    "name": "element input in a div",
    "markdown": "<div>x<input>y</input>z</div>",
    "html": "<div>xyz</div>"
  },
  {
    "name": "element button in a div",
    "markdown": "<div>x<button>y</button>z</div>",
    "html": "<div>xyz</div>"
  },
  {
    "name": "element select in a div",
    "markdown": "<div>x<select>y</select>z</div>",
    "html": "<div>xyz</div>"
  },
  {
    "name": "element object in a div",
    "markdown": "<div>x<object>y</object>z</div>",
    "html": "<div>xyz</div>"
  },
  {
    "name": "element math in a div",
    "markdown": "<div>x<math>y</math>z</div>",
    "html": "<div>xyz</div>"
  },
  {
    "name": "element svg in a div",
    "markdown": "<div>x<svg>y</svg>z</div>",
    "html": "<div>xyz</div>"
  },
  {
    "name": "element noscript in a div",
    "markdown": "<div>x<noscript>y</noscript>z</div>",
    "html": "<div>xyz</div>"
  },
  {
    "name": "element span in a div",
    "markdown": "<div>x<span>y</span>z</div>",
    "html": "<div>x<span>y</span>z</div>"
  },
  {
    "name": "element em in a div",
    "markdown": "<div>x<em>y</em>z</div>",
    "html": "<div>x<em>y</em>z</div>"
  },
  {
    "name": "element strong in a div",
    "markdown": "<div>x<strong>y</strong>z</div>",
    "html": "<div>x<strong>y</strong>z</div>"
  },
  {
    "name": "element a in a div",
    "markdown": "<div>x<a>y</a>z</div>",
    "html": "<div>xyz</div>"
  },
  {
    "name": "element img in a div",
    "markdown": "<div>x<img>y</img>z</div>",
    "html": "<div>x<a target=\"_blank\" rel=\"noopener noreferrer\" href=\"\"><img style=\"max-width: 100%;\"></a>yz</div>"
  },
  {
    "name": "element code in a div",
    "markdown": "<div>x<code>y</code>z</div>",
    "html": "<div>x<code class=\"notranslate\">y</code>z</div>"
  },
  {
    "name": "element kbd in a div",
    "markdown": "<div>x<kbd>y</kbd>z</div>",
    "html": "<div>x<kbd>y</kbd>z</div>"
  },
  {
    "name": "element sup in a div",
    "markdown": "<div>x<sup>y</sup>z</div>",
    "html": "<div>x<sup>y</sup>z</div>"
  },
  {
    "name": "element sub in a div",
    "markdown": "<div>x<sub>y</sub>z</div>",
    "html": "<div>x<sub>y</sub>z</div>"
  },
  {
    "name": "element ins in a div",
    "markdown": "<div>x<ins>y</ins>z</div>",
    "html": "<div>x<ins>y</ins>z</div>"
  },
  {
    "name": "element del in a div",
    "markdown": "<div>x<del>y</del>z</div>",
    "html": "<div>x<del>y</del>z</div>"
  },
  {
    "name": "element s in a div",
    "markdown": "<div>x<s>y</s>z</div>",
    "html": "<div>x<s>y</s>z</div>"
  },
  {
    "name": "element q in a div",
    "markdown": "<div>x<q>y</q>z</div>",
    "html": "<div>x<q>y</q>z</div>"
  },
  {
    "name": "element abbr in a div",
    "markdown": "<div>x<abbr>y</abbr>z</div>",
    "html": "<div>xyz</div>"
  },
  {
    "name": "element mark in a div",
    "markdown": "<div>x<mark>y</mark>z</div>",
    "html": "<div>x<mark>y</mark>z</div>"
  },
  {
    "name": "element small in a div",
    "markdown": "<div>x<small>y</small>z</div>",
    "html": "<div>xyz</div>"
  },
  {
    "name": "element picture in a div",
    "markdown": "<div>x<picture>y</picture>z</div>",
    "html": "<div>x<themed-picture data-catalyst-inline=\"true\"><picture>y</picture></themed-picture>z</div>"
  },
  {
    "name": "element source in a div",
    "markdown": "<div>x<source>y</source>z</div>",
    "html": "<div>x<source>yz</div>"
  },
  {
    "name": "element track in a div",
    "markdown": "<div>x<track>y</track>z</div>",
    "html": "<div>xyz</div>"
  },
  {
    "name": "element label in a div",
    "markdown": "<div>x<label>y</label>z</div>",
    "html": "<div>xyz</div>"
  },
  {
    "name": "element textarea in a div",
    "markdown": "<div>x<textarea>y</textarea>z</div>",
    "html": "<div>x&lt;textarea&gt;y&lt;/textarea&gt;z</div>"
  },
  {
    "name": "element canvas in a div",
    "markdown": "<div>x<canvas>y</canvas>z</div>",
    "html": "<div>xyz</div>"
  },
  {
    "name": "element map in a div",
    "markdown": "<div>x<map>y</map>z</div>",
    "html": "<div>xyz</div>"
  },
  {
    "name": "element area in a div",
    "markdown": "<div>x<area>y</area>z</div>",
    "html": "<div>xyz</div>"
  },
  {
    "name": "element embed in a div",
    "markdown": "<div>x<embed>y</embed>z</div>",
    "html": "<div>xyz</div>"
  },
  {
    "name": "element font in a div",
    "markdown": "<div>x<font>y</font>z</div>",
    "html": "<div>xyz</div>"
  },
  {
    "name": "element b in a div",
    "markdown": "<div>x<b>y</b>z</div>",
    "html": "<div>x<b>y</b>z</div>"
  },
  {
    "name": "element i in a div",
    "markdown": "<div>x<i>y</i>z</div>",
    "html": "<div>x<i>y</i>z</div>"
  },
  {
    "name": "element u in a div",
    "markdown": "<div>x<u>y</u>z</div>",
    "html": "<div>xyz</div>"
  },
  {
    "name": "element tt in a div",
    "markdown": "<div>x<tt>y</tt>z</div>",
    "html": "<div>x<tt>y</tt>z</div>"
  },
  {
    "name": "element var in a div",
    "markdown": "<div>x<var>y</var>z</div>",
    "html": "<div>x<var>y</var>z</div>"
  },
  {
    "name": "element samp in a div",
    "markdown": "<div>x<samp>y</samp>z</div>",
    "html": "<div>x<samp>y</samp>z</div>"
  },
  {
    "name": "element cite in a div",
    "markdown": "<div>x<cite>y</cite>z</div>",
    "html": "<div>xyz</div>"
  },
  {
    "name": "element dfn in a div",
    "markdown": "<div>x<dfn>y</dfn>z</div>",
    "html": "<div>xyz</div>"
  },
  {
    "name": "element time in a div",
    "markdown": "<div>x<time>y</time>z</div>",
    "html": "<div>xyz</div>"
  },
  {
    "name": "element wbr in a div",
    "markdown": "<div>x<wbr>y</wbr>z</div>",
    "html": "<div>xyz</div>"
  },
  {
    "name": "element bdo in a div",
    "markdown": "<div>x<bdo>y</bdo>z</div>",
    "html": "<div>xyz</div>"
  },
  {
    "name": "element bdi in a div",
    "markdown": "<div>x<bdi>y</bdi>z</div>",
    "html": "<div>xyz</div>"
  },
  {
    "name": "element meter in a div",
    "markdown": "<div>x<meter>y</meter>z</div>",
    "html": "<div>xyz</div>"
  },
  {
    "name": "element progress in a div",
    "markdown": "<div>x<progress>y</progress>z</div>",
    "html": "<div>xyz</div>"
  },
  {
    "name": "element output in a div",
    "markdown": "<div>x<output>y</output>z</div>",
    "html": "<div>xyz</div>"
  },
  {
    "name": "element datalist in a div",
    "markdown": "<div>x<datalist>y</datalist>z</div>",
    "html": "<div>xyz</div>"
  },
  {
    "name": "element slot in a div",
    "markdown": "<div>x<slot>y</slot>z</div>",
    "html": "<div>xyz</div>"
  },
  {
    "name": "element frame in a div",
    "markdown": "<div>x<frame>y</frame>z</div>",
    "html": "<div>xyz</div>"
  },
  {
    "name": "element frameset in a div",
    "markdown": "<div>x<frameset>y</frameset>z</div>",
    "html": "<div>xyz</div>"
  },
  {
    "name": "element applet in a div",
    "markdown": "<div>x<applet>y</applet>z</div>",
    "html": "<div>xyz</div>"
  },
  {
    "name": "element marquee in a div",
    "markdown": "<div>x<marquee>y</marquee>z</div>",
    "html": "<div>xyz</div>"
  },
  {
    "name": "element blink in a div",
    "markdown": "<div>x<blink>y</blink>z</div>",
    "html": "<div>xyz</div>"
  },
  {
    "name": "element nobr in a div",
    "markdown": "<div>x<nobr>y</nobr>z</div>",
    "html": "<div>xyz</div>"
  },
  {
    "name": "element strike in a div",
    "markdown": "<div>x<strike>y</strike>z</div>",
    "html": "<div>x<strike>y</strike>z</div>"
  },
  {
    "name": "element big in a div",
    "markdown": "<div>x<big>y</big>z</div>",
    "html": "<div>xyz</div>"
  },
  {
    "name": "element acronym in a div",
    "markdown": "<div>x<acronym>y</acronym>z</div>",
    "html": "<div>xyz</div>"
  },
  {
    "name": "element script in a div",
    "markdown": "<div>x<script>y</script>z</div>",
    "html": "<div>x&lt;script&gt;y&lt;/script&gt;z</div>"
  },
  {
    "name": "element style in a div",
    "markdown": "<div>x<style>y</style>z</div>",
    "html": "<div>x&lt;style&gt;y&lt;/style&gt;z</div>"
  },
  {
    "name": "element title in a div",
    "markdown": "<div>x<title>y</title>z</div>",
    "html": "<div>x&lt;title&gt;y&lt;/title&gt;z</div>"
  },
  {
    "name": "element iframe in a div",
    "markdown": "<div>x<iframe>y</iframe>z</div>",
    "html": "<div>x&lt;iframe&gt;y&lt;/iframe&gt;z</div>"
  },
  {
    "name": "element noembed in a div",
    "markdown": "<div>x<noembed>y</noembed>z</div>",
    "html": "<div>x&lt;noembed&gt;y&lt;/noembed&gt;z</div>"
  },
  {
    "name": "element noframes in a div",
    "markdown": "<div>x<noframes>y</noframes>z</div>",
    "html": "<div>x&lt;noframes&gt;y&lt;/noframes&gt;z</div>"
  },
  {
    "name": "element html in a paragraph",
    "markdown": "A sh<html>y</html>all b.",
    "html": "<p>A shyall b.</p>"
  },
  {
    "name": "element body in a paragraph",
    "markdown": "A sh<body>y</body>all b.",
    "html": "<p>A shyall b.</p>"
  },
  {
    "name": "element address in a paragraph",
    "markdown": "A sh<address>y</address>all b.",
    "html": "<p>A sh</p>yall b.<p></p>"
  },
  {
    "name": "element blockquote in a paragraph",
    "markdown": "A sh<blockquote>y</blockquote>all b.",
    "html": "<p>A sh</p><blockquote>y</blockquote>all b.<p></p>"
  },
  {
    "name": "element center in a paragraph",
    "markdown": "A sh<center>y</center>all b.",
    "html": "<p>A sh</p>yall b.<p></p>"
  },
  {
    "name": "element dialog in a paragraph",
    "markdown": "A sh<dialog>y</dialog>all b.",
    "html": "<p>A shyall b.</p>"
  },
  {
    "name": "element div in a paragraph",
    "markdown": "A sh<div>y</div>all b.",
    "html": "<p>A sh</p><div>y</div>all b.<p></p>"
  },
  {
    "name": "element figure in a paragraph",
    "markdown": "A sh<figure>y</figure>all b.",
    "html": "<p>A sh</p>yall b.<p></p>"
  },
  {
    "name": "element figcaption in a paragraph",
    "markdown": "A sh<figcaption>y</figcaption>all b.",
    "html": "<p>A sh</p>yall b.<p></p>"
  },
  {
    "name": "element footer in a paragraph",
    "markdown": "A sh<footer>y</footer>all b.",
    "html": "<p>A sh</p>yall b.<p></p>"
  },
  {
    "name": "element form in a paragraph",
    "markdown": "A sh<form>y</form>all b.",
    "html": "<p>A sh</p>yall b.<p></p>"
  },
  {
    "name": "element header in a paragraph",
    "markdown": "A sh<header>y</header>all b.",
    "html": "<p>A sh</p>yall b.<p></p>"
  },
  {
    "name": "element hr in a paragraph",
    "markdown": "A sh<hr>y</hr>all b.",
    "html": "<p>A sh</p><hr>yall b.<p></p>"
  },
  {
    "name": "element legend in a paragraph",
    "markdown": "A sh<legend>y</legend>all b.",
    "html": "<p>A shyall b.</p>"
  },
  {
    "name": "element listing in a paragraph",
    "markdown": "A sh<listing>y</listing>all b.",
    "html": "<p>A sh</p>yall b.<p></p>"
  },
  {
    "name": "element main in a paragraph",
    "markdown": "A sh<main>y</main>all b.",
    "html": "<p>A sh</p>yall b.<p></p>"
  },
  {
    "name": "element p in a paragraph",
    "markdown": "A sh<p>y</p>all b.",
    "html": "<p>A sh</p><p>y</p>all b.<p></p>"
  },
  {
    "name": "element plaintext in a paragraph",
    "markdown": "A sh<plaintext>y</plaintext>all b.",
    "html": "<p>A sh&lt;plaintext&gt;y&lt;/plaintext&gt;all b.</p>"
  },
  {
    "name": "element pre in a paragraph",
    "markdown": "A sh<pre>y</pre>all b.",
    "html": "<p>A sh</p><pre class=\"notranslate\">y</pre>all b.<p></p>"
  },
  {
    "name": "element search in a paragraph",
    "markdown": "A sh<search>y</search>all b.",
    "html": "<p>A shyall b.</p>"
  },
  {
    "name": "element xmp in a paragraph",
    "markdown": "A sh<xmp>y</xmp>all b.",
    "html": "<p>A sh&lt;xmp&gt;y&lt;/xmp&gt;all b.</p>"
  },
  {
    "name": "element article in a paragraph",
    "markdown": "A sh<article>y</article>all b.",
    "html": "<p>A sh</p>yall b.<p></p>"
  },
  {
    "name": "element aside in a paragraph",
    "markdown": "A sh<aside>y</aside>all b.",
    "html": "<p>A sh</p>yall b.<p></p>"
  },
  {
    "name": "element h1 in a paragraph",
    "markdown": "A sh<h1>y</h1>all b.",
    "html": "<p>A sh</p><h1>y</h1>all b.<p></p>"
  },
  {
    "name": "element h2 in a paragraph",
    "markdown": "A sh<h2>y</h2>all b.",
    "html": "<p>A sh</p><h2>y</h2>all b.<p></p>"
  },
  {
    "name": "element h3 in a paragraph",
    "markdown": "A sh<h3>y</h3>all b.",
    "html": "<p>A sh</p><h3>y</h3>all b.<p></p>"
  },
  {
    "name": "element h4 in a paragraph",
    "markdown": "A sh<h4>y</h4>all b.",
    "html": "<p>A sh</p><h4>y</h4>all b.<p></p>"
  },
  {
    "name": "element h5 in a paragraph",
    "markdown": "A sh<h5>y</h5>all b.",
    "html": "<p>A sh</p><h5>y</h5>all b.<p></p>"
  },
  {
    "name": "element h6 in a paragraph",
    "markdown": "A sh<h6>y</h6>all b.",
    "html": "<p>A sh</p><h6>y</h6>all b.<p></p>"
  },
  {
    "name": "element hgroup in a paragraph",
    "markdown": "A sh<hgroup>y</hgroup>all b.",
    "html": "<p>A sh</p>yall b.<p></p>"
  },
  {
    "name": "element nav in a paragraph",
    "markdown": "A sh<nav>y</nav>all b.",
    "html": "<p>A sh</p>yall b.<p></p>"
  },
  {
    "name": "element section in a paragraph",
    "markdown": "A sh<section>y</section>all b.",
    "html": "<p>A sh</p><section>y</section>all b.<p></p>"
  },
  {
    "name": "element dir in a paragraph",
    "markdown": "A sh<dir>y</dir>all b.",
    "html": "<p>A sh</p>yall b.<p></p>"
  },
  {
    "name": "element dd in a paragraph",
    "markdown": "A sh<dd>y</dd>all b.",
    "html": "<p>A sh</p><dd>y</dd>all b.<p></p>"
  },
  {
    "name": "element dl in a paragraph",
    "markdown": "A sh<dl>y</dl>all b.",
    "html": "<p>A sh</p><dl>y</dl>all b.<p></p>"
  },
  {
    "name": "element dt in a paragraph",
    "markdown": "A sh<dt>y</dt>all b.",
    "html": "<p>A sh</p><dt>y</dt>all b.<p></p>"
  },
  {
    "name": "element menu in a paragraph",
    "markdown": "A sh<menu>y</menu>all b.",
    "html": "<p>A sh</p>yall b.<p></p>"
  },
  {
    "name": "element ol in a paragraph",
    "markdown": "A sh<ol>y</ol>all b.",
    "html": "<p>A sh</p><ol>y</ol>all b.<p></p>"
  },
  {
    "name": "element ul in a paragraph",
    "markdown": "A sh<ul>y</ul>all b.",
    "html": "<p>A sh</p><ul>y</ul>all b.<p></p>"
  },
  {
    "name": "element li in a paragraph",
    "markdown": "A sh<li>y</li>all b.",
    "html": "<p>A sh</p><li>y</li>all b.<p></p>"
  },
  {
    "name": "element fieldset in a paragraph",
    "markdown": "A sh<fieldset>y</fieldset>all b.",
    "html": "<p>A sh</p>yall b.<p></p>"
  },
  {
    "name": "element details in a paragraph",
    "markdown": "A sh<details>y</details>all b.",
    "html": "<p>A sh</p><details><summary>Details</summary>y</details>all b.<p></p>",
    "differsFromGitHub": "GitHub adds a summary reading \"Details\" to a details element that has none."
  },
  {
    "name": "element summary in a paragraph",
    "markdown": "A sh<summary>y</summary>all b.",
    "html": "<p>A sh</p><summary>y</summary>all b.<p></p>"
  },
  {
    "name": "element option in a paragraph",
    "markdown": "A sh<option>y</option>all b.",
    "html": "<p>A shyall b.</p>"
  },
  {
    "name": "element optgroup in a paragraph",
    "markdown": "A sh<optgroup>y</optgroup>all b.",
    "html": "<p>A shyall b.</p>"
  },
  {
    "name": "element table in a paragraph",
    "markdown": "A sh<table>y</table>all b.",
    "html": "<p>A sh</p>y<markdown-accessiblity-table><table role=\"table\"></table></markdown-accessiblity-table>all b.<p></p>"
  },
  {
    "name": "element caption in a paragraph",
    "markdown": "A sh<caption>y</caption>all b.",
    "html": "<p>A shyall b.</p>"
  },
  {
    "name": "element colgroup in a paragraph",
    "markdown": "A sh<colgroup>y</colgroup>all b.",
    "html": "<p>A shyall b.</p>"
  },
  {
    "name": "element col in a paragraph",
    "markdown": "A sh<col>y</col>all b.",
    "html": "<p>A shyall b.</p>"
  },
  {
    "name": "element thead in a paragraph",
    "markdown": "A sh<thead>y</thead>all b.",
    "html": "<p>A shyall b.</p>"
  },
  {
    "name": "element tbody in a paragraph",
    "markdown": "A sh<tbody>y</tbody>all b.",
    "html": "<p>A shyall b.</p>"
  },
  {
    "name": "element tfoot in a paragraph",
    "markdown": "A sh<tfoot>y</tfoot>all b.",
    "html": "<p>A shyall b.</p>"
  },
  {
    "name": "element tr in a paragraph",
    "markdown": "A sh<tr>y</tr>all b.",
    "html": "<p>A shyall b.</p>"
  },
  {
    "name": "element td in a paragraph",
    "markdown": "A sh<td>y</td>all b.",
    "html": "<p>A shyall b.</p>"
  },
  {
    "name": "element th in a paragraph",
    "markdown": "A sh<th>y</th>all b.",
    "html": "<p>A shyall b.</p>"
  },
  {
    "name": "element br in a paragraph",
    "markdown": "A sh<br>y</br>all b.",
    "html": "<p>A sh<br>y<br>all b.</p>"
  },
  {
    "name": "element video in a paragraph",
    "markdown": "A sh<video>y</video>all b.",
    "html": "<p>A sh<video>y</video>all b.</p>"
  },
  {
    "name": "element audio in a paragraph",
    "markdown": "A sh<audio>y</audio>all b.",
    "html": "<p>A shyall b.</p>"
  },
  {
    "name": "element rp in a paragraph",
    "markdown": "A sh<rp>y</rp>all b.",
    "html": "<p>A sh<rp>y</rp>all b.</p>"
  },
  {
    "name": "element rt in a paragraph",
    "markdown": "A sh<rt>y</rt>all b.",
    "html": "<p>A sh<rt>y</rt>all b.</p>"
  },
  {
    "name": "element ruby in a paragraph",
    "markdown": "A sh<ruby>y</ruby>all b.",
    "html": "<p>A sh<ruby>y</ruby>all b.</p>"
  },
  {
    "name": "element template in a paragraph",
    "markdown": "A sh<template>y</template>all b.",
    "html": "<p>A shyall b.</p>"
  },
  {
    "name": "element input in a paragraph",
    "markdown": "A sh<input>y</input>all b.",
    "html": "<p>A shyall b.</p>"
  },
  {
    "name": "element button in a paragraph",
    "markdown": "A sh<button>y</button>all b.",
    "html": "<p>A shyall b.</p>"
  },
  {
    "name": "element select in a paragraph",
    "markdown": "A sh<select>y</select>all b.",
    "html": "<p>A shyall b.</p>"
  },
  {
    "name": "element object in a paragraph",
    "markdown": "A sh<object>y</object>all b.",
    "html": "<p>A shyall b.</p>"
  },
  {
    "name": "element math in a paragraph",
    "markdown": "A sh<math>y</math>all b.",
    "html": "<p>A shyall b.</p>"
  },
  {
    "name": "element svg in a paragraph",
    "markdown": "A sh<svg>y</svg>all b.",
    "html": "<p>A shyall b.</p>"
  },
  {
    "name": "element noscript in a paragraph",
    "markdown": "A sh<noscript>y</noscript>all b.",
    "html": "<p>A shyall b.</p>"
  },
  {
    "name": "element span in a paragraph",
    "markdown": "A sh<span>y</span>all b.",
    "html": "<p>A sh<span>y</span>all b.</p>"
  },
  {
    "name": "element em in a paragraph",
    "markdown": "A sh<em>y</em>all b.",
    "html": "<p>A sh<em>y</em>all b.</p>"
  },
  {
    "name": "element strong in a paragraph",
    "markdown": "A sh<strong>y</strong>all b.",
    "html": "<p>A sh<strong>y</strong>all b.</p>"
  },
  {
    "name": "element a in a paragraph",
    "markdown": "A sh<a>y</a>all b.",
    "html": "<p>A shyall b.</p>"
  },
  {
    "name": "element img in a paragraph",
    "markdown": "A sh<img>y</img>all b.",
    "html": "<p>A sh<a target=\"_blank\" rel=\"noopener noreferrer\" href=\"\"><img style=\"max-width: 100%;\"></a>yall b.</p>"
  },
  {
    "name": "element code in a paragraph",
    "markdown": "A sh<code>y</code>all b.",
    "html": "<p>A sh<code class=\"notranslate\">y</code>all b.</p>"
  },
  {
    "name": "element kbd in a paragraph",
    "markdown": "A sh<kbd>y</kbd>all b.",
    "html": "<p>A sh<kbd>y</kbd>all b.</p>"
  },
  {
    "name": "element sup in a paragraph",
    "markdown": "A sh<sup>y</sup>all b.",
    "html": "<p>A sh<sup>y</sup>all b.</p>"
  },
  {
    "name": "element sub in a paragraph",
    "markdown": "A sh<sub>y</sub>all b.",
    "html": "<p>A sh<sub>y</sub>all b.</p>"
  },
  {
    "name": "element ins in a paragraph",
    "markdown": "A sh<ins>y</ins>all b.",
    "html": "<p>A sh<ins>y</ins>all b.</p>"
  },
  {
    "name": "element del in a paragraph",
    "markdown": "A sh<del>y</del>all b.",
    "html": "<p>A sh<del>y</del>all b.</p>"
  },
  {
    "name": "element s in a paragraph",
    "markdown": "A sh<s>y</s>all b.",
    "html": "<p>A sh<s>y</s>all b.</p>"
  },
  {
    "name": "element q in a paragraph",
    "markdown": "A sh<q>y</q>all b.",
    "html": "<p>A sh<q>y</q>all b.</p>"
  },
  {
    "name": "element abbr in a paragraph",
    "markdown": "A sh<abbr>y</abbr>all b.",
    "html": "<p>A shyall b.</p>"
  },
  {
    "name": "element mark in a paragraph",
    "markdown": "A sh<mark>y</mark>all b.",
    "html": "<p>A sh<mark>y</mark>all b.</p>"
  },
  {
    "name": "element small in a paragraph",
    "markdown": "A sh<small>y</small>all b.",
    "html": "<p>A shyall b.</p>"
  },
  {
    "name": "element picture in a paragraph",
    "markdown": "A sh<picture>y</picture>all b.",
    "html": "<p>A sh<themed-picture data-catalyst-inline=\"true\"><picture>y</picture></themed-picture>all b.</p>"
  },
  {
    "name": "element source in a paragraph",
    "markdown": "A sh<source>y</source>all b.",
    "html": "<p>A sh<source>yall b.</p>"
  },
  {
    "name": "element track in a paragraph",
    "markdown": "A sh<track>y</track>all b.",
    "html": "<p>A shyall b.</p>"
  },
  {
    "name": "element label in a paragraph",
    "markdown": "A sh<label>y</label>all b.",
    "html": "<p>A shyall b.</p>"
  },
  {
    "name": "element textarea in a paragraph",
    "markdown": "A sh<textarea>y</textarea>all b.",
    "html": "<p>A sh&lt;textarea&gt;y&lt;/textarea&gt;all b.</p>"
  },
  {
    "name": "element canvas in a paragraph",
    "markdown": "A sh<canvas>y</canvas>all b.",
    "html": "<p>A shyall b.</p>"
  },
  {
    "name": "element map in a paragraph",
    "markdown": "A sh<map>y</map>all b.",
    "html": "<p>A shyall b.</p>"
  },
  {
    "name": "element area in a paragraph",
    "markdown": "A sh<area>y</area>all b.",
    "html": "<p>A shyall b.</p>"
  },
  {
    "name": "element embed in a paragraph",
    "markdown": "A sh<embed>y</embed>all b.",
    "html": "<p>A shyall b.</p>"
  },
  {
    "name": "element font in a paragraph",
    "markdown": "A sh<font>y</font>all b.",
    "html": "<p>A shyall b.</p>"
  },
  {
    "name": "element b in a paragraph",
    "markdown": "A sh<b>y</b>all b.",
    "html": "<p>A sh<b>y</b>all b.</p>"
  },
  {
    "name": "element i in a paragraph",
    "markdown": "A sh<i>y</i>all b.",
    "html": "<p>A sh<i>y</i>all b.</p>"
  },
  {
    "name": "element u in a paragraph",
    "markdown": "A sh<u>y</u>all b.",
    "html": "<p>A shyall b.</p>"
  },
  {
    "name": "element tt in a paragraph",
    "markdown": "A sh<tt>y</tt>all b.",
    "html": "<p>A sh<tt>y</tt>all b.</p>"
  },
  {
    "name": "element var in a paragraph",
    "markdown": "A sh<var>y</var>all b.",
    "html": "<p>A sh<var>y</var>all b.</p>"
  },
  {
    "name": "element samp in a paragraph",
    "markdown": "A sh<samp>y</samp>all b.",
    "html": "<p>A sh<samp>y</samp>all b.</p>"
  },
  {
    "name": "element cite in a paragraph",
    "markdown": "A sh<cite>y</cite>all b.",
    "html": "<p>A shyall b.</p>"
  },
  {
    "name": "element dfn in a paragraph",
    "markdown": "A sh<dfn>y</dfn>all b.",
    "html": "<p>A shyall b.</p>"
  },
  {
    "name": "element time in a paragraph",
    "markdown": "A sh<time>y</time>all b.",
    "html": "<p>A shyall b.</p>"
  },
  {
    "name": "element wbr in a paragraph",
    "markdown": "A sh<wbr>y</wbr>all b.",
    "html": "<p>A shyall b.</p>"
  },
  {
    "name": "element bdo in a paragraph",
    "markdown": "A sh<bdo>y</bdo>all b.",
    "html": "<p>A shyall b.</p>"
  },
  {
    "name": "element bdi in a paragraph",
    "markdown": "A sh<bdi>y</bdi>all b.",
    "html": "<p>A shyall b.</p>"
  },
  {
    "name": "element meter in a paragraph",
    "markdown": "A sh<meter>y</meter>all b.",
    "html": "<p>A shyall b.</p>"
  },
  {
    "name": "element progress in a paragraph",
    "markdown": "A sh<progress>y</progress>all b.",
    "html": "<p>A shyall b.</p>"
  },
  {
    "name": "element output in a paragraph",
    "markdown": "A sh<output>y</output>all b.",
    "html": "<p>A shyall b.</p>"
  },
  {
    "name": "element datalist in a paragraph",
    "markdown": "A sh<datalist>y</datalist>all b.",
    "html": "<p>A shyall b.</p>"
  },
  {
    "name": "element slot in a paragraph",
    "markdown": "A sh<slot>y</slot>all b.",
    "html": "<p>A shyall b.</p>"
  },
  {
    "name": "element frame in a paragraph",
    "markdown": "A sh<frame>y</frame>all b.",
    "html": "<p>A shyall b.</p>"
  },
  {
    "name": "element frameset in a paragraph",
    "markdown": "A sh<frameset>y</frameset>all b.",
    "html": "<p>A shyall b.</p>"
  },
  {
    "name": "element applet in a paragraph",
    "markdown": "A sh<applet>y</applet>all b.",
    "html": "<p>A shyall b.</p>"
  },
  {
    "name": "element marquee in a paragraph",
    "markdown": "A sh<marquee>y</marquee>all b.",
    "html": "<p>A shyall b.</p>"
  },
  {
    "name": "element blink in a paragraph",
    "markdown": "A sh<blink>y</blink>all b.",
    "html": "<p>A shyall b.</p>"
  },
  {
    "name": "element nobr in a paragraph",
    "markdown": "A sh<nobr>y</nobr>all b.",
    "html": "<p>A shyall b.</p>"
  },
  {
    "name": "element strike in a paragraph",
    "markdown": "A sh<strike>y</strike>all b.",
    "html": "<p>A sh<strike>y</strike>all b.</p>"
  },
  {
    "name": "element big in a paragraph",
    "markdown": "A sh<big>y</big>all b.",
    "html": "<p>A shyall b.</p>"
  },
  {
    "name": "element acronym in a paragraph",
    "markdown": "A sh<acronym>y</acronym>all b.",
    "html": "<p>A shyall b.</p>"
  },
  {
    "name": "element script in a paragraph",
    "markdown": "A sh<script>y</script>all b.",
    "html": "<p>A sh&lt;script&gt;y&lt;/script&gt;all b.</p>"
  },
  {
    "name": "element style in a paragraph",
    "markdown": "A sh<style>y</style>all b.",
    "html": "<p>A sh&lt;style&gt;y&lt;/style&gt;all b.</p>"
  },
  {
    "name": "element title in a paragraph",
    "markdown": "A sh<title>y</title>all b.",
    "html": "<p>A sh&lt;title&gt;y&lt;/title&gt;all b.</p>"
  },
  {
    "name": "element iframe in a paragraph",
    "markdown": "A sh<iframe>y</iframe>all b.",
    "html": "<p>A sh&lt;iframe&gt;y&lt;/iframe&gt;all b.</p>"
  },
  {
    "name": "element noembed in a paragraph",
    "markdown": "A sh<noembed>y</noembed>all b.",
    "html": "<p>A sh&lt;noembed&gt;y&lt;/noembed&gt;all b.</p>"
  },
  {
    "name": "element noframes in a paragraph",
    "markdown": "A sh<noframes>y</noframes>all b.",
    "html": "<p>A sh&lt;noframes&gt;y&lt;/noframes&gt;all b.</p>"
  },
  {
    "name": "emphasis inside a word",
    "markdown": "We sh*all* pay.",
    "html": "<p>We sh<em>all</em> pay.</p>"
  },
  {
    "name": "strong emphasis around a word",
    "markdown": "We act in **order** to help.",
    "html": "<p>We act in <strong>order</strong> to help.</p>"
  },
  {
    "name": "underscores inside a word",
    "markdown": "We sh_all_ pay.",
    "html": "<p>We sh_all_ pay.</p>"
  },
  {
    "name": "strikethrough",
    "markdown": "We ~~shall~~ pay.",
    "html": "<p>We <del>shall</del> pay.</p>"
  },
  {
    "name": "bogus comment in a raw HTML block",
    "markdown": "<div>We sh<!x>all pay.</div>",
    "html": "<div>We shall pay.</div>"
  },
  {
    "name": "tag written with a slash",
    "markdown": "<div>We sh<em/all>all pay.</div>",
    "html": "<div>We sh<em>all pay.</em></div>"
  },
  {
    "name": "script after a paragraph",
    "markdown": "A plain paragraph.\n\n<script>We shall pay.</script>",
    "html": "<p>A plain paragraph.</p>\n&lt;script&gt;We shall pay.&lt;/script&gt;"
  },
  {
    "name": "script tag the filter does not name",
    "markdown": "<div><script/x>Plain words.</script></div>",
    "html": "<div></div>"
  },
  {
    "name": "script left open across blocks",
    "markdown": "<div><script/x>hidden</div>\n\nAfter.",
    "html": "<div></div>"
  },
  {
    "name": "style tag the filter does not name",
    "markdown": "<div>a<style/x>b</style>c</div>",
    "html": "<div>ab&amp;lt;/style&gt;c&lt;/div&gt;</div>",
    "differsFromGitHub": "A style element the tag filter does not name runs to the end of the document, and GitHub shows its text undecoded."
  },
  {
    "name": "video fallback alone",
    "markdown": "<video>Plain words.</video>",
    "html": "<p><video>Plain words.</video></p>"
  },
  {
    "name": "video around blank lines",
    "markdown": "<video>\n\nHidden words.\n\n</video>",
    "html": "<video>\n<p>Hidden words.</p>\n</video>"
  },
  {
    "name": "video opened inside a paragraph",
    "markdown": "A <video> b\n\nC visible.",
    "html": "<p>A <video> b</video></p>\n<p>C visible.</p>"
  },
  {
    "name": "audio around blank lines",
    "markdown": "<audio>\n\nAudio words.\n\n</audio>",
    "html": "<p>Audio words.</p>"
  },
  {
    "name": "ruby with an omitted rp end tag",
    "markdown": "<ruby><rp>(<rt>This change works.</rt></ruby>",
    "html": "<p><ruby><rp>(</rp><rt>This change works.</rt></ruby></p>"
  },
  {
    "name": "ruby with rp around rt",
    "markdown": "<ruby>a<rp>(</rp><rt>b</rt><rp>)</rp></ruby>",
    "html": "<p><ruby>a<rp>(</rp><rt>b</rt><rp>)</rp></ruby></p>"
  },
  {
    "name": "reference split by a tag",
    "markdown": "<div>&nb<em>sp;</em></div>",
    "html": "<div>&amp;nb<em>sp;</em></div>"
  },
  {
    "name": "quotation marks written as references",
    "markdown": "Replace &quot;shall&quot; with &quot;must&quot;.",
    "html": "<p>Replace \"shall\" with \"must\".</p>"
  },
  {
    "name": "numeric reference without a semicolon in HTML",
    "markdown": "<div>We sh&#97ll pay.</div>",
    "html": "<div>We shall pay.</div>"
  },
  {
    "name": "numeric reference without a semicolon in text",
    "markdown": "We sh&#97ll pay.",
    "html": "<p>We sh&amp;#97ll pay.</p>"
  },
  {
    "name": "zero-padded space in HTML",
    "markdown": "<div>&#00000032;</div>",
    "html": "<div> </div>"
  },
  {
    "name": "leading rule block",
    "markdown": "---\nnote: The tenant shall pay.\n---",
    "html": "<hr>\n<h2>note: The tenant shall pay.</h2>"
  },
  {
    "name": "comment inside a word",
    "markdown": "We sh<!-- x -->all pay.",
    "html": "<p>We shall pay.</p>"
  },
  {
    "name": "six paragraphs in one HTML block",
    "markdown": "<p>One.</p>\n<p>Two.</p>\n<p>Three.</p>\n<p>Four.</p>\n<p>Five.</p>\n<p>Six.</p>",
    "html": "<p>One.</p>\n<p>Two.</p>\n<p>Three.</p>\n<p>Four.</p>\n<p>Five.</p>\n<p>Six.</p>"
  },
  {
    "name": "table with a caption",
    "markdown": "<table><thead><tr><th>h1</th><th>h2</th></tr></thead><tbody><tr><td>c1</td><td>c2</td></tr></tbody><caption>cap</caption></table>",
    "html": "<markdown-accessiblity-table>cap<table role=\"table\"><thead><tr><th>h1</th><th>h2</th></tr></thead><tbody><tr><td>c1</td><td>c2</td></tr></tbody></table></markdown-accessiblity-table>",
    "differsFromGitHub": "Text written inside a table but outside any cell, or in a caption, is moved in front of the table by the HTML parser. This engine reads it where it is written."
  },
  {
    "name": "unused footnote",
    "markdown": "[^1]: Plain words.",
    "html": ""
  },
  {
    "name": "used footnote",
    "markdown": "Text[^1].\n\n[^1]: Plain words.",
    "html": "<p>Text<sup><a href=\"#user-content-fn-1-514c15e5d7abde7129b1c0b74e29c708\" id=\"user-content-fnref-1-514c15e5d7abde7129b1c0b74e29c708\" data-footnote-ref=\"\" aria-describedby=\"footnote-label\">1</a></sup>.</p>\n<section data-footnotes=\"\" class=\"footnotes\"><h2 id=\"footnote-label\" class=\"sr-only\">Footnotes</h2>\n<ol>\n<li id=\"user-content-fn-1-514c15e5d7abde7129b1c0b74e29c708\">\n<p>Plain words. <a href=\"#user-content-fnref-1-514c15e5d7abde7129b1c0b74e29c708\" data-footnote-backref=\"\" aria-label=\"Back to reference 1\" class=\"data-footnote-backref\">↩</a></p>\n</li>\n</ol>\n</section>",
    "differsFromGitHub": "GitHub renders a used footnote at the foot of the page with its number and a link back. The rules read its body where it is written."
  },
  {
    "name": "footnote reference with no definition",
    "markdown": "A[^x] b.",
    "html": "<p>A[^x] b.</p>"
  },
  {
    "name": "heading holding a banned word",
    "markdown": "## The tenant shall pay",
    "html": "<h2>The tenant shall pay</h2>"
  },
  {
    "name": "code span holding a tag",
    "markdown": "Run `sh<script>x</script>all` now.",
    "html": "<p>Run <code class=\"notranslate\">sh&lt;script&gt;x&lt;/script&gt;all</code> now.</p>"
  },
  {
    "name": "image with alternative text",
    "markdown": "![alt words](i.png)",
    "html": "<p><a target=\"_blank\" rel=\"noopener noreferrer\" href=\"i.png\"><img src=\"i.png\" alt=\"alt words\" style=\"max-width: 100%;\"></a></p>"
  },
  {
    "name": "link with a title",
    "markdown": "Read [the guide](/uri \"a title\") now.",
    "html": "<p>Read <a href=\"/uri\" title=\"a title\">the guide</a> now.</p>"
  },
  {
    "name": "block tag after a closed paragraph",
    "markdown": "<p>A.</p>\n<div>We sh<address></address>all pay.</div>",
    "html": "<p>A.</p>\n<div>We shall pay.</div>"
  },
  {
    "name": "table cell after a closed table",
    "markdown": "<table><tr><td>a</td></tr></table>\n<div>We sh<td></td>all pay.</div>",
    "html": "<markdown-accessiblity-table><table role=\"table\"><tbody><tr><td>a</td></tr></tbody></table></markdown-accessiblity-table>\n<div>We shall pay.</div>"
  },
  {
    "name": "block tag inside an open paragraph",
    "markdown": "<p>We sh<address></address>all pay.</p>",
    "html": "<p>We sh</p>all pay.<p></p>"
  },
  {
    "name": "block tag after a paragraph's end tag",
    "markdown": "<p>A.</p>\nWe sh<address></address>all pay.",
    "html": "<p>A.</p>\nWe shall pay."
  },
  {
    "name": "footnote referred to only in an attribute",
    "markdown": "<span title=\"[^a]\"></span>\n\n[^a]: Plain words.",
    "html": "<p><span title=\"[^a]\"></span></p>"
  },
  {
    "name": "footnote referred to only in code",
    "markdown": "Use `[^a]` here.\n\n[^a]: The tenant shall pay.",
    "html": "<p>Use <code class=\"notranslate\">[^a]</code> here.</p>"
  },
  {
    "name": "footnote with a second paragraph",
    "markdown": "Read the note[^a].\n\n[^a]: First paragraph.\n\n    The tenant shall pay.",
    "html": "<p>Read the note<sup><a href=\"#user-content-fn-a-f7de79404cb14feb6958406c51d06697\" id=\"user-content-fnref-a-f7de79404cb14feb6958406c51d06697\" data-footnote-ref=\"\" aria-describedby=\"footnote-label\">1</a></sup>.</p>\n<section data-footnotes=\"\" class=\"footnotes\"><h2 id=\"footnote-label\" class=\"sr-only\">Footnotes</h2>\n<ol>\n<li id=\"user-content-fn-a-f7de79404cb14feb6958406c51d06697\">\n<p>First paragraph.</p>\n<p>The tenant shall pay. <a href=\"#user-content-fnref-a-f7de79404cb14feb6958406c51d06697\" data-footnote-backref=\"\" aria-label=\"Back to reference 1\" class=\"data-footnote-backref\">↩</a></p>\n</li>\n</ol>\n</section>",
    "differsFromGitHub": "GitHub renders a used footnote at the foot of the page with its number and a link back. The rules read its body where it is written."
  },
  {
    "name": "six paragraphs on one line",
    "markdown": "<p>One sentence here.</p><p>Two here.</p><p>Three here.</p><p>Four here.</p><p>Five here.</p><p>Six here.</p>",
    "html": "<p>One sentence here.</p><p>Two here.</p><p>Three here.</p><p>Four here.</p><p>Five here.</p><p>Six here.</p>"
  },
  {
    "name": "word joiner inside a word",
    "markdown": "The tenant sh&#8288;all pay.",
    "html": "<p>The tenant sh⁠all pay.</p>"
  },
  {
    "name": "soft hyphen inside a word",
    "markdown": "The tenant sh&shy;all pay.",
    "html": "<p>The tenant sh­all pay.</p>"
  },
  {
    "name": "zero-width space inside a word",
    "markdown": "The tenant sh&#8203;all pay.",
    "html": "<p>The tenant sh​all pay.</p>"
  },
  {
    "name": "section inside a div",
    "markdown": "<div>We <section>shall</section>pay.</div>",
    "html": "<div>We <section>shall</section>pay.</div>"
  },
  {
    "name": "video left open in a quotation",
    "markdown": "> <video>\n\nThe tenant shall pay.",
    "html": "<blockquote>\n<video>\n</video></blockquote>\n<p>The tenant shall pay.</p>"
  },
  {
    "name": "video left open in a list item",
    "markdown": "- <video>\n\nThe tenant shall pay.",
    "html": "<ul>\n<li>\n<video>\n</video></li>\n</ul>\n<p>The tenant shall pay.</p>"
  },
  {
    "name": "unused footnote holding a heading",
    "markdown": "[^a]: Plain words.\n\n    # Plain heading",
    "html": ""
  },
  {
    "name": "escaped footnote reference",
    "markdown": "Read \\[^a].\n\n[^a]: The tenant shall pay.",
    "html": "<p>Read [^a].</p>"
  },
  {
    "name": "footnote reference written as a character reference",
    "markdown": "Read &#91;^a].\n\n[^a]: The tenant shall pay.",
    "html": "<p>Read [^a].</p>"
  },
  {
    "name": "footnote reference in a raw HTML block",
    "markdown": "<div>Read [^a].</div>\n\n[^a]: The tenant shall pay.",
    "html": "<div>Read [^a].</div>"
  },
  {
    "name": "footnote reference in a link destination",
    "markdown": "Read [x](/[^a]).\n\n[^a]: The tenant shall pay.",
    "html": "<p>Read <a href=\"/%5B%5Ea%5D\">x</a>.</p>"
  },
  {
    "name": "footnote reference inside a comment",
    "markdown": "&#32;<!-- [^a] -->\n\n[^a]: This change works.",
    "html": "<p> </p>"
  },
  {
    "name": "footnote label that case-folds",
    "markdown": "This change works.[^SS]\n\n[^ß]: We shall pay.",
    "html": "<p>This change works.<sup><a href=\"#user-content-fn-%C3%9F-f6cfe1f2ef76bbdcb9080095c2459063\" id=\"user-content-fnref-%c3%9f-f6cfe1f2ef76bbdcb9080095c2459063\" data-footnote-ref=\"\" aria-describedby=\"footnote-label\">1</a></sup></p>\n<section data-footnotes=\"\" class=\"footnotes\"><h2 id=\"footnote-label\" class=\"sr-only\">Footnotes</h2>\n<ol>\n<li id=\"user-content-fn-%C3%9F-f6cfe1f2ef76bbdcb9080095c2459063\">\n<p>We shall pay. <a href=\"#user-content-fnref-%C3%9F-f6cfe1f2ef76bbdcb9080095c2459063\" data-footnote-backref=\"\" aria-label=\"Back to reference 1\" class=\"data-footnote-backref\">↩</a></p>\n</li>\n</ol>\n</section>",
    "differsFromGitHub": "GitHub renders a used footnote at the foot of the page with its number and a link back. The rules read its body where it is written."
  },
  {
    "name": "footnote defined twice",
    "markdown": "This change works.[^a]\n\n[^a]: It works.\n\n[^a]: We shall pay.",
    "html": "<p>This change works.<sup><a href=\"#user-content-fn-a-eb3bb8f87f0a3eb2ea66dfdcd9e0712e\" id=\"user-content-fnref-a-eb3bb8f87f0a3eb2ea66dfdcd9e0712e\" data-footnote-ref=\"\" aria-describedby=\"footnote-label\">1</a></sup></p>\n<section data-footnotes=\"\" class=\"footnotes\"><h2 id=\"footnote-label\" class=\"sr-only\">Footnotes</h2>\n<ol>\n<li id=\"user-content-fn-a-eb3bb8f87f0a3eb2ea66dfdcd9e0712e\">\n<p>It works. <a href=\"#user-content-fnref-a-eb3bb8f87f0a3eb2ea66dfdcd9e0712e\" data-footnote-backref=\"\" aria-label=\"Back to reference 1\" class=\"data-footnote-backref\">↩</a></p>\n</li>\n</ol>\n</section>",
    "differsFromGitHub": "GitHub renders a used footnote at the foot of the page with its number and a link back. The rules read its body where it is written."
  },
  {
    "name": "ruby nested inside rp",
    "markdown": "<ruby><rp><ruby></ruby>This change works.</rp></ruby>",
    "html": "<p><ruby><rp><ruby></ruby>This change works.</rp></ruby></p>"
  },
  {
    "name": "footnote reference after an abrupt comment",
    "markdown": "&#32;<!-->[^a]\n\n[^a]: The tenant shall pay.",
    "html": "<p> <sup><a href=\"#user-content-fn-a-7b0d906084014765a61bebacd0df0ed5\" id=\"user-content-fnref-a-7b0d906084014765a61bebacd0df0ed5\" data-footnote-ref=\"\" aria-describedby=\"footnote-label\">1</a></sup></p>\n<section data-footnotes=\"\" class=\"footnotes\"><h2 id=\"footnote-label\" class=\"sr-only\">Footnotes</h2>\n<ol>\n<li id=\"user-content-fn-a-7b0d906084014765a61bebacd0df0ed5\">\n<p>The tenant shall pay. <a href=\"#user-content-fnref-a-7b0d906084014765a61bebacd0df0ed5\" data-footnote-backref=\"\" aria-label=\"Back to reference 1\" class=\"data-footnote-backref\">↩</a></p>\n</li>\n</ol>\n</section>",
    "differsFromGitHub": "GitHub renders a used footnote at the foot of the page with its number and a link back. The rules read its body where it is written."
  },
  {
    "name": "footnote reference inside a processing instruction",
    "markdown": "&#32;<? [^a] ?>\n\n[^a]: The tenant shall pay.",
    "html": "<p> </p>"
  },
  {
    "name": "footnote reference inside a declaration",
    "markdown": "&#32;<!X [^a]>\n\n[^a]: The tenant shall pay.",
    "html": "<p> </p>"
  },
  {
    "name": "footnote reference inside CDATA",
    "markdown": "&#32;<![CDATA[ [^a] ]]>\n\n[^a]: The tenant shall pay.",
    "html": "<p> </p>"
  },
  {
    "name": "footnote reference after an unclosed comment",
    "markdown": "Read <!-- [^a]\n\n[^a]: The tenant shall pay.",
    "html": "<p>Read &lt;!-- <sup><a href=\"#user-content-fn-a-120bec82139d5f86dbf5d5be6e5049e7\" id=\"user-content-fnref-a-120bec82139d5f86dbf5d5be6e5049e7\" data-footnote-ref=\"\" aria-describedby=\"footnote-label\">1</a></sup></p>\n<section data-footnotes=\"\" class=\"footnotes\"><h2 id=\"footnote-label\" class=\"sr-only\">Footnotes</h2>\n<ol>\n<li id=\"user-content-fn-a-120bec82139d5f86dbf5d5be6e5049e7\">\n<p>The tenant shall pay. <a href=\"#user-content-fnref-a-120bec82139d5f86dbf5d5be6e5049e7\" data-footnote-backref=\"\" aria-label=\"Back to reference 1\" class=\"data-footnote-backref\">↩</a></p>\n</li>\n</ol>\n</section>",
    "differsFromGitHub": "GitHub renders a used footnote at the foot of the page with its number and a link back. The rules read its body where it is written."
  },
  {
    "name": "footnote reference in text that only looks like a link",
    "markdown": "Read [the guide](bad [^a]).\n\n[^a]: The tenant shall pay.",
    "html": "<p>Read [the guide](bad <sup><a href=\"#user-content-fn-a-c4106e14e2eb34fb3d6178bfbcf2d795\" id=\"user-content-fnref-a-c4106e14e2eb34fb3d6178bfbcf2d795\" data-footnote-ref=\"\" aria-describedby=\"footnote-label\">1</a></sup>).</p>\n<section data-footnotes=\"\" class=\"footnotes\"><h2 id=\"footnote-label\" class=\"sr-only\">Footnotes</h2>\n<ol>\n<li id=\"user-content-fn-a-c4106e14e2eb34fb3d6178bfbcf2d795\">\n<p>The tenant shall pay. <a href=\"#user-content-fnref-a-c4106e14e2eb34fb3d6178bfbcf2d795\" data-footnote-backref=\"\" aria-label=\"Back to reference 1\" class=\"data-footnote-backref\">↩</a></p>\n</li>\n</ol>\n</section>",
    "differsFromGitHub": "GitHub renders a used footnote at the foot of the page with its number and a link back. The rules read its body where it is written."
  },
  {
    "name": "footnote reference in a destination with nested parentheses",
    "markdown": "[&#8203;](https://example.com/a(b)[^x])\n\n[^x]: This change works.",
    "html": "<p><a href=\"https://example.com/a(b)%5B%5Ex%5D\" rel=\"nofollow\">​</a></p>"
  },
  {
    "name": "dotless i kept apart from i",
    "markdown": "Read the note[^i].\n\n[^ı]: This change works.\n\n[^i]: The tenant shall pay.",
    "html": "<p>Read the note<sup><a href=\"#user-content-fn-i-a0dca3b8d2687532602b28faeff73121\" id=\"user-content-fnref-i-a0dca3b8d2687532602b28faeff73121\" data-footnote-ref=\"\" aria-describedby=\"footnote-label\">1</a></sup>.</p>\n<section data-footnotes=\"\" class=\"footnotes\"><h2 id=\"footnote-label\" class=\"sr-only\">Footnotes</h2>\n<ol>\n<li id=\"user-content-fn-i-a0dca3b8d2687532602b28faeff73121\">\n<p>The tenant shall pay. <a href=\"#user-content-fnref-i-a0dca3b8d2687532602b28faeff73121\" data-footnote-backref=\"\" aria-label=\"Back to reference 1\" class=\"data-footnote-backref\">↩</a></p>\n</li>\n</ol>\n</section>",
    "differsFromGitHub": "GitHub renders a used footnote at the foot of the page with its number and a link back. The rules read its body where it is written."
  },
  {
    "name": "rp left open by a raw HTML block",
    "markdown": "This change works.\n\n<rp>\n\nThe tenant shall pay.",
    "html": "<p>This change works.</p>\n<rp>\n<p>The tenant shall pay.</p></rp>"
  },
  {
    "name": "stand-in fragment written in an attribute",
    "markdown": "<span href=\"#fn0\" title=\"[^a]\"></span>\n\n[^a]: This change works.",
    "html": "<p><span title=\"[^a]\"></span></p>"
  },
  {
    "name": "plain link to a stand-in fragment",
    "markdown": "Read [the note](#fn0) [^b].\n\n[^a]: We shall pay.\n\n[^b]: Plain.",
    "html": "<p>Read <a href=\"#fn0\">the note</a> <sup><a href=\"#user-content-fn-b-8fbaf730ad7d8d13c7af3e9472640c7b\" id=\"user-content-fnref-b-8fbaf730ad7d8d13c7af3e9472640c7b\" data-footnote-ref=\"\" aria-describedby=\"footnote-label\">1</a></sup>.</p>\n<section data-footnotes=\"\" class=\"footnotes\"><h2 id=\"footnote-label\" class=\"sr-only\">Footnotes</h2>\n<ol>\n<li id=\"user-content-fn-b-8fbaf730ad7d8d13c7af3e9472640c7b\">\n<p>Plain. <a href=\"#user-content-fnref-b-8fbaf730ad7d8d13c7af3e9472640c7b\" data-footnote-backref=\"\" aria-label=\"Back to reference 1\" class=\"data-footnote-backref\">↩</a></p>\n</li>\n</ol>\n</section>",
    "differsFromGitHub": "GitHub renders a used footnote at the foot of the page with its number and a link back. The rules read its body where it is written."
  },
  {
    "name": "rp nested inside rp",
    "markdown": "<rp><rp></rp>Plain words.</rp>",
    "html": "<p><rp><rp></rp>Plain words.</rp></p>"
  },
  {
    "name": "link definition over several lines",
    "markdown": "We sh[all][d] pay.\n\n[d]:\n  /guide",
    "html": "<p>We sh<a href=\"/guide\">all</a> pay.</p>"
  },
  {
    "name": "link label holding a banned word, defined over several lines",
    "markdown": "Read [plain][shall].\n\n[shall]:\n  /guide",
    "html": "<p>Read <a href=\"/guide\">plain</a>.</p>"
  },
  {
    "name": "exclamation mark before a footnote reference",
    "markdown": "![^a]\n\n[^a]: We shall pay.",
    "html": "<p>!<sup><a href=\"#user-content-fn-a-1e4b5ecb2284c057fd9541d3578fd381\" id=\"user-content-fnref-a-1e4b5ecb2284c057fd9541d3578fd381\" data-footnote-ref=\"\" aria-describedby=\"footnote-label\">1</a></sup></p>\n<section data-footnotes=\"\" class=\"footnotes\"><h2 id=\"footnote-label\" class=\"sr-only\">Footnotes</h2>\n<ol>\n<li id=\"user-content-fn-a-1e4b5ecb2284c057fd9541d3578fd381\">\n<p>We shall pay. <a href=\"#user-content-fnref-a-1e4b5ecb2284c057fd9541d3578fd381\" data-footnote-backref=\"\" aria-label=\"Back to reference 1\" class=\"data-footnote-backref\">↩</a></p>\n</li>\n</ol>\n</section>",
    "differsFromGitHub": "GitHub renders a used footnote at the foot of the page with its number and a link back. The rules read its body where it is written."
  },
  {
    "name": "footnote label holding a banned word",
    "markdown": "This works.[^shall]\n\n[^shall]: This passes.",
    "html": "<p>This works.<sup><a href=\"#user-content-fn-shall-d35472329f32191701d7f0da2edd6091\" id=\"user-content-fnref-shall-d35472329f32191701d7f0da2edd6091\" data-footnote-ref=\"\" aria-describedby=\"footnote-label\">1</a></sup></p>\n<section data-footnotes=\"\" class=\"footnotes\"><h2 id=\"footnote-label\" class=\"sr-only\">Footnotes</h2>\n<ol>\n<li id=\"user-content-fn-shall-d35472329f32191701d7f0da2edd6091\">\n<p>This passes. <a href=\"#user-content-fnref-shall-d35472329f32191701d7f0da2edd6091\" data-footnote-backref=\"\" aria-label=\"Back to reference 1\" class=\"data-footnote-backref\">↩</a></p>\n</li>\n</ol>\n</section>",
    "differsFromGitHub": "GitHub renders a used footnote at the foot of the page with its number and a link back. The rules read its body where it is written."
  }
];
