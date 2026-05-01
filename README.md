# fontgrep

search github for font files by name. find what you need, download it, move on.

```
npx fontgrep "GT Walsheim"
```

---

`fontgrep` searches github for font files that developers have committed to public repositories alongside their projects. this is extraordinarily common. every web project that uses a custom font has to put the font file somewhere, and for a huge number of developers that *somewhere* is their public github repo. the files are already public, `fontgrep` just helps you find them.

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

no setup required. `fontgrep` works out of the box using [sourcegraph](https://sourcegraph.com) to search public github repos.

on first run, it'll ask if you want to add a github token for extra results. this is optional — github search finds some files sourcegraph misses, but has strict rate limits (~30 req/min) and slows things down.

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

  780 results across 156 repos (3000 before dedup)

  inter  ·  12 weights  ·  best source: ******/****** (15.0k★)

     1. thin                 Inter-Thin.woff2                              woff2
     2. extralight           Inter-ExtraLight.woff2                        woff2
     3. light                Inter-Light.woff2                             woff2
     4. regular              Inter-Regular.woff2                           woff2
     5. variable             InterVariable.woff2                           woff2
     6. regular italic       Inter-Italic.woff2                            woff2
     7. variable italic      InterVariable-Italic.woff2                    woff2
     8. medium               Inter-Medium.woff2                            woff2
     9. semibold             Inter-SemiBold.woff2                          woff2
    10. bold                 Inter-Bold.woff2                              woff2
    11. extrabold            Inter-ExtraBold.woff2                         woff2
    12. black                Inter-Black.woff2                             woff2

  also found 5 related families:
    inter-ui (7 weights)
    intertight (5 weights)
    interdisplay (10 weights)

  → download [1-12], [a] all, [q] quit: a

  ↓ Inter-Thin.woff2              done
  ↓ Inter-ExtraLight.woff2        done
  ↓ Inter-Light.woff2             done
  ↓ Inter-Regular.woff2           done
  ↓ InterVariable.woff2           done
  ...

  saved to ./Inter/
```

you can also pick specific weights or ranges: `4`, `1-4`, `1,4,8`, `1-4,8`

**rare fonts work too**

```
$ fontgrep "Signifier"

  38 results across 10 repos

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

  1 results across 1 repos

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

## how results are ranked

results aren't just sorted by popularity. `fontgrep` scores each file:

- **format**: woff2 scores higher than otf, otf higher than ttf. woff2 is what you actually want for web; ttf for desktop install.
- **repo stars**: log-scaled, capped contribution. a signal, not a guarantee.
- **filename match**: files whose names start with your query score significantly higher — enough to beat a high-star repo serving an unrelated font.
- **path depth**: files in `fonts/` or `assets/fonts/` score higher than files nested six directories deep in a test fixture.
- **deduplication**: identical filenames across repos are collapsed, keeping the highest-scored copy.
- **family selection**: results are grouped by font family, and the family whose name best matches your query is shown first — not just whichever family has the most weights.

---

## notes

- search is powered by [sourcegraph](https://sourcegraph.com) — no auth required, no rate limits, indexes millions of public repos.
- a github token can be added optionally for supplemental results. `fontgrep` waits out rate limits automatically.
- font names are fuzzy-matched — `fontgrep` tries multiple variants of your query (spaces, hyphens, underscores, concatenated) so you don't have to guess the filename format.
- results are grouped by weight automatically. subset files (cyrillic, latin-ext, etc.) are filtered out so you get clean, complete font files.

---

## contributing

PRs welcome.

---

## license

MIT.
`fontgrep` is free. libre. gratis. open source. you know, like the alphabet.
