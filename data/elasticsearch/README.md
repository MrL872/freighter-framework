# Elasticsearch data

- `data/` is the search index. Elasticsearch writes it here, and it is a derived copy of the Derby database, so it can be rebuilt.
- `logs/` holds the Elasticsearch server logs.

Both folders are bind-mounted read-write into the elasticsearch container. Git ignores their contents.
