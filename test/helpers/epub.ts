import { createCanvas } from "@napi-rs/canvas";
import { strToU8, zipSync } from "fflate";

const png = () => {
	const canvas = createCanvas(40, 60);
	canvas.getContext("2d").fillRect(0, 0, 40, 60);
	return canvas.toBuffer("image/png");
};

const page = (body: string) =>
	`<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>x</title><style>p{}</style></head><body>${body}</body></html>`;

/** A small English EPUB: a cover, two chapters with <h2> titles, bold, italic, a line break and an image. */
export function makeEpub(): Uint8Array {
	const opf = `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>The Small Book</dc:title><dc:creator>Ann Author</dc:creator></metadata>
<manifest>
<item id="cover" href="img/cover.png" media-type="image/png" properties="cover-image"/>
<item id="pic" href="img/map%201.png" media-type="image/png"/>
<item id="c0" href="text/cover.xhtml" media-type="application/xhtml+xml"/>
<item id="c1" href="text/one.xhtml" media-type="application/xhtml+xml"/>
<item id="c2" href="text/two.xhtml" media-type="application/xhtml+xml"/>
</manifest>
<spine><itemref idref="c0"/><itemref idref="c1"/><itemref idref="c2"/></spine>
</package>`;
	return zipSync({
		mimetype: strToU8("application/epub+zip"),
		"META-INF/container.xml": strToU8(`<container><rootfiles><rootfile full-path="OPS/book.opf"/></rootfiles></container>`),
		"OPS/book.opf": strToU8(opf),
		"OPS/img/cover.png": png(),
		"OPS/img/map 1.png": png(),
		"OPS/text/cover.xhtml": strToU8(page(`<div><img src="../img/cover.png" alt="cover"/></div>`)),
		"OPS/text/one.xhtml": strToU8(
			page(`<h2>Chapter One</h2><p>It was a <b>bright</b> cold <i>day</i> in April.</p><p>The clocks were<br/>striking thirteen &amp; more.</p><h3>A part</h3><p>Third paragraph here.</p>`),
		),
		"OPS/text/two.xhtml": strToU8(page(`<h2>Chapter Two</h2><figure><img src="../img/map%201.png" alt="A map"/><figcaption>The map</figcaption></figure><p>Last words.</p>`)),
	});
}
