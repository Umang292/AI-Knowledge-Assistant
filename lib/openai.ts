const API_URL = "https://api.openai.com/v1";

function apiKey() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not configured.");
  return key;
}

export async function createEmbeddings(texts: string[]) {
  const response = await fetch(`${API_URL}/embeddings`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small",
      input: texts,
    }),
  });
  if (!response.ok) throw new Error(`Embedding service returned ${response.status}: ${(await response.text()).slice(0, 500)}`);
  const result = await response.json();
  if (!Array.isArray(result.data) || result.data.length !== texts.length) {
    throw new Error("Embedding service returned an incomplete response.");
  }
  return (result.data as { index: number; embedding: number[] }[])
    .sort((a, b) => a.index - b.index)
    .map((item) => item.embedding);
}

export async function startChatCompletion(messages: { role: string; content: string }[]) {
  return fetch(`${API_URL}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      messages,
      stream: true,
      temperature: 0.2,
    }),
  });
}
