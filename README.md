# fontgrep

search for font files by name. find what you need, download it, move on.

```
npx fontgrep "GT Walsheim"
```

---

`fontgrep` searches [fontsource](https://fontsource.org) for official open-source fonts first, then falls back to github repos where developers have committed font files alongside their projects. this is extraordinarily common. every web project that uses a custom font has to put the font file somewhere, and for a huge number of developers that *somewhere* is their public github repo.

---

## install

```bash
npm install -g fontgrep
```

or just use it without installing:

```bash
npx fontgrep "Font Name"
```

---

## setup

no setup required. `fontgrep` works out of the box.

on first run, it'll ask if you want to add a github token for extra results. this is optional. github search finds some files sourcegraph misses, but has strict rate limits (~30 req/min) and slows things down.

```
$ fontgrep "anything"

  welcome to fontgrep

  fontgrep searches public github repos for font files.
  it works out of the box — no account needed.

  optionally, you can add a github token for extra results.
  github search finds some files sourcegraph misses, but
  it has strict rate limits (~30 req/min) and slows things down.

  ? add a github token for additional results? No

  ✓ ready to go. you can add a token later with: fontgrep setup
```

to add a token later: `fontgrep setup`

---

## usage

```
fontgrep <query> [options]

options:
  -e, --ext <exts...>   file extensions to include  (default: ttf otf woff2)
  -f, --first           download top result immediately, no prompt
  --list                show flat file list instead of grouped family view
  --raw                 print raw download URLs only, for piping
  -o, --out <dir>       output directory             (default: .)
  --setup               reconfigure github token
```

---

## examples

**search and download a family**

results are grouped by weight automatically. select numbers, ranges, or [a] for all.

```
$ fontgrep "Inter"

  806 github results across 158 repos  ✦ fontsource

  inter  ·  20 weights  ·  fontsource  ✦

     1. thin                 Inter-Thin.woff2                              woff2
     2. thin italic          Inter-Thin-Italic.woff2                       woff2
     3. extralight           Inter-ExtraLight.woff2                        woff2
    ...
    20. black italic         Inter-Black-Italic.woff2                      woff2

  also found 8 related families:
    [f1] inter-ui (7 weights)
    [f2] interdisplay (10 weights)
    ...

  → download [1-20], [a] all, [f1-f8] switch family, [g] github results, [q] quit: a

  ↓ Inter-Thin.woff2              done
  ↓ Inter-ExtraLight.woff2        done
  ...

  saved to ./inter/
```

you can also pick specific weights or ranges: `4`, `1-4`, `1,4,8`, `1-4,8`

type `f1`, `f2`, etc. to switch to a related family. type `g` to browse raw github results instead of the fontsource version.

**rare fonts work too**

```
$ fontgrep "Signifier"

  38 github results across 10 repos

  signifier  ·  7 weights  ·  best source: ******/****** (1.9k★)

     1. thin                 signifier-thin.woff2                          woff2
     2. light                signifier-light.woff2                         woff2
     3. light italic         signifier-light-italic.woff2                  woff2
     4. regular              Signifier-Regular.otf                         otf
     5. medium italic        SignifierMedium-Italic.woff2                  woff2
     6. bold                 signifier-bold.woff2                          woff2
     7. bold italic          signifier-bold-italic.woff2                   woff2
```

**silent grab — top result, no prompt**

```
$ fontgrep "Power Grotesk" --first --out ~/fonts/

  ↓ PowerGrotesk-UltraBold.woff2    done

  saved to ~/fonts/
```

**pipe it**

```bash
fontgrep "Pragmata Pro" --raw
# https://raw.githubusercontent.com/********/********/main/*****/EssentialPragmataPro-R.otf
# https://raw.githubusercontent.com/********/********/main/*****/EssentialPragmataPro-B.ttf

fontgrep "Pragmata Pro" --raw | xargs -I {} wget {}
```

---

## sources

`fontgrep` searches in order:

1. **[fontsource](https://fontsource.org)** — curated open-source fonts with direct CDN downloads. no auth needed. if your font is here, this is the cleanest version.
2. **[sourcegraph](https://sourcegraph.com)** — indexes millions of public github repos. no auth required, no rate limits.
3. **github api** — optional, requires a token. finds additional files sourcegraph misses.

when fontsource has a match, it's shown first. type `[g]` at the prompt to browse the github results instead.

---

## how results are ranked

results aren't just sorted by popularity. `fontgrep` scores each file:

- **source**: fontsource results rank highest — they're official, complete, and always woff2.
- **format**: woff2 scores higher than otf, otf higher than ttf.
- **repo stars**: log-scaled, capped contribution. a signal, not a guarantee.
- **filename match**: files whose names start with your query score significantly higher, enough to beat a high-star repo serving an unrelated font.
- **path depth**: files in `fonts/` or `assets/fonts/` score higher than files nested six directories deep in a test fixture.
- **deduplication**: identical filenames across repos are collapsed, keeping the highest-scored copy.
- **family selection**: results are grouped by font family, and the family whose name best matches your query is shown first.

---

## notes

- font names are fuzzy-matched. `fontgrep` tries multiple variants of your query (spaces, hyphens, underscores, concatenated) so you don't have to guess the filename format.
- subset files (cyrillic, latin-ext, etc.) are filtered out so you get clean, complete font files.
- fontsource downloads use the latin subset by default.

---

## contributing

PRs welcome.

---

## license

MIT.
`fontgrep` is free. libre. gratis. open source. you know, like the alphabet.
