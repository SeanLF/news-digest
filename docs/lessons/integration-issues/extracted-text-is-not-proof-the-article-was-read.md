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

Four of 134 stored texts in runs 307-310 plus that dev run were not the article: this bot wall, a
Haaretz paywall teaser, a YouTube footer and an AFP stub. The extractor returns whatever page it is
served, and nothing downstream can tell a short article from a wall.

The fix is structural, with no list of bot-wall phrases and no length cutoff. The attribution stage
sees each article's feed title and summary above its full text. An article whose own summary is on
the story backs it, whatever the fetch returned; a genuinely unrelated article has an unrelated
summary too, and still goes. With that, the dev run removes nothing.

The same applies to any metric built on "has full text". P2's coverage figure (72% of cited
articles) counts these pages as covered.
