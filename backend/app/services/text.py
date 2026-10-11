"""Small text utilities shared by sparse encoding, evidence checks and extractive answers."""

import re

STOPWORDS = frozenset(
    """a about above after again against all am an and any are as at be because been before
    being below between both but by can could did do does doing down during each few for from
    further had has have having he her here hers him his how i if in into is it its itself just
    me more most my no nor not now of off on once only or other our ours out over own same she
    should so some such than that the their theirs them then there these they this those through
    to too under until up very was we were what when where which while who whom why will with
    would you your yours""".split()
)

_TOKEN = re.compile(r"[a-z0-9]+(?:[-_.][a-z0-9]+)*")
_SENTENCE = re.compile(r"[^.!?\n]+(?:[.!?]+|$)")


def tokenize(text: str) -> list[str]:
    """Lowercased word tokens. Keeps codes such as `zx-4471` or `v2.1` intact."""
    return _TOKEN.findall(text.lower())


def content_terms(text: str) -> list[str]:
    return [t for t in tokenize(text) if t not in STOPWORDS and len(t) > 1]


def lexical_coverage(query: str, passage: str) -> float:
    """Share of the query's content terms that appear in the passage."""
    terms = set(content_terms(query))
    if not terms:
        return 0.0
    passage_terms = set(tokenize(passage))
    return len(terms & passage_terms) / len(terms)


def split_sentences(text: str) -> list[str]:
    return [s.strip() for s in _SENTENCE.findall(text) if s.strip()]
