# Solace · an odyssey for Ica

A static, frontend-only site. No build step, no dependencies, no backend.

```
index.html
css/style.css
js/main.js
js/letters.enc.js   (generated, encrypted letters)
private/            (letters.json + build.mjs, never deployed)
favicon.svg
robots.txt
vercel.json
```

## Deploy to Vercel

**Easiest (CLI)**

```bash
npm i -g vercel
cd solace
vercel          # first deploy (preview)
vercel --prod   # production
```

When asked, choose: framework preset **Other**, no build command, output directory = project root (`./`).

**Or via Git**: push this folder to a GitHub repo, import it at vercel.com/new, framework preset **Other**, leave build settings empty, deploy.

## Preview locally

```bash
npx serve .
```

(Or just open `index.html` in a browser.) Add `?skip` to the URL to bypass the "Set sail" screen while testing.

## Editing

- **Letter text, titles, hints and keywords**: `private/letters.json`. After any change run `node private/build.mjs`, which re-encrypts everything into `js/letters.enc.js`. Deploy that file; `private/` is excluded from Vercel (`.vercelignore`) and git (`.gitignore`), so the plain text and keywords never go online. Keep your own backup of `private/`.
- Each letter is encrypted (PBKDF2 → AES-256-GCM) with its own keyword, so the text isn't readable in the page source. Keywords are case- and extra-space-insensitive. Titles and subtitles stay public (they show on the cards). Anyone can guess keywords offline, so avoid obvious ones.
- A letter Ica has unlocked stays unlocked in that browser (localStorage). To re-lock for testing, clear the site data.
- **Colors**: CSS variables at the top of `css/style.css`.
- **Site name / tagline**: `index.html` (gate, hero, `<title>`).

## Notes

- Fonts (Cinzel, Cormorant Garamond, Caveat) load from Google Fonts.
- The site is marked `noindex` (meta tag, `robots.txt` and an `X-Robots-Tag` header), but anyone who has the link can open it. Vercel's password protection is a paid feature; otherwise just share the URL only with Ica.
- Which letters have been opened is remembered in the browser's localStorage only.
- Honors `prefers-reduced-motion`.
