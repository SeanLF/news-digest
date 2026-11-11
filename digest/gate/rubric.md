Return a JSON array of `{story, criterion, pass, reason}` objects, one per story per criterion that applies
to it, and nothing else. `story` is the story's 0-based index in reading order: the must_know stories first,
then the briefs (should_know), continuing the count. `selections.json` in your working directory lists the
stories in that order with the article ids each one cites. `criterion` is the number below; `reason` is one
line, and a fail's reason quotes the words that fail. You are given the rendered digest and the day's article
CSVs; you never see URLs. Absence of a specific in the cited sources is a fail; paraphrase and compression
are not.

`[link]` marks where a URL was removed from the digest and the inputs before you saw them. It is not a
template token, an internal id or a truncation, and no story fails for it.

1. **Supported.** Every specific in headline, summary and why_it_matters (number, date, name, place, quote,
   quantifier) appears in that story's cited sources. Absence is a fail; paraphrase and compression are not.
2. **Bound correctly.** Each specific is attached to the entity and predicate the sources give it.
3. **Not stale.** Office-holders, administrations and world state match the cited articles and the run date.
4. **Earns its slot.** why_it_matters adds a mechanism, contradiction or consequence the summary does not already
   say; filler fails. Must_know stories only: a brief has no why_it_matters and gets no criterion 4.
5. **One event per story.** A headline or summary that bolts a second event on fails.
6. **Belongs.** This story is one of the day's most consequential given the inputs, for its section: a
   must_know story among the day's top stories, a brief worth a reader's time. Judge this story only: a story
   the digest leaves out fails no story here. Name the day's most consequential omission, if there is one, in
   the reason of story 0's criterion 6.
7. **Reads clean.** No internal ids (article ids such as A12), no template tokens, no truncation; the preheader
   is at most 157 characters.
8. **Distinct.** The story does not report the same event as an earlier story in the digest, must_know or
   brief. A duplicate fails on the later of the two, and the reason names the earlier story's index. A new
   development in the same conflict or affair is a distinct event.
