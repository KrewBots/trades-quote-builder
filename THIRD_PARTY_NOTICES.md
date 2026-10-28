# Third-party notices

The MIT licence in `LICENSE` covers this project's own code. These bundled
files keep their own licences:

| Files | Project | Licence | Full text |
|---|---|---|---|
| `public/fonts/InstrumentSans-latin.woff2`, `public/fonts/InstrumentSans-latin-ext.woff2` | Instrument Sans, Copyright 2022 The Instrument Sans Project Authors (https://github.com/Instrument/instrument-sans) | SIL Open Font License 1.1 | `public/fonts/OFL-instrument-sans.txt` |
| `public/fonts/Caveat.ttf` | Caveat, Copyright 2014 The Caveat Project Authors | SIL Open Font License 1.1 | `public/fonts/OFL-caveat.txt` |

| Icon path data in `public/lib/icons.js` | Lucide, Copyright (c) 2026 Lucide Icons and Contributors (https://lucide.dev) | ISC | below |

The OFL allows bundling and redistributing the fonts with software, including
embedding them in generated documents. The fonts may not be sold on their own,
and they stay under the OFL.

PDFs use the standard Helvetica font, which PDF readers supply. The font is
referenced but not embedded. The glyph widths in `public/lib/pdf-writer.js` come from
Adobe's Core 14 AFM font metrics, which Adobe permits anyone to use, copy and
distribute.

Development only (not shipped to the browser): `playwright` (Apache-2.0), used
by the end-to-end tests.

The business, client, logo, addresses, phone numbers (555-01xx) and emails
(`example.com`) in the sample job and tests are fictional.

Lucide licence (ISC):

> Permission to use, copy, modify, and/or distribute this software for any
> purpose with or without fee is hereby granted, provided that the above
> copyright notice and this permission notice appear in all copies.
>
> THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
> WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
> MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY
> SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
> WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION
> OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN
> CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
