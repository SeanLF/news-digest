---
title: Extracted text is not proof the article was read; judge an article on its feed summary too.
date: 2026-09-28
category: integration-issues
module: attribute, fulltext
problem_type: integration
severity: medium
applies_when:
  - a decision treats "we have the full text" as "we read the article"
  - removing, down-ranking or labelling a source because its text says nothing relevant
tags: [fulltext, trafilatura, bot-wall, paywall, kitchen-sink, removal]
---

On dev run 310 the kitchen-sink removal took Le Monde's live page (A24) off a Ukraine story. The
stored full text was "JavaScript is disabled in your browser. Please enable JavaScript to
proceed." It was not truncated, so it counted as read in full. It stated none of the story's
claims, so it looked like an article that backs nothing. It was the story's only source for "Le
Monde reported loud explosions in Kyiv".

It was not a one-off: across the 57 runs in the dev database, every Le Monde fetch (34 of 34)
stored that same page, so the checker had never read a Le Monde article. Le Monde refuses automated
fetching (its robots.txt says so in a comment no parser reads; a browser user agent gets a 402,
"Accès restreint").

Trafilatura already solves this: `only_with_metadata=True` keeps a document only when it has a
title, a date and a URL, which a wall does not. It kept 40 of 40 real article pages sampled from
recent runs and refused the wall. Use `bare_extraction`, not `extract`: with that option `extract`
prepends the metadata, URL included, to the text. A hand-rolled headline-word check and a
per-host fingerprint table were built first and dropped for it.

Separately, the attribution stage sees each article's feed title and summary above its full text,
so an article whose own summary is on the story backs it whatever the fetch returned.

Any metric built on "has full text" counted these pages as covered, P2's 72% included.
