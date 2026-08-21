import { useEffect, useState } from "react";

type Result = { id: string; title: string };

export function SearchResults({ query }: { query: string }) {
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const options = { headers: { "content-type": "application/json" } };

  useEffect(() => {
    if (!query) {
      setResults([]);
      return;
    }

    setLoading(true);

    fetch(`/api/search?q=${query}`, options)
      .then((res) => res.json())
      .then((data) => {
        setResults(data.results);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [query, options]);

  if (error) return <p>{error}</p>;

  return (
    <ul>
      {loading && <li>Loading...</li>}
      {results.map((r) => (
        <li key={r.id}>{r.title}</li>
      ))}
    </ul>
  );
}
